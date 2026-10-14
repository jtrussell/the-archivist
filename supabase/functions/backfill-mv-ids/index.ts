// Background job: resolve and verify Master Vault ids for the shared `decks` table.
//
// Runs on a schedule (Supabase Cron -> this function) with the service-role key,
// so it works whether or not any client is open — the "scan a batch, close the
// app, download a hydrated CSV next morning" case. Two phases per run:
//
//   1. VERIFY: decks whose mv_id was asserted by a client ('unverified' — the
//      manual escape hatch, or the client's name-search fast path) are fetched
//      from the Master Vault BY ID and overwritten with the API's name/set_id
//      ('resolved'), or flagged 'invalid' when the id doesn't exist. This is
//      what makes client writes to the shared table self-healing: a wrong or
//      malicious assertion can never stick.
//   2. RESOLVE: nameless-id decks are searched by name (exact match) and linked
//      via link_deck_master_vault_admin (which also merges cross-user
//      duplicates onto one canonical row).
//
// Timing / safety design (see also the work-queue functions
// decks_pending_verification / decks_pending_resolution):
//   * Returns 202 immediately and does the work in EdgeRuntime.waitUntil, so the
//     job survives the caller (pg_net) disconnecting and can use the full
//     wall-clock budget. Free-tier wall limit is 150s; we stop at TIME_BUDGET_MS.
//   * Drains in a loop of small CLAIMED chunks rather than one big batch, so a
//     run never approaches the wall limit and a mid-flight stop strands at most
//     one chunk (which self-heals after the backoff).
//   * Claiming (SKIP LOCKED) means stacked/overlapping invocations get disjoint
//     rows — never duplicate API calls.
//
// Deploy:  supabase functions deploy backfill-mv-ids --no-verify-jwt
// Secret:  supabase secrets set CRON_SECRET=<random string>
//          (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by default.)
// Schedule: see supabase/cron/backfill-mv-ids.sql

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void }

const API_BASE = 'https://www.keyforgegame.com/api'

// KeyForge/Cloudflare serves this egress slowly (often several seconds,
// occasionally >15s). A generous timeout lets the slow-but-fine requests
// complete; the rare true hang aborts and is retried on a later run.
const EXPLORE_SEARCH_TIMEOUT_MS = 15000
const CHUNK_SIZE = 30           // decks claimed per loop iteration
// KeyForge degrades under concurrent load (it appears to throttle bursts), so
// serial is the best-observed setting — parallelism made throughput WORSE.
// Left tunable via the MV_CONCURRENCY secret in case that ever changes.
const CONCURRENCY = Number(Deno.env.get('MV_CONCURRENCY')) || 1
const TIME_BUDGET_MS = 120_000  // stop well under the 150s free-tier wall limit

// KeyForge is behind Cloudflare; a bare server-side fetch (no browser headers)
// tends to get a 403/challenge. Present browser-like headers so the API responds
// the same way it does for the client.
const REQUEST_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
}

interface PendingDeck {
  id: string
  deck_name: string | null
  deck_code: string | null
  deck_uuid: string | null
}

interface UnverifiedDeck {
  id: string
  mv_id: string
}

type SupabaseClient = ReturnType<typeof createClient>

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

interface SearchResult {
  info: { mvId: string; setId: number | null } | null
  status: number | null
  candidateCount: number
  contentType: string | null
  /** First ~180 chars of the body when parsing/matching failed (for diagnostics) */
  bodyPreview: string | null
}

/** Resolve mv_id/set_id by exact name match against the explore search. */
async function fetchMasterVaultInfo(deckName: string): Promise<SearchResult> {
  const params = new URLSearchParams({ page: '1', page_size: '10', search: deckName })
  try {
    const res = await fetch(`${API_BASE}/decks/explore/?${params}`, {
      headers: REQUEST_HEADERS,
      signal: AbortSignal.timeout(EXPLORE_SEARCH_TIMEOUT_MS),
    })
    const contentType = res.headers.get('content-type')
    const text = await res.text()
    const preview = () => text.slice(0, 180).replace(/\s+/g, ' ').trim()

    if (!res.ok) {
      return { info: null, status: res.status, candidateCount: 0, contentType, bodyPreview: preview() }
    }

    let body: { data?: unknown } | null = null
    try {
      body = JSON.parse(text)
    } catch {
      body = null // non-JSON body (e.g. a Cloudflare challenge page served as 200)
    }
    const candidates: { id?: unknown; name?: unknown; expansion?: { set_id?: unknown } }[] =
      Array.isArray(body?.data) ? (body!.data as never[]) : []

    const wanted = deckName.trim().toLowerCase()
    const match = candidates.find(
      (c) => typeof c.name === 'string' && c.name.trim().toLowerCase() === wanted
    )
    if (!match || typeof match.id !== 'string' || match.id.length === 0) {
      return {
        info: null,
        status: res.status,
        candidateCount: candidates.length,
        contentType,
        // Only capture a preview when we got nothing usable back
        bodyPreview: candidates.length === 0 ? preview() : null,
      }
    }
    return {
      info: {
        mvId: match.id,
        setId: typeof match.expansion?.set_id === 'number' ? match.expansion.set_id : null,
      },
      status: res.status,
      candidateCount: candidates.length,
      contentType,
      bodyPreview: null,
    }
  } catch (e) {
    return {
      info: null,
      status: null,
      candidateCount: 0,
      contentType: null,
      bodyPreview: String(e).slice(0, 120),
    }
  }
}

type ByIdResult =
  | { kind: 'found'; name: string; setId: number | null }
  | { kind: 'missing' }          // definitive 404: the id does not exist
  | { kind: 'error'; debug: string } // transient (timeout, 5xx, challenge page)

/** Fetch a deck by Master Vault id. Only a clean 404 counts as "missing". */
async function fetchMasterVaultById(mvId: string): Promise<ByIdResult> {
  try {
    const res = await fetch(`${API_BASE}/decks/${mvId}/`, {
      headers: REQUEST_HEADERS,
      signal: AbortSignal.timeout(EXPLORE_SEARCH_TIMEOUT_MS),
    })
    const text = await res.text()
    if (res.status === 404) return { kind: 'missing' }
    if (!res.ok) return { kind: 'error', debug: `status=${res.status}` }

    let body: { data?: { name?: unknown; expansion?: unknown } } | null = null
    try {
      body = JSON.parse(text)
    } catch {
      return { kind: 'error', debug: `non-json body="${text.slice(0, 120)}"` }
    }
    const name = body?.data?.name
    if (typeof name !== 'string' || name.length === 0) {
      return { kind: 'error', debug: 'no name in body' }
    }
    const expansion = body?.data?.expansion
    return { kind: 'found', name, setId: typeof expansion === 'number' ? expansion : null }
  } catch (e) {
    return { kind: 'error', debug: String(e).slice(0, 120) }
  }
}

type Outcome = 'resolved' | 'no-name' | 'search-http-error' | 'no-match' | 'link-error'

/** Resolve one deck and persist the outcome (success or recorded miss). */
async function resolveDeck(
  supabase: SupabaseClient,
  deck: PendingDeck
): Promise<{ outcome: Outcome; debug: string | null }> {
  const name = deck.deck_name
  // The work queue only hands out named decks; a nameless deck usually just
  // isn't registered in the Master Vault yet, so we don't chase names here.
  if (!name) return { outcome: 'no-name', debug: null }

  const search = await fetchMasterVaultInfo(name)
  const info = search.info

  // A null mv_id records a failed attempt (and eventually 'exhausted').
  const { error } = await supabase.rpc('link_deck_master_vault_admin', {
    p_deck_ref: deck.id,
    p_mv_id: info?.mvId ?? null,
    p_set_id: info?.setId ?? null,
    p_name: name,
  })

  if (error) return { outcome: 'link-error', debug: error.message }
  if (info) return { outcome: 'resolved', debug: null }

  const debug =
    `status=${search.status} ct=${search.contentType} ` +
    `candidates=${search.candidateCount}` +
    (search.bodyPreview ? ` body="${search.bodyPreview}"` : '')
  if (search.status && search.status >= 400) return { outcome: 'search-http-error', debug }
  return { outcome: 'no-match', debug }
}

type VerifyOutcome = 'verified' | 'invalid' | 'verify-error' | 'verdict-error'

/** Verify one client-asserted mv_id by fetching it and persisting the verdict. */
async function verifyDeck(
  supabase: SupabaseClient,
  deck: UnverifiedDeck
): Promise<{ outcome: VerifyOutcome; debug: string | null }> {
  const result = await fetchMasterVaultById(deck.mv_id)
  // Transient failures record nothing; the claim stamp defers a retry by 1h.
  if (result.kind === 'error') return { outcome: 'verify-error', debug: result.debug }

  const { error } = await supabase.rpc('verify_deck_admin', {
    p_deck_ref: deck.id,
    p_valid: result.kind === 'found',
    p_name: result.kind === 'found' ? result.name : null,
    p_set_id: result.kind === 'found' ? result.setId : null,
  })
  if (error) return { outcome: 'verdict-error', debug: error.message }
  return { outcome: result.kind === 'found' ? 'verified' : 'invalid', debug: null }
}

/**
 * Generic claim-and-process loop with bounded concurrency and a shared
 * deadline. `claim` pulls the next chunk (empty = drained); `handle` processes
 * one row and returns an outcome label for the tally.
 */
async function drain<T extends { id: string }>(
  label: string,
  timeLeft: () => number,
  claim: () => Promise<T[]>,
  handle: (row: T) => Promise<{ outcome: string; debug: string | null }>,
  describe: (row: T) => string
): Promise<void> {
  let processed = 0
  const tally: Record<string, number> = {}
  let sample: string | null = null

  // Tally + sample update. Runs on the single JS event loop, so the shared
  // counters are safe to mutate from the concurrent workers below.
  const run = async (row: T): Promise<void> => {
    if (timeLeft() <= 0) return
    const { outcome, debug } = await handle(row)
    tally[outcome] = (tally[outcome] ?? 0) + 1
    processed++
    if (sample === null && !outcome.startsWith('resolved') && !outcome.startsWith('verified')) {
      sample = `${outcome} ${describe(row)}` + (debug ? ` | ${debug}` : '')
    }
  }

  while (timeLeft() > 0) {
    let chunk: T[]
    try {
      chunk = await claim()
    } catch (e) {
      console.error(`${label}: claim failed:`, e instanceof Error ? e.message : String(e))
      break
    }
    if (chunk.length === 0) break // queue drained

    // Fan the chunk out across CONCURRENCY workers that pull from a shared cursor.
    let next = 0
    const runners = Array.from(
      { length: Math.min(CONCURRENCY, chunk.length) },
      async () => {
        while (next < chunk.length && timeLeft() > 0) {
          await run(chunk[next++])
        }
      }
    )
    await Promise.all(runners)
  }

  const counts = Object.entries(tally)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')
  console.log(`${label}: processed=${processed} ${counts}` + (sample ? ` | sample: ${sample}` : ''))
}

async function claimRpc<T>(supabase: SupabaseClient, fn: string): Promise<T[]> {
  const { data, error } = await supabase.rpc(fn, { p_limit: CHUNK_SIZE })
  if (error) throw new Error(error.message)
  return (data ?? []) as T[]
}

/** Both phases, sharing one time budget: verification first (cheap, by id). */
async function runJob(supabase: SupabaseClient): Promise<void> {
  const startedAt = Date.now()
  const timeLeft = () => TIME_BUDGET_MS - (Date.now() - startedAt)

  await drain<UnverifiedDeck>(
    'verify-mv-ids',
    timeLeft,
    () => claimRpc<UnverifiedDeck>(supabase, 'decks_pending_verification'),
    (deck) => verifyDeck(supabase, deck),
    (deck) => `deck=${deck.id} mv_id=${deck.mv_id}`
  )

  await drain<PendingDeck>(
    'backfill-mv-ids',
    timeLeft,
    () => claimRpc<PendingDeck>(supabase, 'decks_pending_resolution'),
    (deck) => resolveDeck(supabase, deck),
    (deck) => `deck=${deck.id} name=${JSON.stringify(deck.deck_name)}`
  )
}

Deno.serve((req: Request) => {
  // Gate: only the cron (bearing the shared secret) may invoke this.
  const secret = Deno.env.get('CRON_SECRET')
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY' }, 500)
  }
  const supabase = createClient(supabaseUrl, serviceKey)

  // Do the work in the background so it survives the caller disconnecting, and
  // return immediately so pg_net's request completes right away.
  EdgeRuntime.waitUntil(runJob(supabase))
  return json({ status: 'started' }, 202)
})

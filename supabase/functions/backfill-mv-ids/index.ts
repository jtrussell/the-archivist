// Background job: resolve Master Vault ids for unresolved decks.
//
// Runs on a schedule (Supabase Cron -> this function) with the service-role key,
// so it works whether or not any client is open — the "scan a batch, close the
// app, download a hydrated CSV next morning" case. It reads each deck's private
// scan code/uuid (allowed as service role), resolves name + mv_id against the
// KeyForge Master Vault API, and writes only non-sensitive facts back via the
// link_deck_master_vault_admin RPC (which also merges cross-format / cross-user
// duplicates onto one canonical row).
//
// Timing / safety design (see also the work-queue function decks_pending_resolution):
//   * Returns 202 immediately and does the work in EdgeRuntime.waitUntil, so the
//     job survives the caller (pg_net) disconnecting and can use the full
//     wall-clock budget. Free-tier wall limit is 150s; we stop at TIME_BUDGET_MS.
//   * Drains in a loop of small CLAIMED chunks rather than one big batch, so a
//     run never approaches the wall limit and a mid-flight stop strands at most
//     one chunk (which self-heals after the 24h backoff).
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
// KeyForge/Cloudflare serves this egress slowly (tarpit-style latency: often
// several seconds, occasionally >15s). A generous timeout lets the slow-but-fine
// requests complete; the rare true hang aborts and is retried on a later run.
const EXPLORE_SEARCH_TIMEOUT_MS = 15000
const THROTTLE_MS = 150
const CHUNK_SIZE = 25          // decks claimed+processed per loop iteration
const TIME_BUDGET_MS = 120_000 // stop well under the 150s free-tier wall limit

// KeyForge is behind Cloudflare; a bare server-side fetch (no browser headers)
// tends to get a 403/challenge. Present browser-like headers so the API responds
// the same way it does for the client.
const REQUEST_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
}

const randByte = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1))

// Fresh headers per request, with a randomized private-range X-Forwarded-For.
// Note: Cloudflare uses the real connection IP, so this only matters if the
// origin app itself keys off XFF — treat it as best-effort, not a real bypass.
function requestHeaders(): HeadersInit {
  return {
    ...REQUEST_HEADERS,
    'X-Forwarded-For': `192.168.${randByte(0, 255)}.${randByte(1, 254)}`,
  }
}

interface PendingDeck {
  id: string
  deck_name: string | null
  deck_code: string | null
  deck_uuid: string | null
}

type SupabaseClient = ReturnType<typeof createClient>

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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
      headers: requestHeaders(),
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

/** Drain the queue in small claimed chunks until the time budget is spent. */
async function drainQueue(supabase: SupabaseClient): Promise<void> {
  const startedAt = Date.now()
  let processed = 0
  const tally: Record<Outcome, number> = {
    resolved: 0,
    'no-name': 0,
    'search-http-error': 0,
    'no-match': 0,
    'link-error': 0,
  }
  let sample: string | null = null

  while (Date.now() - startedAt < TIME_BUDGET_MS) {
    const { data, error } = await supabase.rpc('decks_pending_resolution', {
      p_limit: CHUNK_SIZE,
    })
    if (error) {
      console.error('claim failed:', error.message)
      break
    }
    const chunk = (data ?? []) as PendingDeck[]
    if (chunk.length === 0) break // queue drained

    for (const deck of chunk) {
      if (Date.now() - startedAt >= TIME_BUDGET_MS) break
      const { outcome, debug } = await resolveDeck(supabase, deck)
      tally[outcome]++
      processed++
      // Keep one example of a non-success for the logs
      if (sample === null && outcome !== 'resolved') {
        sample =
          `${outcome} deck=${deck.id} name=${JSON.stringify(deck.deck_name)}` +
          (debug ? ` | ${debug}` : '')
      }
      await sleep(THROTTLE_MS)
    }
  }

  console.log(
    `backfill-mv-ids: processed=${processed} resolved=${tally.resolved} ` +
      `no-name=${tally['no-name']} search-http-error=${tally['search-http-error']} ` +
      `no-match=${tally['no-match']} link-error=${tally['link-error']}` +
      (sample ? ` | sample: ${sample}` : '')
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
  EdgeRuntime.waitUntil(drainQueue(supabase))
  return json({ status: 'started' }, 202)
})

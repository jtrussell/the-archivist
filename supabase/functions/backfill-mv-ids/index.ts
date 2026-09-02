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
const NAME_FETCH_TIMEOUT_MS = 5000
const EXPLORE_SEARCH_TIMEOUT_MS = 5000
const THROTTLE_MS = 150
const CHUNK_SIZE = 25          // decks claimed+processed per loop iteration
const TIME_BUDGET_MS = 120_000 // stop well under the 150s free-tier wall limit

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

/** Fetch a deck name from the by-id endpoints (deterministic). */
async function fetchDeckName(
  deckCode: string | null,
  deckUuid: string | null
): Promise<string | null> {
  const url = deckUuid
    ? `${API_BASE}/decks/${deckUuid}/`
    : deckCode
      ? `${API_BASE}/decks/codes/${deckCode}/`
      : null
  if (!url) return null

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(NAME_FETCH_TIMEOUT_MS) })
    if (!res.ok) return null
    const body = await res.json()
    const name = body?.name ?? body?.data?.name
    return typeof name === 'string' && name.length > 0 ? name : null
  } catch {
    return null
  }
}

/** Resolve mv_id/set_id by exact name match against the explore search. */
async function fetchMasterVaultInfo(
  deckName: string
): Promise<{ mvId: string; setId: number | null } | null> {
  const params = new URLSearchParams({ page: '1', page_size: '10', search: deckName })
  try {
    const res = await fetch(`${API_BASE}/decks/explore/?${params}`, {
      signal: AbortSignal.timeout(EXPLORE_SEARCH_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const body = await res.json()
    const candidates: { id?: unknown; name?: unknown; expansion?: { set_id?: unknown } }[] =
      Array.isArray(body?.data) ? body.data : []
    const wanted = deckName.trim().toLowerCase()
    const match = candidates.find(
      (c) => typeof c.name === 'string' && c.name.trim().toLowerCase() === wanted
    )
    if (!match || typeof match.id !== 'string' || match.id.length === 0) return null
    return {
      mvId: match.id,
      setId: typeof match.expansion?.set_id === 'number' ? match.expansion.set_id : null,
    }
  } catch {
    return null
  }
}

/** Resolve one deck and persist the outcome (success or recorded miss). */
async function resolveDeck(supabase: SupabaseClient, deck: PendingDeck): Promise<boolean> {
  const name = deck.deck_name ?? (await fetchDeckName(deck.deck_code, deck.deck_uuid))
  const info = name ? await fetchMasterVaultInfo(name) : null

  // A null mv_id records a failed attempt (and eventually 'exhausted').
  const { error } = await supabase.rpc('link_deck_master_vault_admin', {
    p_deck_ref: deck.id,
    p_mv_id: info?.mvId ?? null,
    p_set_id: info?.setId ?? null,
    p_name: name ?? null,
  })
  return !error && info !== null
}

/** Drain the queue in small claimed chunks until the time budget is spent. */
async function drainQueue(supabase: SupabaseClient): Promise<void> {
  const startedAt = Date.now()
  let processed = 0
  let resolved = 0

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
      if (await resolveDeck(supabase, deck)) resolved++
      processed++
      await sleep(THROTTLE_MS)
    }
  }

  console.log(`backfill-mv-ids: processed=${processed} resolved=${resolved}`)
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

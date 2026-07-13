/**
 * Supabase data access for scans, labels, and search
 */

import { supabase } from '../lib/supabase'
import { fetchDeckName } from './deckTransform'

export interface RecordedScan {
  scanId: string
  labelId: string
  position: number
}

export interface DeckLocation {
  scan_id: string
  deck_id: string
  deck_name: string | null
  deck_code: string | null
  deck_uuid: string | null
  label: string
  position: number
  scanned_at: string
}

/**
 * Record a scan via the record_scan RPC; the database assigns the
 * per-label position atomically and returns it.
 */
export async function recordScanToDb(item: {
  label: string
  deckId: string
  deckName: string | null
  deckCode: string | null
  deckUuid: string | null
  scannedAt: string
}): Promise<RecordedScan> {
  const { data, error } = await supabase.rpc('record_scan', {
    p_label: item.label,
    p_deck_id: item.deckId,
    p_deck_name: item.deckName,
    p_deck_code: item.deckCode,
    p_deck_uuid: item.deckUuid,
    p_scanned_at: item.scannedAt,
  })

  if (error) throw new Error(`Failed to record scan: ${error.message}`)

  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('record_scan returned no result')

  return {
    scanId: row.scan_id,
    labelId: row.label_id,
    position: row.position,
  }
}

/**
 * Get the current user's labels, most recently created first
 */
export async function getLabels(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase
    .from('labels')
    .select('id, name')
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to load labels: ${error.message}`)
  return data ?? []
}

/**
 * Get the highest assigned position under a label (0 if none)
 */
export async function getMaxPosition(label: string): Promise<number> {
  const { data, error } = await supabase
    .from('scans')
    .select('position, labels!inner(name)')
    .eq('labels.name', label.trim())
    .order('position', { ascending: false })
    .limit(1)

  if (error) throw new Error(`Failed to load position: ${error.message}`)
  return data?.[0]?.position ?? 0
}

/**
 * Count scans whose deck name lookup failed (candidates for backfill)
 */
export async function countNamelessScans(): Promise<number> {
  const { count, error } = await supabase
    .from('scans')
    .select('id', { count: 'exact', head: true })
    .is('deck_name', null)

  if (error) throw new Error(`Failed to count nameless scans: ${error.message}`)
  return count ?? 0
}

export interface BackfillResult {
  /** Scan rows that received a name */
  updated: number
  /** Scan rows still nameless (lookups failed again) */
  remaining: number
}

/**
 * Self-heal nameless scans: refetch each missing deck name from the Master
 * Vault API (one request per unique deck, politely throttled) and update all
 * of that deck's rows in one query. Safe to re-run; picks up where it left off.
 */
export async function backfillDeckNames(
  onProgress?: (done: number, total: number) => void
): Promise<BackfillResult> {
  const { data, error } = await supabase
    .from('scans')
    .select('deck_id, deck_code, deck_uuid')
    .is('deck_name', null)

  if (error) throw new Error(`Failed to load nameless scans: ${error.message}`)

  // Many rows can share a deck; fetch each unique deck's name only once
  const uniqueDecks = new Map<string, { deckCode: string | null; deckUuid: string | null }>()
  for (const row of data ?? []) {
    if (!uniqueDecks.has(row.deck_id)) {
      uniqueDecks.set(row.deck_id, { deckCode: row.deck_code, deckUuid: row.deck_uuid })
    }
  }

  let updated = 0
  let remaining = (data ?? []).length
  let done = 0

  for (const [deckId, deck] of uniqueDecks) {
    const name = await fetchDeckName(deck)

    if (name !== null) {
      const { count, error: updateError } = await supabase
        .from('scans')
        .update({ deck_name: name }, { count: 'exact' })
        .eq('deck_id', deckId)
        .is('deck_name', null)

      if (updateError) {
        throw new Error(`Failed to update deck name: ${updateError.message}`)
      }
      updated += count ?? 0
      remaining -= count ?? 0
    }

    done++
    onProgress?.(done, uniqueDecks.size)

    // Be polite to the API between lookups
    if (done < uniqueDecks.size) {
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
  }

  return { updated, remaining }
}

/**
 * Export every scan (full history) as a flat CSV string
 */
export async function exportScansCsv(): Promise<string> {
  const { data, error } = await supabase
    .from('scans')
    .select('scanned_at, deck_id, deck_code, deck_uuid, deck_name, position, labels(name)')
    .order('scanned_at', { ascending: true })

  if (error) throw new Error(`Export failed: ${error.message}`)

  const escape = (value: string | number | null): string => {
    if (value === null || value === undefined) return ''
    const str = String(value)
    return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
  }

  const header = 'scanned_at,label,position,deck_name,deck_id,deck_code,deck_uuid'
  const rows = (data ?? []).map((row) => {
    // labels(name) is a many-to-one join: supabase-js types it loosely
    const label = (row.labels as unknown as { name: string } | null)?.name ?? ''
    return [
      row.scanned_at,
      label,
      row.position,
      row.deck_name,
      row.deck_id,
      row.deck_code,
      row.deck_uuid,
    ].map(escape).join(',')
  })

  return [header, ...rows].join('\r\n')
}

/**
 * Delete the current user's account and all their data (via the
 * delete_account database function). Irreversible.
 */
export async function deleteAccount(): Promise<void> {
  const { error } = await supabase.rpc('delete_account')
  if (error) throw new Error(`Account deletion failed: ${error.message}`)
}

/**
 * Search decks by name; returns each deck's most recent location
 */
export async function searchDecks(query: string): Promise<DeckLocation[]> {
  const { data, error } = await supabase
    .from('current_deck_locations')
    .select('scan_id, deck_id, deck_name, deck_code, deck_uuid, label, position, scanned_at')
    .ilike('deck_name', `%${query}%`)
    .order('deck_name')
    .limit(50)

  if (error) throw new Error(`Search failed: ${error.message}`)
  return data ?? []
}

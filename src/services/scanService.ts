/**
 * Supabase data access for scans, labels, and search
 */

import { supabase } from '../lib/supabase'

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

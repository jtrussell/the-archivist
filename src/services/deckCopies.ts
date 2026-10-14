/**
 * Group a deck's current-location rows into physical copies.
 *
 * The view yields one row per scanned identifier (deck_id). A deck has exactly
 * one original, so every non-clone identifier (its code, its uuid-URL form)
 * collapses into a single "Original" copy whose current location is its most
 * recent scan. Each clone code is its own copy. Pure; no I/O.
 */

import type { DeckLocation } from './scanService'

export interface DeckCopy {
  /** Stable key: the deck_id of the copy's most recent scan */
  key: string
  kind: 'original' | 'clone'
  /** Printed code when known (clone codes always; originals only if scanned as a code) */
  code: string | null
  /** Every scanned identifier folded into this copy */
  deckIds: string[]
  /** Most recent scan across those identifiers (current location) */
  current: DeckLocation
}

const byNewest = (a: DeckLocation, b: DeckLocation) =>
  new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime()

export function groupDeckCopies(rows: DeckLocation[]): DeckCopy[] {
  const originals = rows.filter((row) => !row.is_clone).sort(byNewest)
  const clones = rows.filter((row) => row.is_clone).sort(byNewest)

  const copies: DeckCopy[] = []

  if (originals.length > 0) {
    const current = originals[0]
    copies.push({
      key: current.deck_id,
      kind: 'original',
      code: originals.find((row) => row.deck_code !== null)?.deck_code ?? null,
      deckIds: originals.map((row) => row.deck_id),
      current,
    })
  }

  const cloneCopies = clones.map<DeckCopy>((row) => ({
    key: row.deck_id,
    kind: 'clone',
    code: row.deck_code ?? row.deck_id,
    deckIds: [row.deck_id],
    current: row,
  }))
  cloneCopies.sort((a, b) => (a.code ?? '').localeCompare(b.code ?? ''))

  return [...copies, ...cloneCopies]
}

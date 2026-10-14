import { describe, expect, it } from 'vitest'
import { groupDeckCopies } from './deckCopies'
import type { DeckLocation } from './scanService'

const row = (overrides: Partial<DeckLocation>): DeckLocation => ({
  scan_id: 'scan',
  deck_id: 'ID',
  deck_name: 'Deck',
  deck_code: null,
  deck_uuid: null,
  deck_ref: 'ref',
  mv_id: null,
  set_id: null,
  label: 'Box',
  position: 1,
  scanned_at: '2026-01-01T00:00:00Z',
  is_clone: false,
  name_source: 'api',
  mv_status: 'pending',
  ...overrides,
})

describe('groupDeckCopies', () => {
  it('returns nothing for no rows', () => {
    expect(groupDeckCopies([])).toEqual([])
  })

  it('folds every non-clone identifier into one Original copy, newest scan current', () => {
    const asCode = row({
      deck_id: '3JV94-353M2-W5JX8',
      deck_code: '3JV94-353M2-W5JX8',
      label: 'Box A',
      scanned_at: '2026-01-01T00:00:00Z',
    })
    const asUrl = row({
      deck_id: 'uuid-form',
      deck_uuid: 'uuid-form',
      label: 'Box B',
      scanned_at: '2026-02-01T00:00:00Z',
    })

    const copies = groupDeckCopies([asCode, asUrl])
    expect(copies).toHaveLength(1)
    expect(copies[0]).toMatchObject({
      kind: 'original',
      key: 'uuid-form',
      code: '3JV94-353M2-W5JX8',
      deckIds: ['uuid-form', '3JV94-353M2-W5JX8'],
    })
    expect(copies[0].current.label).toBe('Box B')
  })

  it('keeps each clone as its own copy, after the original, sorted by code', () => {
    const original = row({ deck_id: '3JV94-353M2-W5JX8', deck_code: '3JV94-353M2-W5JX8' })
    const cloneB = row({ deck_id: 'C-BBBBB-22222-33333', deck_code: 'C-BBBBB-22222-33333', is_clone: true, label: 'Shelf 2' })
    const cloneA = row({ deck_id: 'C-AAAAA-22222-33333', deck_code: 'C-AAAAA-22222-33333', is_clone: true, label: 'Shelf 1' })

    const copies = groupDeckCopies([cloneB, original, cloneA])
    expect(copies.map((c) => [c.kind, c.key])).toEqual([
      ['original', '3JV94-353M2-W5JX8'],
      ['clone', 'C-AAAAA-22222-33333'],
      ['clone', 'C-BBBBB-22222-33333'],
    ])
    expect(copies[1].current.label).toBe('Shelf 1')
    expect(copies[1].deckIds).toEqual(['C-AAAAA-22222-33333'])
  })

  it('handles a clone encountered before its original (no Original copy yet)', () => {
    const clone = row({ deck_id: 'C-AAAAA-22222-33333', deck_code: 'C-AAAAA-22222-33333', is_clone: true, deck_name: null })
    const copies = groupDeckCopies([clone])
    expect(copies).toHaveLength(1)
    expect(copies[0].kind).toBe('clone')
  })
})

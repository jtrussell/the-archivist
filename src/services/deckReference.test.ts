import { describe, expect, it } from 'vitest'
import { classifyDeckReference } from './deckReference'

const UUID = '839877a5-b959-4509-93d0-2d0a385327b1'

describe('classifyDeckReference', () => {
  it('treats blank input as empty', () => {
    expect(classifyDeckReference('   ')).toEqual({ kind: 'empty' })
  })

  it('extracts a Master Vault id from MV links, DoK links, and bare uuids', () => {
    const expected = { kind: 'mv-id', mvId: UUID }
    expect(classifyDeckReference(`https://www.keyforgegame.com/deck-details/${UUID}`)).toEqual(expected)
    expect(classifyDeckReference(`https://www.keyforgegame.com/deck-details/${UUID}?foo=1`)).toEqual(expected)
    expect(classifyDeckReference(`https://decksofkeyforge.com/decks/${UUID}`)).toEqual(expected)
    expect(classifyDeckReference(UUID.toUpperCase())).toEqual(expected)
  })

  it('classifies original codes, bare or inside a /deck/ link', () => {
    expect(classifyDeckReference('3jv94-353m2-w5jx8')).toEqual({ kind: 'code', code: '3JV94-353M2-W5JX8' })
    expect(classifyDeckReference('https://www.keyforgegame.com/deck/3JV94-353M2-W5JX8')).toEqual({
      kind: 'code',
      code: '3JV94-353M2-W5JX8',
    })
  })

  it('flags clone codes so the UI can explain they cannot be looked up', () => {
    expect(classifyDeckReference('c-4wrxv-2w247-6qm7w')).toEqual({
      kind: 'clone-code',
      code: 'C-4WRXV-2W247-6QM7W',
    })
  })

  it('falls back to a name search for anything else', () => {
    expect(classifyDeckReference('  Lòrien il Puro, Ministro dell’Olio ')).toEqual({
      kind: 'name',
      name: 'Lòrien il Puro, Ministro dell’Olio',
    })
    expect(classifyDeckReference('3JV94-353M2')).toEqual({ kind: 'name', name: '3JV94-353M2' })
  })
})

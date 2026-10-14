import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchDeckByMasterVaultId,
  fetchDeckName,
  isCloneCode,
  parseQrData,
  searchMasterVaultByName,
} from './deckTransform'

const ORIGINAL = '3JV94-353M2-W5JX8'
const CLONE = 'C-4WRXV-2W247-6QM7W'
const UUID = '839877a5-b959-4509-93d0-2d0a385327b1'

describe('parseQrData', () => {
  it('parses an original deck code', () => {
    expect(parseQrData(ORIGINAL)).toEqual({
      deckId: ORIGINAL,
      deckCode: ORIGINAL,
      deckUuid: null,
      isClone: false,
    })
  })

  it('parses a clone code, keeping the C- prefix as the identity', () => {
    expect(parseQrData(CLONE)).toEqual({
      deckId: CLONE,
      deckCode: CLONE,
      deckUuid: null,
      isClone: true,
    })
  })

  it('normalizes case and whitespace for both forms', () => {
    expect(parseQrData('  c-4wrxv-2w247-6qm7w \n').deckId).toBe(CLONE)
    expect(parseQrData('3jv94-353m2-w5jx8').deckId).toBe(ORIGINAL)
  })

  it('a clone code never collides with the original code', () => {
    expect(parseQrData(CLONE).deckId).not.toBe(parseQrData(ORIGINAL).deckId)
    expect(parseQrData(`C-${ORIGINAL}`).deckId).toBe(`C-${ORIGINAL}`)
  })

  it('parses deck-details URLs to a uuid', () => {
    const parsed = parseQrData(`https://www.keyforgegame.com/deck-details/${UUID.toUpperCase()}`)
    expect(parsed).toEqual({ deckId: UUID, deckCode: null, deckUuid: UUID, isClone: false })
  })

  it('parses /deck/{code} URLs for originals and clones', () => {
    expect(parseQrData(`https://www.keyforgegame.com/deck/${ORIGINAL}`).isClone).toBe(false)
    const clone = parseQrData(`https://www.keyforgegame.com/deck/${CLONE.toLowerCase()}`)
    expect(clone.isClone).toBe(true)
    expect(clone.deckId).toBe(CLONE)
  })

  it('rejects malformed input', () => {
    for (const bad of ['', 'hello', '3JV94-353M2', 'X-3JV94-353M2-W5JX8', 'C-4WRXV-2W247-6QM7W7', 'CC-4WRXV-2W247-6QM7W']) {
      expect(() => parseQrData(bad)).toThrow('Not a recognized KeyForge deck QR code')
    }
  })
})

describe('isCloneCode', () => {
  it('recognizes C- prefixed codes only', () => {
    expect(isCloneCode(CLONE)).toBe(true)
    expect(isCloneCode(CLONE.toLowerCase())).toBe(true)
    expect(isCloneCode(ORIGINAL)).toBe(false)
    expect(isCloneCode(UUID)).toBe(false)
  })
})

describe('Master Vault fetches', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const respond = (status: number, body: unknown) =>
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })

  it('fetchDeckName never calls the API for a clone code', async () => {
    const fetchMock = respond(200, { name: 'should not be used' })
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchDeckName({ deckCode: CLONE, deckUuid: null })).resolves.toBeNull()
    await expect(fetchDeckName({ deckCode: ORIGINAL, deckUuid: null, isClone: true })).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetchDeckName reads the code endpoint shape', async () => {
    vi.stubGlobal('fetch', respond(200, { name: 'Lòrien il Puro', expansion: 435 }))
    await expect(fetchDeckName({ deckCode: ORIGINAL, deckUuid: null })).resolves.toBe('Lòrien il Puro')
  })

  it('fetchDeckByMasterVaultId hydrates name, id and set from the by-id envelope', async () => {
    const fetchMock = respond(200, { data: { id: UUID, name: 'Z. Peters', expansion: 452 } })
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchDeckByMasterVaultId(UUID.toUpperCase())).resolves.toEqual({
      mvId: UUID,
      name: 'Z. Peters',
      setId: 452,
    })
    expect(fetchMock.mock.calls[0][0]).toBe(`https://www.keyforgegame.com/api/decks/${UUID}/`)
  })

  it('fetchDeckByMasterVaultId returns null for an unknown id or a network failure', async () => {
    vi.stubGlobal('fetch', respond(404, { detail: 'Internal server error' }))
    await expect(fetchDeckByMasterVaultId(UUID)).resolves.toBeNull()

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(fetchDeckByMasterVaultId(UUID)).resolves.toBeNull()
  })

  it('searchMasterVaultByName maps candidates and drops malformed ones', async () => {
    vi.stubGlobal(
      'fetch',
      respond(200, {
        data: [
          { id: UUID, name: 'Z. Peters', expansion: { set_id: 452, name: 'Worlds Collide' } },
          { id: '', name: 'no id' },
          { id: 'x', name: 42 },
        ],
      })
    )
    await expect(searchMasterVaultByName('Peters')).resolves.toEqual([
      { mvId: UUID, name: 'Z. Peters', setId: 452, expansionName: 'Worlds Collide' },
    ])
  })
})

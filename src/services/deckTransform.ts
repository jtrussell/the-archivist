/**
 * Parse KeyForge QR data and look up deck details from the Master Vault API.
 *
 * QR codes come in these forms:
 *  - URL:  https://www.keyforgegame.com/deck-details/{uuid}
 *  - URL (earlier printings): https://www.keyforgegame.com/deck/{code}
 *  - Code: 4Q958-HX64G-JH6P9
 *  - Clone code: C-4WRXV-2W247-6QM7W
 *
 * Ghost Galaxy "deck clones" are reprints of a deck that share the original's
 * Master Vault record but carry their own code with a `C-` prefix. The public
 * API cannot resolve a clone code (it 404s exactly like an unknown code), so a
 * clone is recorded nameless and later attached to its original by the user.
 */

export interface ParsedDeck {
  /**
   * Canonical identifier for this physical copy: master-vault uuid if the QR was
   * a URL, else the uppercased deck code (clones keep their C- prefix so they
   * never collide with the original's code).
   */
  deckId: string
  deckCode: string | null
  deckUuid: string | null
  deckName: string | null
  /** True for a Ghost Galaxy deck clone (C- prefixed code) */
  isClone: boolean
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const CODE = '[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}'

const DECK_URL_PATTERN = new RegExp(`keyforgegame\\.com/deck-details/(${UUID})`, 'i')
const DECK_CODE_URL_PATTERN = new RegExp(`keyforgegame\\.com/deck/((?:C-)?${CODE})`, 'i')
const DECK_CODE_PATTERN = new RegExp(`^${CODE}$`)
const CLONE_CODE_PATTERN = new RegExp(`^C-${CODE}$`)

const API_BASE = 'https://www.keyforgegame.com/api'
const NAME_FETCH_TIMEOUT_MS = 5000

export function isCloneCode(code: string): boolean {
  return CLONE_CODE_PATTERN.test(code.trim().toUpperCase())
}

/**
 * Extract the deck identifier from raw QR data.
 * Throws if the data doesn't look like a KeyForge deck.
 */
export function parseQrData(qrData: string): Omit<ParsedDeck, 'deckName'> {
  const trimmed = qrData.trim()

  const urlMatch = trimmed.match(DECK_URL_PATTERN)
  if (urlMatch) {
    const uuid = urlMatch[1].toLowerCase()
    return { deckId: uuid, deckCode: null, deckUuid: uuid, isClone: false }
  }

  const codeUrlMatch = trimmed.match(DECK_CODE_URL_PATTERN)
  const code = (codeUrlMatch ? codeUrlMatch[1] : trimmed).toUpperCase()

  if (CLONE_CODE_PATTERN.test(code)) {
    return { deckId: code, deckCode: code, deckUuid: null, isClone: true }
  }
  if (DECK_CODE_PATTERN.test(code)) {
    return { deckId: code, deckCode: code, deckUuid: null, isClone: false }
  }

  throw new Error('Not a recognized KeyForge deck QR code')
}

/**
 * Fetch the deck name from the Master Vault API.
 * Returns null on any failure (offline, timeout, unexpected shape) and, without
 * making a request, for clone codes (the API cannot resolve them).
 */
export async function fetchDeckName(
  deck: Pick<ParsedDeck, 'deckCode' | 'deckUuid'> & { isClone?: boolean }
): Promise<string | null> {
  if (deck.isClone || (deck.deckCode !== null && isCloneCode(deck.deckCode))) return null

  const url = deck.deckUuid
    ? `${API_BASE}/decks/${deck.deckUuid}/`
    : `${API_BASE}/decks/codes/${deck.deckCode}/`

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(NAME_FETCH_TIMEOUT_MS),
    })
    if (!response.ok) return null

    const json = await response.json()
    const name = json?.name ?? json?.data?.name
    return typeof name === 'string' && name.length > 0 ? name : null
  } catch {
    return null
  }
}

export interface MasterVaultDeckInfo {
  mvId: string
  setId: number | null
}

export interface MasterVaultDeck extends MasterVaultDeckInfo {
  name: string
}

/**
 * Fetch a deck straight from the Master Vault by its id (the uuid in a
 * deck-details URL). This is the authoritative hydration path for the manual
 * escape hatch. Returns null when the id is unknown or the request fails.
 */
export async function fetchDeckByMasterVaultId(mvId: string): Promise<MasterVaultDeck | null> {
  try {
    const response = await fetch(`${API_BASE}/decks/${mvId.toLowerCase()}/`, {
      signal: AbortSignal.timeout(NAME_FETCH_TIMEOUT_MS),
    })
    if (!response.ok) return null

    const json = await response.json()
    const data = json?.data ?? json
    const name = data?.name
    if (typeof name !== 'string' || name.length === 0) return null

    const id = typeof data?.id === 'string' && data.id.length > 0 ? data.id : mvId.toLowerCase()
    const expansion = data?.expansion
    const setId =
      typeof expansion === 'number'
        ? expansion
        : typeof expansion?.set_id === 'number'
          ? expansion.set_id
          : null

    return { mvId: id, setId, name }
  } catch {
    return null
  }
}

const EXPLORE_SEARCH_TIMEOUT_MS = 10000

export interface MasterVaultSearchResult extends MasterVaultDeck {
  expansionName: string | null
}

/**
 * Search the Master Vault by deck name. Returns the candidates (up to 10) so a
 * user can pick the right one; see fetchDeckMasterVaultInfo for exact matching.
 */
export async function searchMasterVaultByName(
  deckName: string
): Promise<MasterVaultSearchResult[]> {
  const params = new URLSearchParams({ page: '1', page_size: '10', search: deckName })

  try {
    const response = await fetch(`${API_BASE}/decks/explore/?${params}`, {
      signal: AbortSignal.timeout(EXPLORE_SEARCH_TIMEOUT_MS),
    })
    if (!response.ok) return []

    const json = await response.json()
    const candidates: {
      id?: unknown
      name?: unknown
      expansion?: { set_id?: unknown; name?: unknown }
    }[] = Array.isArray(json?.data) ? json.data : []

    return candidates.flatMap((candidate) => {
      if (typeof candidate.id !== 'string' || candidate.id.length === 0) return []
      if (typeof candidate.name !== 'string' || candidate.name.length === 0) return []
      return [
        {
          mvId: candidate.id,
          name: candidate.name,
          setId: typeof candidate.expansion?.set_id === 'number' ? candidate.expansion.set_id : null,
          expansionName:
            typeof candidate.expansion?.name === 'string' ? candidate.expansion.name : null,
        },
      ]
    })
  } catch {
    return []
  }
}

/**
 * Resolve a deck's Master Vault id by exact (case-insensitive) name match.
 */
export async function fetchDeckMasterVaultInfo(
  deckName: string
): Promise<MasterVaultDeckInfo | null> {
  const wantedName = deckName.trim().toLowerCase()
  const candidates = await searchMasterVaultByName(deckName)
  const match = candidates.find((candidate) => candidate.name.trim().toLowerCase() === wantedName)
  return match ? { mvId: match.mvId, setId: match.setId } : null
}

/**
 * Parse QR data and enrich with the deck name (best-effort).
 */
export async function parseAndFetchDeck(qrData: string): Promise<ParsedDeck> {
  const parsed = parseQrData(qrData)
  const deckName = navigator.onLine ? await fetchDeckName(parsed) : null
  return { ...parsed, deckName }
}

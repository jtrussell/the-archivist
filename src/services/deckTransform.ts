/**
 * Parse KeyForge QR data and look up deck names from the Master Vault API.
 *
 * QR codes come in three forms:
 *  - URL:  https://www.keyforgegame.com/deck-details/{uuid}
 *  - URL (earlier printings): https://www.keyforgegame.com/deck/{code}
 *  - Code: 4Q958-HX64G-JH6P9
 */

export interface ParsedDeck {
  /** Canonical identifier: master-vault uuid if QR was a URL, else uppercased deck code */
  deckId: string
  deckCode: string | null
  deckUuid: string | null
  deckName: string | null
}

const DECK_URL_PATTERN = /keyforgegame\.com\/deck-details\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
const DECK_CODE_URL_PATTERN = /keyforgegame\.com\/deck\/([A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5})/i
const DECK_CODE_PATTERN = /^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/

const API_BASE = 'https://www.keyforgegame.com/api'
const NAME_FETCH_TIMEOUT_MS = 5000

/**
 * Extract the deck identifier from raw QR data.
 * Throws if the data doesn't look like a KeyForge deck.
 */
export function parseQrData(qrData: string): Omit<ParsedDeck, 'deckName'> {
  const trimmed = qrData.trim()

  const urlMatch = trimmed.match(DECK_URL_PATTERN)
  if (urlMatch) {
    const uuid = urlMatch[1].toLowerCase()
    return { deckId: uuid, deckCode: null, deckUuid: uuid }
  }

  const codeUrlMatch = trimmed.match(DECK_CODE_URL_PATTERN)
  if (codeUrlMatch) {
    const code = codeUrlMatch[1].toUpperCase()
    return { deckId: code, deckCode: code, deckUuid: null }
  }

  const code = trimmed.toUpperCase()
  if (DECK_CODE_PATTERN.test(code)) {
    return { deckId: code, deckCode: code, deckUuid: null }
  }

  throw new Error('Not a recognized KeyForge deck QR code')
}

/**
 * Fetch the deck name from the Master Vault API.
 * Returns null on any failure (offline, timeout, unexpected shape).
 */
export async function fetchDeckName(
  deck: Pick<ParsedDeck, 'deckCode' | 'deckUuid'>
): Promise<string | null> {
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

/**
 * Parse QR data and enrich with the deck name (best-effort).
 */
export async function parseAndFetchDeck(qrData: string): Promise<ParsedDeck> {
  const parsed = parseQrData(qrData)
  const deckName = navigator.onLine ? await fetchDeckName(parsed) : null
  return { ...parsed, deckName }
}

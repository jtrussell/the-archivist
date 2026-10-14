/**
 * Classify free-text input from the "fix deck details" escape hatch.
 *
 * Users may paste a Master Vault link, a Decks of KeyForge link, a bare uuid, a
 * printed deck code (original or clone), or just type a name. Pure; no I/O.
 */

export type DeckReference =
  | { kind: 'mv-id'; mvId: string }
  | { kind: 'code'; code: string }
  | { kind: 'clone-code'; code: string }
  | { kind: 'name'; name: string }
  | { kind: 'empty' }

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const CODE = '[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}'

const MV_URL = new RegExp(`keyforgegame\\.com/deck-details/(${UUID})`, 'i')
const DOK_URL = new RegExp(`decksofkeyforge\\.com/decks/(${UUID})`, 'i')
const BARE_UUID = new RegExp(`^${UUID}$`, 'i')
const CODE_URL = new RegExp(`keyforgegame\\.com/deck/((?:C-)?${CODE})`, 'i')
const BARE_CODE = new RegExp(`^${CODE}$`, 'i')
const BARE_CLONE_CODE = new RegExp(`^C-${CODE}$`, 'i')

export function classifyDeckReference(input: string): DeckReference {
  const trimmed = input.trim()
  if (trimmed === '') return { kind: 'empty' }

  const mv = trimmed.match(MV_URL) ?? trimmed.match(DOK_URL) ?? trimmed.match(BARE_UUID)
  if (mv) return { kind: 'mv-id', mvId: (mv[1] ?? mv[0]).toLowerCase() }

  const codeUrl = trimmed.match(CODE_URL)
  const candidate = (codeUrl ? codeUrl[1] : trimmed).toUpperCase()
  if (BARE_CLONE_CODE.test(candidate)) return { kind: 'clone-code', code: candidate }
  if (BARE_CODE.test(candidate)) return { kind: 'code', code: candidate }

  return { kind: 'name', name: trimmed }
}

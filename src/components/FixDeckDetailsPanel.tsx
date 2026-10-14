import { useState } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { QRScanner } from './QRScanner'
import { classifyDeckReference } from '../services/deckReference'
import {
  fetchDeckByMasterVaultId,
  fetchDeckMasterVaultInfo,
  fetchDeckName,
  parseQrData,
  searchMasterVaultByName,
  MasterVaultSearchResult,
} from '../services/deckTransform'
import {
  attachScansToDeck,
  searchDecks,
  setDeckName,
  DeckLocation,
} from '../services/scanService'

/**
 * The manual escape hatch for a copy the API couldn't name (a clone code, or an
 * unregistered original). Three ways in, all resolving client-side before the
 * database is touched:
 *
 *   - paste a Master Vault / DoK link or uuid  -> hydrated by id (authoritative)
 *   - type / paste the original's code         -> name by code, then id by name
 *   - type a name                              -> pick a Master Vault match,
 *                                                 pick a deck from your own
 *                                                 collection, or keep the name
 *   - scan the original's QR                   -> same as the two above
 *
 * Linking only ever moves the caller's own scans; a typed name only lands on
 * the caller's own rows. Clobber protection lives in the database RPCs.
 */

interface Candidate {
  mvId: string
  name: string
  setId: number | null
  expansionName: string | null
}

interface OwnDeck {
  deckRef: string
  name: string
  label: string
  position: number
}

interface Props {
  /** Scanned identifiers (deck_ids) the fix applies to */
  deckIds: string[]
  /** The deck row those copies belong to now (excluded from own-collection picks) */
  currentDeckRef: string
  /** How to refer to the thing being fixed, e.g. "this clone" */
  subject: string
  onLinked: () => void
  onCancel?: () => void
}

export function FixDeckDetailsPanel({ deckIds, currentDeckRef, subject, onLinked, onCancel }: Props) {
  const [input, setInput] = useState('')
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [ownDecks, setOwnDecks] = useState<OwnDeck[]>([])
  const [nameFallback, setNameFallback] = useState<string | null>(null)

  const reset = () => {
    setMessage(null)
    setCandidates([])
    setOwnDecks([])
    setNameFallback(null)
  }

  const lookup = async (raw: string) => {
    reset()
    const ref = classifyDeckReference(raw)
    if (ref.kind === 'empty') return

    setBusy(true)
    try {
      switch (ref.kind) {
        case 'clone-code':
          setMessage(
            'That is a clone code, which the Master Vault cannot look up. ' +
              "Paste the original's code or Master Vault link, or search by name."
          )
          break

        case 'mv-id': {
          const deck = await fetchDeckByMasterVaultId(ref.mvId)
          if (deck === null) {
            setMessage('No Master Vault deck found for that link or id.')
          } else {
            setCandidates([{ ...deck, expansionName: null }])
          }
          break
        }

        case 'code': {
          const name = await fetchDeckName({ deckCode: ref.code, deckUuid: null })
          if (name === null) {
            setMessage('The Master Vault returned nothing for that code. It may not be registered yet.')
            break
          }
          const info = await fetchDeckMasterVaultInfo(name)
          if (info === null) {
            setMessage(`Found the name "${name}" but no Master Vault record to link. You can keep the name.`)
            setNameFallback(name)
          } else {
            setCandidates([{ mvId: info.mvId, setId: info.setId, name, expansionName: null }])
          }
          break
        }

        case 'name': {
          const [results, own] = await Promise.all([
            searchMasterVaultByName(ref.name),
            searchDecks(ref.name, 0, { pageSize: 8 }),
          ])
          setCandidates(results.map(toCandidate))
          setOwnDecks(dedupeOwnDecks(own.decks, currentDeckRef))
          setNameFallback(ref.name)
          if (results.length === 0 && own.decks.length === 0) {
            setMessage('No Master Vault or collection matches. You can still keep the name as typed.')
          }
          break
        }
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Lookup failed')
    } finally {
      setBusy(false)
    }
  }

  const handleScan = (qrData: string) => {
    setScanning(false)
    try {
      const parsed = parseQrData(qrData)
      const text = parsed.deckUuid ?? parsed.deckCode ?? ''
      setInput(text)
      void lookup(text)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unrecognized QR code')
    }
  }

  const linkToMasterVault = async (candidate: Candidate) => {
    setBusy(true)
    setMessage(null)
    try {
      for (const deckId of deckIds) {
        await attachScansToDeck(deckId, {
          mvId: candidate.mvId,
          setId: candidate.setId,
          name: candidate.name,
        })
      }
      onLinked()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Linking failed')
      setBusy(false)
    }
  }

  const linkToOwnDeck = async (deck: OwnDeck) => {
    setBusy(true)
    setMessage(null)
    try {
      for (const deckId of deckIds) {
        await attachScansToDeck(deckId, { targetDeckRef: deck.deckRef })
      }
      onLinked()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Linking failed')
      setBusy(false)
    }
  }

  const keepName = async (name: string, source: 'api' | 'manual') => {
    setBusy(true)
    setMessage(null)
    try {
      for (const deckId of deckIds) {
        await setDeckName(deckId, name, source)
      }
      onLinked()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Saving the name failed')
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 p-3 border border-yellow-500 rounded-md space-y-3">
      <div>
        <p className="text-sm font-medium">Fix deck details</p>
        <p className="text-sm text-muted-foreground">
          Tell us which deck {subject} is: paste a Master Vault link, the original&apos;s deck
          code, or a name.
        </p>
      </div>

      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault()
          void lookup(input)
        }}
      >
        <Input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Master Vault link, deck code, or name"
          disabled={busy}
          aria-label="Deck reference"
        />
        <div className="flex gap-2">
          <Button type="submit" variant="outline" disabled={busy || input.trim() === ''}>
            {busy ? 'Looking up...' : 'Look up'}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setScanning((current) => !current)}
          >
            {scanning ? 'Close camera' : 'Scan original'}
          </Button>
        </div>
      </form>

      {scanning && (
        <QRScanner
          onScan={handleScan}
          onError={(err) => setMessage(err.message)}
          feedback={null}
        />
      )}

      {message && <p className="text-sm text-yellow-200">{message}</p>}

      {candidates.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Master Vault</p>
          {candidates.map((candidate) => (
            <div
              key={candidate.mvId}
              className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between p-2 border rounded-md"
            >
              <div className="min-w-0">
                <p className="font-medium break-words">{candidate.name}</p>
                {candidate.expansionName && (
                  <p className="text-sm text-muted-foreground">{candidate.expansionName}</p>
                )}
              </div>
              <Button size="sm" disabled={busy} onClick={() => void linkToMasterVault(candidate)}>
                Link
              </Button>
            </div>
          ))}
        </div>
      )}

      {ownDecks.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">In your collection</p>
          {ownDecks.map((deck) => (
            <div
              key={deck.deckRef}
              className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between p-2 border rounded-md"
            >
              <div className="min-w-0">
                <p className="font-medium break-words">{deck.name}</p>
                <p className="text-sm text-muted-foreground">
                  {deck.label} &middot; Position {deck.position}
                </p>
              </div>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void linkToOwnDeck(deck)}>
                Link
              </Button>
            </div>
          ))}
        </div>
      )}

      {nameFallback && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between p-2 border border-dashed rounded-md">
          <p className="text-sm text-muted-foreground">
            Keep the name &ldquo;{nameFallback}&rdquo; without a Master Vault link
          </p>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void keepName(nameFallback, candidates.length === 0 && classifyDeckReference(input).kind === 'code' ? 'api' : 'manual')}
          >
            Use name only
          </Button>
        </div>
      )}

      {onCancel && (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}

const toCandidate = (result: MasterVaultSearchResult): Candidate => ({
  mvId: result.mvId,
  name: result.name,
  setId: result.setId,
  expansionName: result.expansionName,
})

function dedupeOwnDecks(rows: DeckLocation[], excludeDeckRef: string): OwnDeck[] {
  const seen = new Set<string>()
  const result: OwnDeck[] = []
  for (const row of rows) {
    if (row.deck_ref === null || row.deck_ref === excludeDeckRef || row.deck_name === null) continue
    if (seen.has(row.deck_ref)) continue
    seen.add(row.deck_ref)
    result.push({ deckRef: row.deck_ref, name: row.deck_name, label: row.label, position: row.position })
  }
  return result
}

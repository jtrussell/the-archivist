import { useState, useEffect } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'
import { DeckNoteCard } from './DeckNoteCard'
import {
  getDeckByScanId,
  getDeckHistory,
  backfillSingleDeckName,
  backfillDeckMasterVaultInfo,
  DeckLocation,
  DeckScanRecord,
} from '../services/scanService'

const MASTER_VAULT_DECK_URL = 'https://www.keyforgegame.com/deck-details'
const DOK_DECK_URL = 'https://decksofkeyforge.com/decks'

/**
 * Routed deck detail page for /deck/:scanId.
 *
 * The URL carries only the opaque scan id. When we arrive from the search list
 * the deck is handed over via router state (no round-trip); on a cold load or a
 * shared/refreshed link we resolve it from the id. Anything that can't resolve
 * — a foreign id, a deleted deck — lands on the not-found state.
 */
export function DeckDetailView() {
  const { scanId } = useParams<{ scanId: string }>()
  const location = useLocation()
  const navigate = useNavigate()

  const passedDeck = (location.state as { deck?: DeckLocation } | null)?.deck ?? null
  const [deck, setDeck] = useState<DeckLocation | null>(passedDeck)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Only the cold path (no handoff) needs to fetch before we can render
  const [loading, setLoading] = useState(passedDeck === null)

  useEffect(() => {
    if (passedDeck || !scanId) return

    let cancelled = false
    setLoading(true)
    getDeckByScanId(scanId)
      .then((result) => {
        if (cancelled) return
        setDeck(result)
        setLoadError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : 'Failed to load deck')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [scanId, passedDeck])

  const goBack = () => navigate('/search')

  const applyDeckUpdates = (deckId: string, updates: Partial<DeckLocation>) => {
    setDeck((current) =>
      current && current.deck_id === deckId ? { ...current, ...updates } : current
    )
  }

  if (loading) {
    return (
      <div className="space-y-6 max-w-2xl mx-auto">
        <Button variant="ghost" onClick={goBack}>
          &larr; Back to results
        </Button>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (loadError || !deck) {
    return (
      <div className="space-y-6 max-w-2xl mx-auto">
        <Button variant="ghost" onClick={goBack}>
          &larr; Back to results
        </Button>
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-center text-destructive">
              {loadError ?? 'This deck could not be found.'}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return <DeckDetail deck={deck} onBack={goBack} onDeckUpdated={applyDeckUpdates} />
}

function DeckDetail({
  deck,
  onBack,
  onDeckUpdated,
}: {
  deck: DeckLocation
  onBack: () => void
  onDeckUpdated: (deckId: string, updates: Partial<DeckLocation>) => void
}) {
  const [history, setHistory] = useState<DeckScanRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [retryMessage, setRetryMessage] = useState<string | null>(null)
  const [mvLookupPending, setMvLookupPending] = useState(false)
  const [mvInfo, setMvInfo] = useState<{ mvId: string; setId: number | null } | null>(
    deck.mv_id !== null ? { mvId: deck.mv_id, setId: deck.set_id } : null
  )

  const displayName = deck.deck_name ?? deck.deck_id
  const nameIsMissing = deck.deck_name === null || deck.deck_name === deck.deck_id

  useEffect(() => {
    getDeckHistory(deck.deck_id)
      .then(setHistory)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load history'))
  }, [deck.deck_id])

  useEffect(() => {
    if (mvInfo !== null || deck.deck_name === null || nameIsMissing) return

    let cancelled = false
    setMvLookupPending(true)
    backfillDeckMasterVaultInfo(deck)
      .then((info) => {
        if (cancelled || info === null) return
        setMvInfo(info)
        onDeckUpdated(deck.deck_id, { mv_id: info.mvId, set_id: info.setId })
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setMvLookupPending(false)
      })

    return () => {
      cancelled = true
    }
  }, [deck.deck_id, deck.deck_name, mvInfo])

  const copyDeckName = async () => {
    try {
      await navigator.clipboard.writeText(displayName)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  const retryNameLookup = async () => {
    setRetrying(true)
    setRetryMessage(null)
    try {
      const name = await backfillSingleDeckName(deck)
      if (name === null) {
        setRetryMessage('Still no name found. This deck may not be registered in the Master Vault yet.')
      } else {
        onDeckUpdated(deck.deck_id, { deck_name: name })
      }
    } catch (err) {
      setRetryMessage(err instanceof Error ? err.message : 'Name lookup failed')
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <Button variant="ghost" onClick={onBack}>
        &larr; Back to results
      </Button>

      <Card>
        <CardContent className="pt-6">
          <button
            type="button"
            onClick={copyDeckName}
            aria-label="Copy deck name"
            className="flex items-start gap-2 text-left"
          >
            <span className="text-lg font-semibold break-words min-w-0">{displayName}</span>
            <span className="shrink-0 mt-1.5" aria-hidden="true">
              {copied ? (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-green-500"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-muted-foreground"
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </span>
          </button>
          {mvInfo !== null && (
            <div className="mt-3 flex gap-4">
              <a
                href={`${MASTER_VAULT_DECK_URL}/${mvInfo.mvId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary underline underline-offset-4"
              >
                Master Vault ↗
              </a>
              <a
                href={`${DOK_DECK_URL}/${mvInfo.mvId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary underline underline-offset-4"
              >
                Decks of KeyForge ↗
              </a>
            </div>
          )}
          {mvInfo === null && mvLookupPending && (
            <p className="mt-3 text-sm text-muted-foreground">Looking up Master Vault record...</p>
          )}
          {nameIsMissing && (
            <div className="mt-4 p-3 border border-yellow-500 rounded-md space-y-2">
              <p className="text-sm text-muted-foreground">
                This deck has no name yet, so its scan ID is shown instead. It may not be
                registered in the Master Vault.
              </p>
              <Button variant="outline" size="sm" onClick={retryNameLookup} disabled={retrying}>
                {retrying ? 'Looking up...' : 'Retry name lookup'}
              </Button>
              {retryMessage && <p className="text-sm text-yellow-200">{retryMessage}</p>}
            </div>
          )}
          <div className="mt-4 p-3 border rounded-md bg-muted">
            <p className="text-sm text-muted-foreground">Current location</p>
            <p className="font-medium">
              {deck.label} &middot; Position {deck.position}
            </p>
          </div>
        </CardContent>
      </Card>

      <DeckNoteCard deckId={deck.deck_id} />

      <div>
        <h2 className="text-sm font-medium mb-3">Scan History</h2>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {!history && !error && (
          <p className="text-sm text-muted-foreground">Loading...</p>
        )}

        {history && (
          <div className="space-y-3">
            {history.map((scan, i) => (
              <Card key={scan.id}>
                <CardContent className="pt-6 flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-center sm:gap-4">
                  <div>
                    <p className="font-medium">
                      {scan.label} &middot; Position {scan.position}
                      {i === 0 && (
                        <span className="ml-2 text-xs bg-green-900 text-green-200 px-2 py-0.5 rounded-full">
                          Current
                        </span>
                      )}
                    </p>
                  </div>
                  <p className="text-sm text-muted-foreground shrink-0">
                    {new Date(scan.scanned_at).toLocaleString()}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

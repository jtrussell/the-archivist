import { useState, useEffect } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'
import { DeckNoteCard } from './DeckNoteCard'
import { FixDeckDetailsPanel } from './FixDeckDetailsPanel'
import { DeckArchiveActions, RemovedFromArchivesNotice } from './DeckArchiveActions'
import { groupDeckCopies, DeckCopy } from '../services/deckCopies'
import {
  getDeckByScanId,
  getDeckCopies,
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
 * The URL carries only an opaque scan id. We resolve it to the copy that was
 * scanned, then to the deck that copy belongs to, and show EVERY physical copy
 * of that deck in the user's collection (the original plus any clones), each
 * with its own current location, notes, and history.
 *
 * Arriving from the search list hands the row over via router state so the
 * first paint needs no round-trip; a cold load or a reload after linking
 * resolves from the id (the copy's deck may have changed).
 */
export function DeckDetailView() {
  const { scanId } = useParams<{ scanId: string }>()
  const location = useLocation()
  const navigate = useNavigate()

  const passedDeck = (location.state as { deck?: DeckLocation } | null)?.deck ?? null
  const [arrived, setArrived] = useState<DeckLocation | null>(passedDeck)
  const [rows, setRows] = useState<DeckLocation[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!scanId) return

    let cancelled = false
    setLoading(true)

    const load = async () => {
      // Use the handed-over row for the first load only; afterwards always
      // re-resolve, since linking can move the copy to another deck.
      const current =
        reloadToken === 0 && passedDeck ? passedDeck : await getDeckByScanId(scanId)
      if (cancelled) return
      setArrived(current)
      if (!current || current.deck_ref === null) {
        setRows(current ? [current] : null)
        return
      }
      const copies = await getDeckCopies(current.deck_ref)
      if (cancelled) return
      setRows(copies.length > 0 ? copies : [current])
    }

    load()
      .then(() => {
        if (!cancelled) setLoadError(null)
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load deck')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [scanId, passedDeck, reloadToken])

  const goBack = () => navigate('/search')
  const reload = () => setReloadToken((token) => token + 1)

  if (loading && rows === null) {
    return (
      <div className="space-y-6 max-w-2xl mx-auto">
        <Button variant="ghost" onClick={goBack}>
          &larr; Back to results
        </Button>
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (loadError || !arrived || !rows) {
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

  return (
    <DeckDetail
      key={`${arrived.deck_ref}:${reloadToken}`}
      rows={rows}
      arrivedDeckId={arrived.deck_id}
      onBack={goBack}
      onChanged={reload}
    />
  )
}

function DeckDetail({
  rows,
  arrivedDeckId,
  onBack,
  onChanged,
}: {
  rows: DeckLocation[]
  arrivedDeckId: string
  onBack: () => void
  onChanged: () => void
}) {
  const navigate = useNavigate()
  const copies = groupDeckCopies(rows)
  const arrivedRow = rows.find((row) => row.deck_id === arrivedDeckId) ?? rows[0]
  const deckRef = arrivedRow.deck_ref ?? ''

  // Deck-level facts are shared by every row (same deck_ref); prefer the row we
  // arrived from for the name so a manual name shows for the copy it was set on.
  const deckName = arrivedRow.deck_name ?? rows.find((row) => row.deck_name !== null)?.deck_name ?? null
  const nameSource = arrivedRow.name_source
  const mvStatus = arrivedRow.mv_status
  const allDeckIds = rows.map((row) => row.deck_id)
  const allClones = copies.length > 0 && copies.every((copy) => copy.kind === 'clone')

  // Clones are the exception: most decks are a single physical copy, and the
  // page should read exactly as it did before clones existed. The copies list
  // only appears when the user actually owns more than one.
  const multipleCopies = copies.length > 1
  const soleCopy = copies.length === 1 ? copies[0] : null

  // Once the server has verified the Master Vault id there is nothing left to
  // fix, so the link/re-link affordances go away. They stay for pending,
  // client-asserted ('unverified') and 'invalid' decks — and always for clones,
  // whose link to an original is the user's assertion and may need correcting.
  const canFix = mvStatus !== 'resolved'

  const [copied, setCopied] = useState(false)
  const [mvLookupPending, setMvLookupPending] = useState(false)
  const [mvInfo, setMvInfo] = useState<{ mvId: string; setId: number | null } | null>(
    arrivedRow.mv_id !== null ? { mvId: arrivedRow.mv_id, setId: arrivedRow.set_id } : null
  )
  const [fixScope, setFixScope] = useState<{ deckIds: string[]; subject: string } | null>(() =>
    deckName === null || mvStatus === 'invalid'
      ? { deckIds: allDeckIds, subject: allClones ? 'this clone' : 'this deck' }
      : null
  )

  const displayName = deckName ?? arrivedRow.deck_id

  // Resolve a Master Vault id by name when the deck has a name but no id yet
  useEffect(() => {
    if (mvInfo !== null || deckName === null || mvStatus === 'invalid') return

    let cancelled = false
    setMvLookupPending(true)
    backfillDeckMasterVaultInfo({ deck_ref: deckRef, deck_name: deckName })
      .then((info) => {
        if (cancelled || info === null) return
        setMvInfo(info)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setMvLookupPending(false)
      })

    return () => {
      cancelled = true
    }
  }, [deckRef, deckName, mvInfo, mvStatus])

  const handleCopyDeleted = (deletedCopy: DeckCopy) => {
    const remainingCopies = copies.filter((copy) => copy.key !== deletedCopy.key)
    if (remainingCopies.length === 0) {
      navigate('/search', { replace: true })
    } else if (deletedCopy.deckIds.includes(arrivedDeckId)) {
      navigate(`/deck/${remainingCopies[0].current.scan_id}`, { replace: true })
    } else {
      onChanged()
    }
  }

  const copyDeckName = async () => {
    try {
      await navigator.clipboard.writeText(displayName)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
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
              <CopyIcon copied={copied} />
            </span>
          </button>

          {nameSource === 'manual' && deckName !== null && (
            <p className="mt-1 text-xs text-muted-foreground">Name entered manually</p>
          )}

          {soleCopy?.kind === 'clone' && (
            <div className="mt-2 flex items-center gap-2">
              <CloneBadge />
              {soleCopy.code && <span className="text-sm font-mono break-all">{soleCopy.code}</span>}
            </div>
          )}

          {mvInfo !== null && (
            <div className="mt-3 flex flex-wrap gap-4 items-center">
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
              {mvStatus === 'unverified' && (
                <span className="text-xs text-muted-foreground">Link pending verification</span>
              )}
            </div>
          )}
          {mvInfo === null && mvLookupPending && (
            <p className="mt-3 text-sm text-muted-foreground">Looking up Master Vault record...</p>
          )}

          {mvStatus === 'invalid' && (
            <p className="mt-3 text-sm text-yellow-200">
              The Master Vault link for this deck could not be verified. Please re-link it below.
            </p>
          )}

          {deckName === null && (
            <p className="mt-3 text-sm text-muted-foreground">
              {allClones
                ? 'This is a deck clone. The Master Vault cannot look up clone codes, so link it to its original below.'
                : 'This deck has no name yet, so its scan ID is shown instead. It may not be registered in the Master Vault.'}
            </p>
          )}

          {soleCopy && (
            <div className="mt-4 p-3 border rounded-md bg-muted">
              <p className="text-sm text-muted-foreground">Current location</p>
              <p className="font-medium">
                {soleCopy.current.label} &middot; Position {soleCopy.current.position}
              </p>
            </div>
          )}

          {soleCopy && <RemovedFromArchivesNotice copy={soleCopy} onChanged={onChanged} />}

          {soleCopy && soleCopy.kind === 'original' && deckName === null && fixScope === null && (
            <RetryNameLookup row={soleCopy.current} onChanged={onChanged} />
          )}

          {fixScope !== null ? (
            <FixDeckDetailsPanel
              key={fixScope.deckIds.join('|')}
              deckIds={fixScope.deckIds}
              currentDeckRef={deckRef}
              subject={fixScope.subject}
              onLinked={onChanged}
              onCancel={() => setFixScope(null)}
            />
          ) : (
            (canFix || soleCopy?.kind === 'clone') && (
              <div className="mt-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setFixScope({
                      deckIds: allDeckIds,
                      subject: soleCopy?.kind === 'clone' ? 'this clone' : 'this deck',
                    })
                  }
                >
                  {soleCopy?.kind === 'clone' ? 'Re-link this clone' : 'Not the right deck? Fix details'}
                </Button>
              </div>
            )
          )}
        </CardContent>
      </Card>

      {soleCopy && (
        <>
          <DeckNoteCard deckId={soleCopy.key} />
          <div>
            <h2 className="text-sm font-medium mb-3">Scan History</h2>
            <ScanHistoryList deckIds={soleCopy.deckIds} />
          </div>
          <DeckArchiveActions
            copy={soleCopy}
            subject={soleCopy.kind === 'clone' ? 'this clone' : 'this deck'}
            onChanged={onChanged}
            onDeleted={() => handleCopyDeleted(soleCopy)}
          />
        </>
      )}

      {multipleCopies && (
        <div>
          <h2 className="text-sm font-medium mb-3">Physical copies ({copies.length})</h2>
          <div className="space-y-4">
            {copies.map((copy) => (
              <CopyCard
                key={copy.key}
                copy={copy}
                highlighted={copy.deckIds.includes(arrivedDeckId)}
                onRelink={
                  canFix || copy.kind === 'clone'
                    ? () =>
                        setFixScope({
                          deckIds: copy.deckIds,
                          subject: copy.kind === 'clone' ? 'this clone' : 'this copy',
                        })
                    : null
                }
                onChanged={onChanged}
                onDeleted={() => handleCopyDeleted(copy)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** One physical copy, shown only when the user owns several copies of a deck */
function CopyCard({
  copy,
  highlighted,
  onRelink,
  onChanged,
  onDeleted,
}: {
  copy: DeckCopy
  highlighted: boolean
  /** null = re-linking not offered (verified original; clones can always re-link) */
  onRelink: (() => void) | null
  onChanged: () => void
  onDeleted: () => void
}) {
  const [showHistory, setShowHistory] = useState(false)
  const row = copy.current

  return (
    <Card className={highlighted ? 'ring-1 ring-primary' : undefined}>
      <CardContent className="pt-6 space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {copy.kind === 'clone' ? (
                <CloneBadge />
              ) : (
                <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  Original
                </span>
              )}
              {copy.code && <span className="text-sm font-mono break-all">{copy.code}</span>}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">Current location</p>
            <p className="font-medium">
              {row.label} &middot; Position {row.position}
            </p>
            <p className="text-sm text-muted-foreground">
              Scanned {new Date(row.scanned_at).toLocaleString()}
            </p>
            <RemovedFromArchivesNotice copy={copy} onChanged={onChanged} />
          </div>
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={() => setShowHistory((current) => !current)}>
              {showHistory ? 'Hide history' : 'History'}
            </Button>
            {onRelink && (
              <Button variant="ghost" size="sm" onClick={onRelink}>
                Re-link
              </Button>
            )}
          </div>
        </div>

        {row.deck_name === null && copy.kind === 'original' && (
          <RetryNameLookup row={row} onChanged={onChanged} />
        )}

        <DeckNoteCard deckId={copy.key} />

        {showHistory && (
          <div>
            <h3 className="text-sm font-medium mb-2">Scan history</h3>
            <ScanHistoryList deckIds={copy.deckIds} compact />
          </div>
        )}

        <DeckArchiveActions
          copy={copy}
          subject={copy.kind === 'clone' ? 'this clone' : 'this copy'}
          onChanged={onChanged}
          onDeleted={onDeleted}
        />
      </CardContent>
    </Card>
  )
}

function CloneBadge() {
  return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-purple-900 text-purple-200">Clone</span>
  )
}

/** "Retry name lookup" box for an original the API couldn't name at scan time */
function RetryNameLookup({ row, onChanged }: { row: DeckLocation; onChanged: () => void }) {
  const [retrying, setRetrying] = useState(false)
  const [retryMessage, setRetryMessage] = useState<string | null>(null)

  const retry = async () => {
    setRetrying(true)
    setRetryMessage(null)
    try {
      const name = await backfillSingleDeckName(row)
      if (name === null) {
        setRetryMessage('Still no name found. This deck may not be registered in the Master Vault yet.')
      } else {
        onChanged()
      }
    } catch (err) {
      setRetryMessage(err instanceof Error ? err.message : 'Name lookup failed')
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className="mt-4 p-3 border border-yellow-500 rounded-md space-y-2">
      <Button variant="outline" size="sm" onClick={retry} disabled={retrying}>
        {retrying ? 'Looking up...' : 'Retry name lookup'}
      </Button>
      {retryMessage && <p className="text-sm text-yellow-200">{retryMessage}</p>}
    </div>
  )
}

/** Newest-first scan history for a set of scanned identifiers (one physical copy) */
function ScanHistoryList({ deckIds, compact = false }: { deckIds: string[]; compact?: boolean }) {
  const [history, setHistory] = useState<DeckScanRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getDeckHistory(deckIds)
      .then((rows) => {
        if (!cancelled) setHistory(rows)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load history')
      })
    return () => {
      cancelled = true
    }
  }, [deckIds])

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!history) return <p className="text-sm text-muted-foreground">Loading...</p>

  const entries = history.map((scan, i) => (
    <div
      key={scan.id}
      className={
        compact
          ? 'flex flex-col gap-1 sm:flex-row sm:justify-between sm:items-center p-2 border rounded-md'
          : 'flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-center sm:gap-4'
      }
    >
      <p className="font-medium">
        {scan.label} &middot; Position {scan.position}
        {i === 0 && (
          <span className="ml-2 text-xs bg-green-900 text-green-200 px-2 py-0.5 rounded-full">
            Current
          </span>
        )}
      </p>
      <p className="text-sm text-muted-foreground shrink-0">
        {new Date(scan.scanned_at).toLocaleString()}
      </p>
    </div>
  ))

  if (compact) return <div className="space-y-2">{entries}</div>

  return (
    <div className="space-y-3">
      {entries.map((entry, i) => (
        <Card key={history[i].id}>
          <CardContent className="pt-6">{entry}</CardContent>
        </Card>
      ))}
    </div>
  )
}

function CopyIcon({ copied }: { copied: boolean }) {
  return copied ? (
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
  )
}

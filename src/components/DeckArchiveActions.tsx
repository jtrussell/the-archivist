import { useState } from 'react'
import { Button } from './ui/button'
import { useAuth } from '../hooks/useAuth'
import { DeckCopy } from '../services/deckCopies'
import {
  deleteDeckCopy,
  removeDeckCopyFromArchives,
  restoreDeckCopyToArchives,
} from '../services/scanService'
import { clearNoteDraft } from '../services/storage'

const describeError = (err: unknown, fallback: string) =>
  err instanceof Error ? err.message : fallback

export function RemovedFromArchivesNotice({
  copy,
  onChanged,
}: {
  copy: DeckCopy
  onChanged: () => void
}) {
  const [restoring, setRestoring] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { removed_at: removedAt, removal_note: removalNote } = copy.current

  if (removedAt === null) return null

  const restore = async () => {
    setRestoring(true)
    setError(null)
    try {
      await restoreDeckCopyToArchives(copy.deckIds)
      onChanged()
    } catch (err) {
      setError(describeError(err, 'Failed to restore deck'))
      setRestoring(false)
    }
  }

  return (
    <div className="mt-4 p-3 border border-yellow-500 rounded-md space-y-2">
      <p className="text-sm font-medium text-yellow-200">
        Removed from your archives on {new Date(removedAt).toLocaleDateString()}
      </p>
      {removalNote && <p className="text-sm whitespace-pre-wrap break-words">{removalNote}</p>}
      <p className="text-xs text-muted-foreground">
        Hidden from search by default. Scanning it again restores it automatically.
      </p>
      <Button variant="outline" size="sm" onClick={restore} disabled={restoring}>
        {restoring ? 'Restoring...' : 'Restore to archives'}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

type PendingAction = 'remove' | 'delete' | null

export function DeckArchiveActions({
  copy,
  subject,
  onChanged,
  onDeleted,
}: {
  copy: DeckCopy
  subject: string
  onChanged: () => void
  onDeleted: () => void
}) {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''

  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [removalNote, setRemovalNote] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isRemoved = copy.current.removed_at !== null

  const cancel = () => {
    setPendingAction(null)
    setRemovalNote('')
    setError(null)
  }

  const confirmRemoval = async () => {
    setWorking(true)
    setError(null)
    try {
      await removeDeckCopyFromArchives(copy.deckIds, removalNote)
      onChanged()
    } catch (err) {
      setError(describeError(err, 'Failed to remove deck'))
      setWorking(false)
    }
  }

  const confirmDeletion = async () => {
    setWorking(true)
    setError(null)
    try {
      await deleteDeckCopy(copy.deckIds)
      copy.deckIds.forEach((deckId) => clearNoteDraft(userId, deckId))
      onDeleted()
    } catch (err) {
      setError(describeError(err, 'Failed to delete deck'))
      setWorking(false)
    }
  }

  if (pendingAction === 'remove') {
    return (
      <div className="p-3 border rounded-md space-y-2">
        <p className="text-sm font-medium">Remove {subject} from your archives?</p>
        <p className="text-xs text-muted-foreground">
          It stays in your history but is hidden from search by default. Scanning it again restores
          it.
        </p>
        <textarea
          value={removalNote}
          onChange={(event) => setRemovalNote(event.target.value)}
          autoFocus
          rows={3}
          placeholder="Optional note, e.g. sold, traded, gave away..."
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={confirmRemoval} disabled={working}>
            {working ? 'Removing...' : 'Remove from archives'}
          </Button>
          <Button size="sm" variant="ghost" onClick={cancel} disabled={working}>
            Cancel
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    )
  }

  if (pendingAction === 'delete') {
    return (
      <div className="p-3 border border-destructive rounded-md space-y-2">
        <p className="text-sm font-medium">Permanently delete {subject}?</p>
        <p className="text-xs text-muted-foreground">
          This erases its scan history and notes from your collection. It cannot be undone.
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="destructive" onClick={confirmDeletion} disabled={working}>
            {working ? 'Deleting...' : 'Delete permanently'}
          </Button>
          <Button size="sm" variant="ghost" onClick={cancel} disabled={working}>
            Cancel
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-2">
      {!isRemoved && (
        <Button variant="outline" size="sm" onClick={() => setPendingAction('remove')}>
          Remove from archives
        </Button>
      )}
      <Button variant="destructive" size="sm" onClick={() => setPendingAction('delete')}>
        Delete permanently
      </Button>
    </div>
  )
}

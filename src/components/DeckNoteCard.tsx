import { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import { Card, CardContent } from './ui/card'
import { Button } from './ui/button'
import { useAuth } from '../hooks/useAuth'
import { getDeckNote, saveDeckNote } from '../services/noteService'
import { getNoteDraft, saveNoteDraft, clearNoteDraft } from '../services/storage'

export function DeckNoteCard({ deckId }: { deckId: string }) {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''

  const [note, setNote] = useState<string | null>(null)
  const [draft, setDraft] = useState<string | null>(() => getNoteDraft(userId, deckId))
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getDeckNote(deckId)
      .then(setNote)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load note'))
  }, [deckId])

  const hasPendingEdits = draft !== null && draft !== (note ?? '')

  const beginEditing = () => {
    if (note === null) return
    if (draft === null) setDraft(note)
    setEditing(true)
  }

  const updateDraft = (value: string) => {
    setDraft(value)
    saveNoteDraft(userId, deckId, value)
  }

  const exitEditing = () => {
    setEditing(false)
    if (draft !== null && draft === (note ?? '')) {
      clearNoteDraft(userId, deckId)
      setDraft(null)
    }
  }

  const handleEditorBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      exitEditing()
    }
  }

  const saveNote = async () => {
    if (draft === null || saving) return
    setSaving(true)
    setError(null)
    try {
      await saveDeckNote(deckId, draft)
      setNote(draft)
      clearNoteDraft(userId, deckId)
      setDraft(null)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save note')
    } finally {
      setSaving(false)
    }
  }

  const cancelEditing = () => {
    clearNoteDraft(userId, deckId)
    setDraft(null)
    setEditing(false)
  }

  const handleEditorKeyDown = (event: React.KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      void saveNote()
    }
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium">Notes</h2>
          {!editing && hasPendingEdits && (
            <span className="text-xs bg-yellow-900 text-yellow-200 px-2 py-0.5 rounded-full">
              Unsaved edits
            </span>
          )}
        </div>

        {error && <p className="text-sm text-destructive mb-2">{error}</p>}

        {note === null && !error && <p className="text-sm text-muted-foreground">Loading...</p>}

        {note !== null && !editing && (
          <button
            type="button"
            onClick={beginEditing}
            aria-label="Edit notes"
            className="w-full text-left"
          >
            {note.trim() === '' ? (
              <p className="text-sm text-muted-foreground">Tap to add notes</p>
            ) : (
              <div className="prose prose-sm prose-invert max-w-none">
                <ReactMarkdown>{note}</ReactMarkdown>
              </div>
            )}
          </button>
        )}

        {note !== null && editing && (
          <div onBlur={handleEditorBlur} className="space-y-2">
            <textarea
              value={draft ?? note}
              onChange={(event) => updateDraft(event.target.value)}
              onKeyDown={handleEditorKeyDown}
              autoFocus
              rows={6}
              placeholder="Write notes in markdown..."
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={saveNote} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
              <Button size="sm" variant="ghost" onClick={cancelEditing} disabled={saving}>
                Cancel
              </Button>
              <span className="text-xs text-muted-foreground ml-auto">Ctrl+Enter to save</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

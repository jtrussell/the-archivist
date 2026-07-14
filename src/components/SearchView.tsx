import { useState, useEffect } from 'react'
import { Input } from './ui/input'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'
import {
  searchDecks,
  getDeckHistory,
  DeckLocation,
  DeckScanRecord,
  SEARCH_PAGE_SIZE,
} from '../services/scanService'

export function SearchView() {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [decks, setDecks] = useState<DeckLocation[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<DeckLocation | null>(null)

  useEffect(() => {
    setLoading(true)
    // Debounce typing; load page changes and the initial listing immediately
    const timeout = setTimeout(async () => {
      try {
        const result = await searchDecks(query, page)
        setDecks(result.decks)
        setTotal(result.total)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Search failed')
        setDecks([])
        setTotal(0)
      } finally {
        setLoading(false)
      }
    }, query.trim() ? 300 : 0)

    return () => clearTimeout(timeout)
  }, [query, page])

  const totalPages = Math.max(1, Math.ceil(total / SEARCH_PAGE_SIZE))

  if (selected) {
    return <DeckDetail deck={selected} onBack={() => setSelected(null)} />
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <Card>
        <CardContent className="pt-6">
          <label className="block text-sm font-medium mb-2">
            Find a Deck
          </label>
          <Input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(0)
            }}
            placeholder="Search by deck name..."
            className="text-lg"
          />
          <p className="text-sm text-muted-foreground mt-2">
            {loading
              ? 'Loading...'
              : `${total} deck${total !== 1 ? 's' : ''}${query.trim() ? ' match' : ' in your collection'}`}
          </p>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-center text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {!loading && !error && decks.length === 0 && (
        <p className="text-sm text-center text-muted-foreground">
          {query.trim()
            ? `No decks found matching "${query.trim()}"`
            : 'No decks scanned yet'}
        </p>
      )}

      {decks.length > 0 && (
        <div className="space-y-3">
          {decks.map((deck) => (
            <button
              key={deck.deck_id}
              type="button"
              onClick={() => setSelected(deck)}
              className="w-full text-left"
            >
              <Card className="hover:bg-accent/50 transition-colors">
                <CardContent className="pt-6 flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-start sm:gap-4">
                  <div className="min-w-0">
                    <p className="font-medium break-words">
                      {deck.deck_name ?? deck.deck_id}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Scanned {new Date(deck.scanned_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="sm:text-right shrink-0">
                    <p className="font-medium">{deck.label}</p>
                    <p className="text-sm text-muted-foreground">Position {deck.position}</p>
                  </div>
                </CardContent>
              </Card>
            </button>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0 || loading}
          >
            Previous
          </Button>
          <p className="text-sm text-muted-foreground">
            Page {page + 1} of {totalPages}
          </p>
          <Button
            variant="outline"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1 || loading}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  )
}

function DeckDetail({ deck, onBack }: { deck: DeckLocation; onBack: () => void }) {
  const [history, setHistory] = useState<DeckScanRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getDeckHistory(deck.deck_id)
      .then(setHistory)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load history'))
  }, [deck.deck_id])

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <Button variant="ghost" onClick={onBack}>
        &larr; Back to results
      </Button>

      <Card>
        <CardContent className="pt-6">
          <p className="text-lg font-semibold break-words">
            {deck.deck_name ?? deck.deck_id}
          </p>
          {deck.deck_code && (
            <p className="text-sm font-mono text-muted-foreground mt-1">{deck.deck_code}</p>
          )}
          <div className="mt-4 p-3 border rounded-md bg-muted">
            <p className="text-sm text-muted-foreground">Current location</p>
            <p className="font-medium">
              {deck.label} &middot; Position {deck.position}
            </p>
          </div>
        </CardContent>
      </Card>

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

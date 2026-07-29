import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Input } from './ui/input'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'
import {
  searchDecks,
  DeckLocation,
  SEARCH_PAGE_SIZE,
} from '../services/scanService'

export function SearchView() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // Search state lives in the URL so it survives a round-trip to a deck detail
  // page (back button restores the same results) and is itself shareable.
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '')
  const [page, setPage] = useState(() => Math.max(0, Number(searchParams.get('page') ?? '0') || 0))
  const [missingNamesOnly, setMissingNamesOnly] = useState(
    () => searchParams.get('missing') === '1'
  )
  const [decks, setDecks] = useState<DeckLocation[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    // Debounce typing; load page changes and the initial listing immediately
    const timeout = setTimeout(async () => {
      // Reflect the active search into the URL (replace, so keystrokes don't
      // each become a history entry)
      const next = new URLSearchParams()
      if (query.trim()) next.set('q', query.trim())
      if (page > 0) next.set('page', String(page))
      if (missingNamesOnly) next.set('missing', '1')
      setSearchParams(next, { replace: true })

      try {
        const result = await searchDecks(query, page, { missingNamesOnly })
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
  }, [query, page, missingNamesOnly])

  const totalPages = Math.max(1, Math.ceil(total / SEARCH_PAGE_SIZE))

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
            placeholder={missingNamesOnly ? 'Search by scan ID...' : 'Search by deck name...'}
            className="text-lg"
          />
          <div className="mt-3 flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              {loading
                ? 'Loading...'
                : `${total} deck${total !== 1 ? 's' : ''}${missingNamesOnly ? ' missing names' : query.trim() ? ' match' : ' in your collection'}`}
            </p>
            <Button
              variant={missingNamesOnly ? 'secondary' : 'outline'}
              size="sm"
              aria-pressed={missingNamesOnly}
              onClick={() => {
                setMissingNamesOnly((current) => !current)
                setPage(0)
              }}
            >
              Missing names only
            </Button>
          </div>
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
            : missingNamesOnly
              ? 'No decks are missing names'
              : 'No decks scanned yet'}
        </p>
      )}

      {decks.length > 0 && (
        <div className="space-y-3">
          {decks.map((deck) => (
            <button
              key={deck.deck_id}
              type="button"
              onClick={() => navigate(`/deck/${deck.scan_id}`, { state: { deck } })}
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

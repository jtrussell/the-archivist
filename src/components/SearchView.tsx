import { useState, useEffect } from 'react'
import { Input } from './ui/input'
import { Card, CardContent } from './ui/card'
import { searchDecks, DeckLocation } from '../services/scanService'

export function SearchView() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DeckLocation[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults([])
      setError(null)
      return
    }

    setSearching(true)
    const timeout = setTimeout(async () => {
      try {
        const found = await searchDecks(trimmed)
        setResults(found)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Search failed')
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 300)

    return () => clearTimeout(timeout)
  }, [query])

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
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by deck name..."
            className="text-lg"
          />
          <p className="text-sm text-muted-foreground mt-2">
            Shows each deck's most recent location
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

      {searching && (
        <p className="text-sm text-center text-muted-foreground">Searching...</p>
      )}

      {!searching && query.trim().length >= 2 && results.length === 0 && !error && (
        <p className="text-sm text-center text-muted-foreground">
          No decks found matching "{query.trim()}"
        </p>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          {results.map((deck) => (
            <Card key={deck.scan_id}>
              <CardContent className="pt-6 flex justify-between items-start gap-4">
                <div className="min-w-0">
                  <p className="font-medium break-words">
                    {deck.deck_name ?? deck.deck_id}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Scanned {new Date(deck.scanned_at).toLocaleString()}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-medium">{deck.label}</p>
                  <p className="text-sm text-muted-foreground">Position {deck.position}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

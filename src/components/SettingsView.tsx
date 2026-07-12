import { useState, useEffect } from 'react'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { getUnsyncedCount, syncQueue } from '../services/syncService'
import { clearScanQueue, clearAppState } from '../services/storage'
import { useAuth } from '../hooks/useAuth'

export function SettingsView() {
  const { session, signOut } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unsyncedCount, setUnsyncedCount] = useState(0)

  useEffect(() => {
    setUnsyncedCount(getUnsyncedCount())
  }, [])

  const handleSync = async () => {
    setLoading(true)
    setError(null)

    try {
      const result = await syncQueue()
      setUnsyncedCount(getUnsyncedCount())

      if (result.failed > 0) {
        setError(`Synced ${result.synced}, failed ${result.failed}: ${result.errors.join(', ')}`)
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Sync failed')
    } finally {
      setLoading(false)
    }
  }

  const handleClearQueue = () => {
    if (confirm('Are you sure you want to delete all queued scans? This cannot be undone.')) {
      clearScanQueue()
      setUnsyncedCount(0)
      setError(null)
    }
  }

  const handleSignOut = async () => {
    const pending = getUnsyncedCount()
    if (pending > 0) {
      const proceed = confirm(
        `You have ${pending} unsynced scan${pending !== 1 ? 's' : ''}. ` +
        'Sign out anyway? Unsynced scans will be lost.'
      )
      if (!proceed) return
    }

    try {
      await signOut()
      clearAppState()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Sign out failed')
    }
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {unsyncedCount > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending Scans</CardTitle>
            <CardDescription>
              You have {unsyncedCount} scan{unsyncedCount !== 1 ? 's' : ''} waiting to be synced
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button onClick={handleSync} disabled={loading} variant='outline' className="w-full">
              {loading ? 'Syncing...' : `Sync ${unsyncedCount} Scan${unsyncedCount !== 1 ? 's' : ''}`}
            </Button>
            <Button onClick={handleClearQueue} variant="outline" className="w-full">
              Clear Queue
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>
            Your scans and labels are stored in your own account
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="p-3 border rounded-md bg-muted">
            <p className="text-sm font-mono break-all">{session?.user.email}</p>
          </div>
          <Button onClick={handleSignOut} variant="outline">
            Sign Out
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How It Works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            1. Pick a location label, then scan deck QR codes
          </p>
          <p>
            2. Each deck gets the next position number in that location
          </p>
          <p>
            3. Scans sync to your account automatically; if you're offline they
            queue locally and sync when you're back online
          </p>
          <p>
            4. Use Search to find a deck's current location and position by name
          </p>
        </CardContent>
      </Card>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  )
}

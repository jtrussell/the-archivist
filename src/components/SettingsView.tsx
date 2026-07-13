import { useState, useEffect } from 'react'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { getUnsyncedCount, syncQueue } from '../services/syncService'
import { clearScanQueue, clearAppState } from '../services/storage'
import {
  exportScansCsv,
  deleteAccount,
  countNamelessScans,
  backfillDeckNames,
} from '../services/scanService'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

export function SettingsView() {
  const { session, signOut } = useAuth()
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unsyncedCount, setUnsyncedCount] = useState(0)
  const [namelessCount, setNamelessCount] = useState(0)
  const [backfilling, setBackfilling] = useState(false)
  const [backfillProgress, setBackfillProgress] = useState('')
  const [backfillMessage, setBackfillMessage] = useState<string | null>(null)

  useEffect(() => {
    setUnsyncedCount(getUnsyncedCount())
    countNamelessScans()
      .then(setNamelessCount)
      .catch((error) => console.error('Failed to count nameless scans:', error))
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

  const handleBackfill = async () => {
    setBackfilling(true)
    setBackfillMessage(null)
    setError(null)

    try {
      const result = await backfillDeckNames((done, total) => {
        setBackfillProgress(`Looking up deck ${done} of ${total}...`)
      })
      const count = await countNamelessScans()
      setNamelessCount(count)
      setBackfillMessage(
        result.remaining > 0
          ? `Filled in ${result.updated} scan${result.updated !== 1 ? 's' : ''}; ` +
            `${result.remaining} still missing (try again later)`
          : `Filled in names for ${result.updated} scan${result.updated !== 1 ? 's' : ''}`
      )
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Backfill failed')
    } finally {
      setBackfilling(false)
      setBackfillProgress('')
    }
  }

  const handleExport = async () => {
    setExporting(true)
    setError(null)

    try {
      const csv = await exportScansCsv()
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `archivist-scans-${new Date().toISOString().slice(0, 10)}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const handleDeleteAccount = async () => {
    const confirmed = confirm(
      'Delete your account and ALL scan data? This cannot be undone. ' +
      'Consider exporting a CSV backup first.'
    )
    if (!confirmed) return

    const doubleChecked = confirm(
      'Last chance: this permanently deletes every scan and label ' +
      'in your account. Continue?'
    )
    if (!doubleChecked) return

    setDeleting(true)
    setError(null)

    try {
      await deleteAccount()
      clearAppState()
      // The server-side user is gone; clear the local session only
      await supabase.auth.signOut({ scope: 'local' })
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Account deletion failed')
      setDeleting(false)
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

      {(namelessCount > 0 || backfillMessage) && (
        <Card>
          <CardHeader>
            <CardTitle>Missing Deck Names</CardTitle>
            <CardDescription>
              {namelessCount > 0
                ? `${namelessCount} scan${namelessCount !== 1 ? 's are' : ' is'} missing a deck ` +
                  'name (the lookup failed at scan time). Names are needed for search.'
                : 'All scans have deck names.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {namelessCount > 0 && (
              <Button
                onClick={handleBackfill}
                disabled={backfilling}
                variant="outline"
                className="w-full"
              >
                {backfilling
                  ? backfillProgress || 'Backfilling...'
                  : 'Backfill Missing Names'}
              </Button>
            )}
            {backfillMessage && (
              <p className="text-sm text-center text-muted-foreground">{backfillMessage}</p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Export</CardTitle>
          <CardDescription>
            Download your full scan history as a CSV file
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleExport} disabled={exporting} variant="outline" className="w-full">
            {exporting ? 'Exporting...' : 'Export All Scans (CSV)'}
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

      <Card className="border-destructive">
        <CardHeader>
          <CardTitle>Danger Zone</CardTitle>
          <CardDescription>
            Permanently delete your account, including every scan and label.
            This cannot be undone — export a CSV backup first if you want to
            keep your data.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={handleDeleteAccount}
            disabled={deleting}
            variant="destructive"
            className="w-full"
          >
            {deleting ? 'Deleting...' : 'Delete Account & All Data'}
          </Button>
        </CardContent>
      </Card>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  )
}

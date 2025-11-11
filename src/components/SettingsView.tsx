import { useState, useEffect } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import {
  getWebhookUrl,
  setWebhookUrl,
  clearWebhookUrl,
  isValidWebhookUrl,
  getWebhookApiKey,
  setWebhookApiKey,
} from '../services/webhookService'
import { getUnsyncedCount, syncQueue } from '../services/syncService'
import { clearScanQueue } from '../services/storage'

interface SettingsViewProps {
  isConfigured: boolean
  onConfigChange: () => void
}

export function SettingsView({ isConfigured, onConfigChange }: SettingsViewProps) {
  const [webhookInput, setWebhookInput] = useState('')
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [currentWebhookUrl, setCurrentWebhookUrl] = useState<string | null>(null)
  const [currentApiKey, setCurrentApiKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unsyncedCount, setUnsyncedCount] = useState(0)

  useEffect(() => {
    loadCurrentWebhook()
    setUnsyncedCount(getUnsyncedCount())
  }, [])

  const loadCurrentWebhook = () => {
    const url = getWebhookUrl()
    const apiKey = getWebhookApiKey()
    setCurrentWebhookUrl(url)
    setCurrentApiKey(apiKey)
  }

  const handleSetWebhook = () => {
    if (!webhookInput.trim()) {
      setError('Please enter a webhook URL')
      return
    }

    if (!isValidWebhookUrl(webhookInput)) {
      setError('Invalid webhook URL. Must be a valid HTTP or HTTPS URL.')
      return
    }

    setWebhookUrl(webhookInput)
    setCurrentWebhookUrl(webhookInput)
    setWebhookInput('')

    // Save API key if provided
    if (apiKeyInput.trim()) {
      setWebhookApiKey(apiKeyInput)
      setCurrentApiKey(apiKeyInput)
      setApiKeyInput('')
    }

    setError(null)
    onConfigChange()
  }

  const handleClearWebhook = () => {
    clearWebhookUrl()
    setCurrentWebhookUrl(null)
    setCurrentApiKey(null)
    onConfigChange()
  }

  const handleSync = async () => {
    if (!currentWebhookUrl) {
      setError('No webhook configured')
      return
    }

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

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {isConfigured && unsyncedCount > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending Scans</CardTitle>
            <CardDescription>
              You have {unsyncedCount} scan{unsyncedCount !== 1 ? 's' : ''} waiting to be sent
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button onClick={handleSync} disabled={loading} variant='outline' className="w-full">
              {loading ? 'Sending...' : `Send ${unsyncedCount} Scan${unsyncedCount !== 1 ? 's' : ''}`}
            </Button>
            <Button onClick={handleClearQueue} variant="outline" className="w-full">
              Clear Queue
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Webhook Configuration</CardTitle>
          <CardDescription>
            Configure your Make.com webhook URL to store deck scan data
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {currentWebhookUrl ? (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium mb-2">Current webhook:</p>
                <div className="p-3 border rounded-md bg-muted break-all">
                  <p className="text-sm font-mono">{currentWebhookUrl}</p>
                </div>
              </div>
              {currentApiKey && (
                <div>
                  <p className="text-sm font-medium mb-2">API key:</p>
                  <div className="p-3 border rounded-md bg-muted">
                    <p className="text-sm font-mono">
                      {currentApiKey.slice(0, 8)}...{currentApiKey.slice(-4)}
                    </p>
                  </div>
                </div>
              )}
              <Button onClick={handleClearWebhook} variant="outline">
                Clear Webhook
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Enter your Make.com webhook URL and optional API key. The app will send batches of scans to this endpoint.
              </p>
              <div className="space-y-2">
                <Input
                  placeholder="https://hook.us1.make.com/..."
                  value={webhookInput}
                  onChange={(e) => setWebhookInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !apiKeyInput.trim()) {
                      handleSetWebhook()
                    }
                  }}
                />
                <Input
                  type="password"
                  placeholder="API Key (optional)"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleSetWebhook()
                    }
                  }}
                />
                <Button onClick={handleSetWebhook} disabled={!webhookInput.trim()} className="w-full">
                  Set Webhook
                </Button>
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How It Works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            1. Scans are queued locally as you scan decks
          </p>
          <p>
            2. Click "Send" to batch submit all pending scans to your webhook
          </p>
          <p>
            3. If an API key is configured, it's sent in the <code className="px-1 py-0.5 bg-muted rounded">x-make-apikey</code> header
          </p>
          <p>
            4. Your Make.com scenario receives an array of scans in this format:
          </p>
          <pre className="p-3 bg-muted rounded-md mt-2 overflow-x-auto">
{`{
  "scans": [
    {
      "tag": "Box #1",
      "deckData": "deck-id-123",
      "timestamp": "2025-11-04T12:34:56.789Z"
    }
  ]
}`}
          </pre>
        </CardContent>
      </Card>
    </div>
  )
}

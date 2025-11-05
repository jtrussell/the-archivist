import { useState, useEffect } from 'react'
import { QRScanner } from './QRScanner'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Card, CardContent } from './ui/card'
import { recordScan } from '../services/syncService'
import { getAppState, saveAppState } from '../services/storage'

interface ScanViewProps {
  isConfigured: boolean
}

export function ScanView({ isConfigured }: ScanViewProps) {
  const [currentTag, setCurrentTag] = useState('')
  const [scanning, setScanning] = useState(false)
  const [lastScan, setLastScan] = useState<{ data: string; timestamp: Date } | null>(null)
  const [status, setStatus] = useState<'idle' | 'success' | 'error' | 'queued'>('idle')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const state = getAppState()
    setCurrentTag(state.currentTag)
  }, [])

  useEffect(() => {
    if (currentTag !== getAppState().currentTag) {
      saveAppState({ currentTag })
    }
  }, [currentTag])

  const handleScan = async (qrData: string) => {
    if (lastScan && lastScan.data === qrData && Date.now() - lastScan.timestamp.getTime() < 2000) {
      return
    }

    setLastScan({ data: qrData, timestamp: new Date() })

    setScanning(false)

    try {
      const result = await recordScan(qrData, currentTag)

      if (result.success) {
        setStatus('queued')
        setMessage('Scan queued!')
      } else {
        setStatus('error')
        setMessage(result.error || 'Failed to record scan')
      }
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : 'Unknown error')
    }
  }

  const handleError = (error: Error) => {
    setStatus('error')
    setMessage(error.message)
  }

  if (!isConfigured) {
    return (
      <div className="flex flex-col items-center justify-center p-8">
        <Card className="max-w-md">
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground mb-4">
              Please configure a webhook before scanning
            </p>
            <p className="text-sm text-center text-muted-foreground">
              Go to Settings to set your Make.com webhook URL
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <Card>
        <CardContent className="pt-6">
          <label className="block text-sm font-medium mb-2">
            Current Location Tag
          </label>
          <Input
            type="text"
            value={currentTag}
            onChange={(e) => setCurrentTag(e.target.value)}
            placeholder="e.g., Storage Box #3457"
            className="text-lg"
          />
          <p className="text-sm text-muted-foreground mt-2">
            All scanned decks will be tagged with this location
          </p>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {!scanning ? (
          <Button
            onClick={() => setScanning(true)}
            size="lg"
            className="w-full"
            disabled={!currentTag.trim()}
          >
            Start Scanning
          </Button>
        ) : (
          <div className="space-y-4">
            <QRScanner
              onScan={handleScan}
              onError={handleError}
              scanning={scanning}
            />

            <Button
              onClick={() => setScanning(false)}
              variant="outline"
              className="w-full"
            >
              Stop Scanning
            </Button>
          </div>
        )}

        {status !== 'idle' && (
          <Card className={
            status === 'success' ? 'border-green-500' :
            status === 'queued' ? 'border-yellow-500' :
            'border-destructive'
          }>
            <CardContent className="pt-6">
              <p className={`text-center font-medium ${
                status === 'success' ? 'text-green-600' :
                status === 'queued' ? 'text-yellow-600' :
                'text-destructive'
              }`}>
                {message}
              </p>
            </CardContent>
          </Card>
        )}

        {!currentTag.trim() && (
          <p className="text-sm text-center text-muted-foreground">
            Enter a location tag to start scanning
          </p>
        )}
      </div>
    </div>
  )
}

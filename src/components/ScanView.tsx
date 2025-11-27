import { useState } from 'react'
import { QRScanner } from './QRScanner'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Card, CardContent } from './ui/card'
import { recordScan } from '../services/syncService'
import { useAppState } from '../hooks/useAppState'

interface ScanViewProps {
  isConfigured: boolean
}

export function ScanView({ isConfigured }: ScanViewProps) {
  const { state, updateState } = useAppState()
  const [scanning, setScanning] = useState(false)
  const [status, setStatus] = useState<'idle' | 'success' | 'error' | 'queued'>('idle')
  const [message, setMessage] = useState('')

  const handleScan = async (qrData: string) => {
    // Temporarily stop scanning while processing
    setScanning(false)

    try {
      const result = await recordScan(qrData, state.currentTag)

      if (result.success) {
        setStatus('queued')
        setMessage('Scan queued!')
      } else {
        setStatus('error')
        setMessage(result.error || 'Failed to record scan')
      }

      // Automatically restart scanning for next deck
      setTimeout(() => {
        setScanning(true)
        setStatus('idle')
      }, 1000)

    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : 'Unknown error')

      // Restart scanning after error
      setTimeout(() => {
        setScanning(true)
        setStatus('idle')
      }, 2000)
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
            value={state.currentTag}
            onChange={(e) => updateState({ currentTag: e.target.value })}
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
            variant='outline'
            disabled={!state.currentTag.trim()}
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

        {!state.currentTag.trim() && (
          <p className="text-sm text-center text-muted-foreground">
            Enter a location tag to start scanning
          </p>
        )}
      </div>
    </div>
  )
}

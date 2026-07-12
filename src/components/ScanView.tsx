import { useState, useEffect } from 'react'
import { QRScanner } from './QRScanner'
import { Button } from './ui/button'
import { Combobox } from './ui/combobox'
import { Card, CardContent } from './ui/card'
import { recordScan } from '../services/syncService'
import { getLabels, getMaxPosition } from '../services/scanService'
import { getUnsyncedQueueItems } from '../services/storage'
import { useAppState } from '../hooks/useAppState'

function countQueuedForLabel(label: string): number {
  return getUnsyncedQueueItems().filter((item) => item.label === label).length
}

export function ScanView() {
  const { state, updateState } = useAppState()
  const [scanning, setScanning] = useState(false)
  const [status, setStatus] = useState<'idle' | 'success' | 'error' | 'queued'>('idle')
  const [message, setMessage] = useState('')
  const [labels, setLabels] = useState<string[]>([])
  const [maxPosition, setMaxPosition] = useState<number | null>(null)

  const label = state.currentLabel

  useEffect(() => {
    getLabels()
      .then((rows) => setLabels(rows.map((r) => r.name)))
      .catch((error) => console.error('Failed to load labels:', error))
  }, [])

  // Look up the stored max position when the label settles
  useEffect(() => {
    const trimmed = label.trim()
    if (!trimmed) {
      setMaxPosition(null)
      return
    }

    setMaxPosition(null)
    const timeout = setTimeout(() => {
      getMaxPosition(trimmed)
        .then(setMaxPosition)
        .catch((error) => {
          console.error('Failed to load position:', error)
          setMaxPosition(0)
        })
    }, 400)

    return () => clearTimeout(timeout)
  }, [label])

  const nextPosition =
    maxPosition === null ? null : maxPosition + countQueuedForLabel(label.trim()) + 1

  const handleScan = async (qrData: string) => {
    // Temporarily stop scanning while processing
    setScanning(false)

    try {
      const result = await recordScan(qrData, label.trim())

      if (result.success && result.position !== undefined) {
        setStatus('success')
        setMessage(`Stored as #${result.position} in ${label.trim()}`)
        setMaxPosition(result.position)
        if (!labels.includes(label.trim())) {
          setLabels([label.trim(), ...labels])
        }
      } else if (result.success) {
        setStatus('queued')
        setMessage(
          nextPosition !== null
            ? `Queued as #${nextPosition} (will sync when online)`
            : 'Scan queued! (will sync when online)'
        )
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

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <Card>
        <CardContent className="pt-6">
          <label className="block text-sm font-medium mb-2">
            Location Label
          </label>
          <Combobox
            value={label}
            onChange={(value) => updateState({ currentLabel: value })}
            options={labels}
            placeholder="e.g., Storage Box #3457"
            className="text-lg"
          />
          <div className="flex justify-between items-center mt-2">
            <p className="text-sm text-muted-foreground">
              Pick a previous label or type a new one
            </p>
            {label.trim() && (
              <p className="text-sm font-medium">
                {nextPosition === null ? 'Position: ...' : `Next position: ${nextPosition}`}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {!scanning ? (
          <Button
            onClick={() => setScanning(true)}
            size="lg"
            className="w-full"
            variant='outline'
            disabled={!label.trim()}
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

        {!label.trim() && (
          <p className="text-sm text-center text-muted-foreground">
            Enter a location label to start scanning
          </p>
        )}
      </div>
    </div>
  )
}

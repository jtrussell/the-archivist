import { useState, useEffect, useRef } from 'react'
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

// A code sitting in the viewfinder re-decodes every ~500ms; ignore repeats of
// the same code until it's been out of frame this long.
const SAME_CODE_COOLDOWN_MS = 3000

export function ScanView() {
  const { state, updateState } = useAppState()
  const [scanning, setScanning] = useState(false)
  const [status, setStatus] = useState<'idle' | 'success' | 'error' | 'queued'>('idle')
  const [message, setMessage] = useState('')
  const [labels, setLabels] = useState<string[]>([])
  const [maxPosition, setMaxPosition] = useState<number | null>(null)

  // The camera session stays open across scans; these gate the continuous
  // stream of decode results instead of tearing the camera down per deck.
  const processingRef = useRef(false)
  const lastScanRef = useRef<{ text: string; at: number } | null>(null)

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
    // Already handling a scan; the camera keeps running, just ignore hits
    if (processingRef.current) return

    // Same deck still sitting in the viewfinder — refresh the window so it
    // isn't recorded again until it's been out of frame for a while
    const now = Date.now()
    const last = lastScanRef.current
    if (last && last.text === qrData && now - last.at < SAME_CODE_COOLDOWN_MS) {
      last.at = now
      return
    }

    processingRef.current = true
    lastScanRef.current = { text: qrData, at: now }

    try {
      const result = await recordScan(qrData, label.trim())

      if (result.success && result.position !== undefined) {
        setStatus('success')
        const name = result.deckName
          ? `"${result.deckName}"`
          : 'Deck (name lookup failed — backfill later in Settings)'
        setMessage(`${name} stored as #${result.position} in ${label.trim()}`)
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
        // Allow an immediate retry of the same deck after a failure
        lastScanRef.current = null
      }

      // Brief cooldown before accepting the next deck
      setTimeout(() => {
        setStatus('idle')
        processingRef.current = false
      }, 1000)

    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : 'Unknown error')
      lastScanRef.current = null

      setTimeout(() => {
        setStatus('idle')
        processingRef.current = false
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
          <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:items-center mt-2">
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
              feedback={status === 'idle' ? null : status}
            />

            <Button
              onClick={() => {
                setScanning(false)
                setStatus('idle')
                processingRef.current = false
                lastScanRef.current = null
              }}
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

import { useEffect, useRef, useState } from 'react'
import { BrowserQRCodeReader } from '@zxing/browser'
import type { IScannerControls } from '@zxing/browser'
import { Button } from './ui/button'

export type ScanFeedback = 'success' | 'error' | 'queued'

interface QRScannerProps {
  onScan: (data: string) => void
  onError?: (error: Error) => void
  /** Flashes a colored confirmation overlay on the viewfinder while set */
  feedback?: ScanFeedback | null
}

const feedbackStyles: Record<ScanFeedback, string> = {
  success: 'bg-green-500',
  queued: 'bg-yellow-500',
  error: 'bg-red-500',
}

// focusMode and zoom aren't in the standard MediaTrackCapabilities typings yet
type CameraCapabilities = {
  focusMode?: string[]
  zoom?: { min?: number; max?: number }
}

/**
 * Best-effort camera tuning: continuous autofocus and a modest zoom so QR
 * codes can fill the frame from a comfortable distance (inside the lens's
 * focus range). No-ops on browsers/cameras without these capabilities.
 */
async function applyCameraEnhancements(video: HTMLVideoElement): Promise<void> {
  const stream = video.srcObject as MediaStream | null
  const track = stream?.getVideoTracks()[0]
  if (!track?.getCapabilities) return

  const capabilities = track.getCapabilities() as CameraCapabilities
  const advanced: Record<string, unknown>[] = []

  if (capabilities.focusMode?.includes('continuous')) {
    advanced.push({ focusMode: 'continuous' })
  }
  if (capabilities.zoom?.max !== undefined && capabilities.zoom.max > 1) {
    advanced.push({ zoom: Math.min(2, capabilities.zoom.max) })
  }

  if (advanced.length > 0) {
    try {
      await track.applyConstraints({ advanced } as MediaTrackConstraints)
    } catch {
      // Camera rejected the tuning; default behavior is still fine
    }
  }
}

/**
 * Holds a single camera session open for its entire lifetime, decoding
 * continuously and reporting every hit through onScan. Callers are
 * responsible for debouncing/deduping results. Tearing down and re-acquiring
 * the camera per scan is what we're avoiding: mobile browsers start
 * returning black frames after a few dozen rapid getUserMedia cycles.
 */
export function QRScanner({ onScan, onError, feedback = null }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [hasPermission, setHasPermission] = useState<boolean | null>(null)
  const [isScanning, setIsScanning] = useState(false)
  const [restartToken, setRestartToken] = useState(0)

  // Keep latest callbacks available to the long-lived decode loop without
  // restarting the camera session when they change identity.
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let cancelled = false
    let controls: IScannerControls | null = null
    let enhanceTimer: number | undefined

    const reader = new BrowserQRCodeReader()

    // Let the OS pick the main rear camera (best autofocus) instead of
    // enumerating devices ourselves: label-matching "back" often lands on
    // an ultra-wide lens, and labels are empty before permission is granted.
    const constraints: MediaStreamConstraints = {
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    }

    reader
      .decodeFromConstraints(constraints, video, (result) => {
        if (result && !cancelled) {
          onScanRef.current(result.getText())
        }
      })
      .then((scannerControls) => {
        if (cancelled) {
          // Unmounted while the camera was still starting; release it so the
          // stream doesn't outlive the component.
          scannerControls.stop()
          return
        }

        controls = scannerControls
        setIsScanning(true)
        setHasPermission(true)

        // Once the stream is attached, opt into continuous autofocus and a
        // modest zoom where supported (Android Chrome); browsers that don't
        // support these capabilities simply ignore them.
        enhanceTimer = window.setInterval(() => {
          if (video.srcObject) {
            window.clearInterval(enhanceTimer)
            applyCameraEnhancements(video)
          }
        }, 250)
      })
      .catch((error) => {
        if (cancelled) return

        console.error('Failed to start camera:', error)
        setHasPermission(false)
        setIsScanning(false)

        if (onErrorRef.current && error instanceof Error) {
          onErrorRef.current(error)
        }
      })

    return () => {
      cancelled = true
      if (enhanceTimer !== undefined) {
        window.clearInterval(enhanceTimer)
      }
      // Stops the decode loop, the stream's tracks, and detaches the video
      controls?.stop()
      setIsScanning(false)
    }
  }, [restartToken])

  const requestPermission = () => {
    setHasPermission(null)
    setRestartToken((token) => token + 1)
  }

  if (hasPermission === false) {
    return (
      <div className="flex flex-col items-center justify-center p-8 border rounded-lg bg-muted">
        <p className="text-center mb-4 text-muted-foreground">
          Camera access is required to scan QR codes
        </p>
        <Button onClick={requestPermission}>
          Grant Camera Access
        </Button>
      </div>
    )
  }

  return (
    <div className="relative w-full max-w-md mx-auto">
      <video
        ref={videoRef}
        className="w-full aspect-square object-cover rounded-lg border border-border bg-black"
        playsInline
        muted
      />

      {!isScanning && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg">
          <div className="text-white text-center">
            <p>Initializing camera...</p>
          </div>
        </div>
      )}

      {isScanning && (
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-[15%] border-2 border-white rounded-lg shadow-lg">
            <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-primary -translate-x-1 -translate-y-1" />
            <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-primary translate-x-1 -translate-y-1" />
            <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-primary -translate-x-1 translate-y-1" />
            <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-primary translate-x-1 translate-y-1" />
          </div>
        </div>
      )}

      {feedback && (
        <div
          className={`absolute inset-0 flex items-center justify-center rounded-lg pointer-events-none animate-scan-flash ${feedbackStyles[feedback]}`}
        >
          <svg
            className="w-24 h-24 text-white drop-shadow-lg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {feedback === 'error' ? (
              <>
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </>
            ) : (
              <polyline points="4 12.5 10 18.5 20 6.5" />
            )}
          </svg>
        </div>
      )}
    </div>
  )
}

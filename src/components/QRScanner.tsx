import { useEffect, useRef, useState } from 'react'
import { BrowserQRCodeReader } from '@zxing/browser'
import { Button } from './ui/button'

interface QRScannerProps {
  onScan: (data: string) => void
  onError?: (error: Error) => void
  scanning?: boolean
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

export function QRScanner({ onScan, onError, scanning = true }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [hasPermission, setHasPermission] = useState<boolean | null>(null)
  const [isScanning, setIsScanning] = useState(false)
  const readerRef = useRef<BrowserQRCodeReader | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!scanning) {
      stopScanning()
      return
    }

    startScanning()

    return () => {
      stopScanning()
    }
  }, [scanning])

  const startScanning = async () => {
    if (!videoRef.current || isScanning) return

    // Create abort controller for this scan session
    abortControllerRef.current = new AbortController()
    let enhanceTimer: number | undefined

    try {
      // Create reader if it doesn't exist
      if (!readerRef.current) {
        readerRef.current = new BrowserQRCodeReader()
      }

      const reader = readerRef.current

      setIsScanning(true)
      setHasPermission(true)

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

      // Scan once and automatically stop
      const decodePromise = reader.decodeOnceFromConstraints(
        constraints,
        videoRef.current
      )

      // Once the stream is attached, opt into continuous autofocus and a
      // modest zoom where supported (Android Chrome); browsers that don't
      // support these capabilities simply ignore them.
      enhanceTimer = window.setInterval(() => {
        if (videoRef.current?.srcObject) {
          window.clearInterval(enhanceTimer)
          applyCameraEnhancements(videoRef.current)
        }
      }, 250)

      const result = await decodePromise

      // Check if scan was aborted
      if (abortControllerRef.current?.signal.aborted) {
        return
      }

      const text = result.getText()
      onScan(text)

    } catch (error) {
      // Ignore errors from aborted scans
      if (abortControllerRef.current?.signal.aborted) {
        return
      }

      console.error('Failed to scan:', error)
      setHasPermission(false)
      setIsScanning(false)

      if (onError && error instanceof Error) {
        onError(error)
      }
    } finally {
      if (enhanceTimer !== undefined) {
        window.clearInterval(enhanceTimer)
      }
    }
  }

  const stopScanning = () => {
    // Abort any ongoing scan
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }

    // Stop video stream
    if (videoRef.current) {
      const stream = videoRef.current.srcObject as MediaStream | null
      if (stream) {
        stream.getTracks().forEach(track => track.stop())
      }
      videoRef.current.srcObject = null
    }

    setIsScanning(false)
  }

  const requestPermission = async () => {
    setHasPermission(null)
    await startScanning()
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

      {!isScanning && (hasPermission === null || hasPermission === true) && (
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
    </div>
  )
}

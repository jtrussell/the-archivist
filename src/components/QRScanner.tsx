import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { Button } from './ui/button'

interface QRScannerProps {
  onScan: (data: string) => void
  onError?: (error: Error) => void
  scanning?: boolean
}

export function QRScanner({ onScan, onError, scanning = true }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [hasPermission, setHasPermission] = useState<boolean | null>(null)
  const [isScanning, setIsScanning] = useState(false)
  const readerRef = useRef<BrowserMultiFormatReader | null>(null)

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

    try {
      if (!readerRef.current) {
        readerRef.current = new BrowserMultiFormatReader()
      }

      const reader = readerRef.current

      const videoInputDevices = await BrowserMultiFormatReader.listVideoInputDevices()

      if (videoInputDevices.length === 0) {
        throw new Error('No camera found on this device')
      }

      const backCamera = videoInputDevices.find((device: MediaDeviceInfo) =>
        device.label.toLowerCase().includes('back')
      )
      const selectedDeviceId = backCamera?.deviceId || videoInputDevices[0].deviceId

      setIsScanning(true)
      setHasPermission(true)

      reader.decodeFromVideoDevice(
        selectedDeviceId,
        videoRef.current,
        (result, error) => {
          if (result) {
            const text = result.getText()
            onScan(text)
            stopScanning()
          }

          if (error && error.name !== 'NotFoundException') {
            console.error('Scan error:', error)
          }
        }
      )
    } catch (error) {
      console.error('Failed to start scanner:', error)
      setHasPermission(false)
      setIsScanning(false)

      if (onError && error instanceof Error) {
        onError(error)
      }
    }
  }

  const stopScanning = () => {
    if (videoRef.current) {
      const stream = videoRef.current.srcObject as MediaStream | null
      if (stream) {
        stream.getTracks().forEach(track => track.stop())
      }
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

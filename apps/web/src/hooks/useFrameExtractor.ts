import { useRef, useCallback } from 'react'

const WS_URL = 'ws://localhost:4000/ws/frames'
const FPS = 1
const JPEG_QUALITY = 0.7
const MAX_WIDTH = 1280

export function useFrameExtractor() {
  const wsRef = useRef<WebSocket | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const start = useCallback((videoElement: HTMLVideoElement) => {
    // Create hidden canvas for frame extraction
    const canvas = document.createElement('canvas')
    canvasRef.current = canvas

    // Connect WebSocket to backend
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      console.log('[FrameExtractor] WebSocket connected')

      // Start extracting frames at 1fps
      intervalRef.current = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return
        if (!videoElement.videoWidth || !videoElement.videoHeight) return

        // Scale down to max 1280px wide
        const scale = Math.min(1, MAX_WIDTH / videoElement.videoWidth)
        canvas.width = Math.floor(videoElement.videoWidth * scale)
        canvas.height = Math.floor(videoElement.videoHeight * scale)

        const ctx = canvas.getContext('2d')
        if (!ctx) return

        ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height)
        const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
        const base64 = dataUrl.split(',')[1]

        ws.send(base64)
      }, 1000 / FPS)
    }

    ws.onerror = (e) => console.error('[FrameExtractor] WS error', e)
    ws.onclose = () => console.log('[FrameExtractor] WS closed')
  }, [])

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    wsRef.current?.close()
    wsRef.current = null
    console.log('[FrameExtractor] Stopped')
  }, [])

  return { start, stop }
}

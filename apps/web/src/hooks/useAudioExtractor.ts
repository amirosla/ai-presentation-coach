import { useRef, useCallback } from 'react'

const WS_URL = 'ws://localhost:4000/ws/audio'
const SAMPLE_RATE = 16000
const BUFFER_SIZE = 4096

export function useAudioExtractor() {
  const wsRef = useRef<WebSocket | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)

  const start = useCallback((audioStream: MediaStream) => {
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      console.log('[AudioExtractor] WebSocket connected')

      // AudioContext at 16kHz — Gemini requires exactly this rate
      const audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE })
      audioCtxRef.current = audioCtx

      const source = audioCtx.createMediaStreamSource(audioStream)

      // ScriptProcessor captures raw PCM Float32 samples
      const processor = audioCtx.createScriptProcessor(BUFFER_SIZE, 1, 1)
      processorRef.current = processor

      processor.onaudioprocess = (event) => {
        if (ws.readyState !== WebSocket.OPEN) return

        const float32 = event.inputBuffer.getChannelData(0)

        // Convert Float32 → Int16 (Gemini expects 16-bit signed PCM)
        const int16 = new Int16Array(float32.length)
        for (let i = 0; i < float32.length; i++) {
          const clamped = Math.max(-1, Math.min(1, float32[i]))
          int16[i] = Math.round(clamped * 32767)
        }

        ws.send(int16.buffer)
      }

      source.connect(processor)
      // Connect to destination to keep the processor alive (Chrome requirement)
      processor.connect(audioCtx.destination)
    }

    ws.onerror = (e) => console.error('[AudioExtractor] WS error', e)
    ws.onclose = () => console.log('[AudioExtractor] WS closed')
  }, [])

  const stop = useCallback(() => {
    processorRef.current?.disconnect()
    processorRef.current = null
    audioCtxRef.current?.close()
    audioCtxRef.current = null
    wsRef.current?.close()
    wsRef.current = null
    console.log('[AudioExtractor] Stopped')
  }, [])

  return { start, stop }
}

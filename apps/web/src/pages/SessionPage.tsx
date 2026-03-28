import { useEffect, useRef, useState, useCallback } from 'react'
import { create } from '@fishjam-dev/react-client'
import { useWhipStream } from '../hooks/useWhipStream'
import { useFrameExtractor } from '../hooks/useFrameExtractor'
import { useAudioExtractor } from '../hooks/useAudioExtractor'

type PeerMetadata = { name: string }
type TrackMetadata = { type: 'screen' | 'audio' }

export const {
  FishjamContextProvider,
  useConnect,
  useDisconnect,
  useStatus,
  useClient,
} = create<PeerMetadata, TrackMetadata>()

type PeerStatus = 'idle' | 'connecting' | 'connected' | 'error'
type CoachMsg = { type: string; message: string; severity: 'info' | 'warning' | 'urgent'; id: number; time: string }

const COLORS = { info: '#3b82f6', warning: '#f59e0b', urgent: '#ef4444' }
const ICONS: Record<string, string> = { tempo: '⏱️', slide_time: '📊', suggestion: '💡', clarity: '🔊' }

function SessionInner() {
  const connect = useConnect()
  const disconnect = useDisconnect()
  const fishjamStatus = useStatus()
  const client = useClient()

  const { connect: whipConnect, disconnect: whipDisconnect } = useWhipStream()
  const { start: startFrames, stop: stopFrames } = useFrameExtractor()
  const { start: startAudio, stop: stopAudio } = useAudioExtractor()

  const [peerStatus, setPeerStatus] = useState<PeerStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [coachMessages, setCoachMessages] = useState<CoachMsg[]>([])
  const [sessionSeconds, setSessionSeconds] = useState(0)
  const [wsConnected, setWsConnected] = useState(false)

  const screenVideoRef = useRef<HTMLVideoElement>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const audioStreamRef = useRef<MediaStream | null>(null)
  const msgIdRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // WebSocket to /ws/coach with auto-reconnect
  useEffect(() => {
    let ws: WebSocket
    let dead = false

    const openWs = () => {
      if (dead) return
      ws = new WebSocket('ws://localhost:4000/ws/coach')
      ws.onopen = () => setWsConnected(true)
      ws.onclose = () => {
        setWsConnected(false)
        if (!dead) setTimeout(openWs, 2000)
      }
      ws.onerror = () => ws.close()
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.type && msg.message && msg.severity) {
            const now = new Date()
            const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`
            setCoachMessages(prev => [
              { ...msg, id: ++msgIdRef.current, time },
              ...prev,
            ].slice(0, 8))
          }
        } catch {}
      }
    }

    openWs()
    return () => { dead = true; ws?.close() }
  }, [])

  // Session timer
  useEffect(() => {
    if (peerStatus === 'connected') {
      setSessionSeconds(0)
      timerRef.current = setInterval(() => setSessionSeconds(s => s + 1), 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [peerStatus])

  // Set video srcObject
  useEffect(() => {
    if (peerStatus === 'connected' && screenVideoRef.current && screenStreamRef.current) {
      screenVideoRef.current.srcObject = screenStreamRef.current
    }
  }, [peerStatus])

  const startSession = async () => {
    setPeerStatus('connecting')
    setError(null)
    setCoachMessages([])

    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false })
      screenStreamRef.current = screenStream

      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true },
        video: false,
      })
      audioStreamRef.current = audioStream

      const roomRes = await fetch('/api/room', { method: 'POST' })
      if (!roomRes.ok) throw new Error(`Backend error: ${roomRes.status}`)
      const { peerToken } = await roomRes.json()

      connect({ peerMetadata: { name: 'presenter' }, token: peerToken, signaling: { protocol: 'ws', host: 'localhost:5002' } })

      const smelterRes = await fetch('/api/smelter-config')
      if (smelterRes.ok) {
        const smelterCfg = await smelterRes.json()
        try {
          const combinedStream = new MediaStream([...screenStream.getVideoTracks(), ...audioStream.getAudioTracks()])
          await whipConnect(combinedStream, smelterCfg)
        } catch (whipErr) {
          console.warn('[WHIP] Failed, continuing without Smelter push:', whipErr)
        }
      }

      startAudio(audioStream)
      setPeerStatus('connected')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setError(msg)
      setPeerStatus('error')
      screenStreamRef.current?.getTracks().forEach(t => t.stop())
      audioStreamRef.current?.getTracks().forEach(t => t.stop())
    }
  }

  useEffect(() => {
    if (fishjamStatus !== 'joined' || !client) return
    const screenStream = screenStreamRef.current
    const audioStream = audioStreamRef.current
    screenStream?.getVideoTracks().forEach(t => client.addTrack(t, screenStream, { type: 'screen' }))
    audioStream?.getAudioTracks().forEach(t => client.addTrack(t, audioStream, { type: 'audio' }))
  }, [fishjamStatus, client])

  useEffect(() => {
    if (peerStatus !== 'connected') return
    const video = screenVideoRef.current
    if (!video) return
    const onPlaying = () => startFrames(video)
    video.addEventListener('playing', onPlaying)
    if (!video.paused && video.readyState >= 3) startFrames(video)
    return () => video.removeEventListener('playing', onPlaying)
  }, [peerStatus, startFrames])

  const stopSession = useCallback(() => {
    disconnect()
    whipDisconnect()
    stopFrames()
    stopAudio()
    screenStreamRef.current?.getTracks().forEach(t => t.stop())
    audioStreamRef.current?.getTracks().forEach(t => t.stop())
    if (screenVideoRef.current) screenVideoRef.current.srcObject = null
    setPeerStatus('idle')
    setCoachMessages([])
  }, [disconnect, whipDisconnect, stopFrames, stopAudio])

  useEffect(() => {
    const stream = screenStreamRef.current
    if (!stream) return
    const track = stream.getVideoTracks()[0]
    if (!track) return
    track.onended = stopSession
    return () => { track.onended = null }
  }, [peerStatus, stopSession])

  const formatTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  return (
    <>
      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(-8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0.4); }
          50%       { box-shadow: 0 0 0 6px rgba(34,197,94,0); }
        }
        .coach-msg { animation: fadeSlideIn 0.3s ease; }
        .pulse-dot { animation: pulse 2s infinite; }
      `}</style>

      <div style={{ display: 'flex', height: '100vh', background: '#0a0a0a', fontFamily: 'system-ui, sans-serif' }}>

        {/* Left: screen preview */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', gap: '1.5rem' }}>

          {/* Timer */}
          {peerStatus === 'connected' && (
            <div style={{ fontSize: '0.85rem', color: '#555', fontVariantNumeric: 'tabular-nums' }}>
              Session: <span style={{ color: '#aaa', fontWeight: 600 }}>{formatTime(sessionSeconds)}</span>
            </div>
          )}

          <div style={{ width: '100%', maxWidth: '900px', aspectRatio: '16/9', background: '#1a1a1a', borderRadius: '12px', overflow: 'hidden', border: '1px solid #2a2a2a', position: 'relative' }}>
            {peerStatus === 'connected' ? (
              <video ref={screenVideoRef} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444', flexDirection: 'column', gap: '0.5rem' }}>
                <span style={{ fontSize: '2rem' }}>🖥️</span>
                <span style={{ fontSize: '0.9rem' }}>Screen preview will appear here</span>
              </div>
            )}
          </div>

          {peerStatus === 'idle' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
              <button onClick={startSession} style={btnStyle('#4f46e5')}>Start Session</button>
              <p style={{ color: '#555', fontSize: '0.78rem', margin: 0, textAlign: 'center' }}>
                💡 Share a specific app window (not your entire screen) for better coaching
              </p>
            </div>
          )}
          {peerStatus === 'connecting' && (
            <button disabled style={btnStyle('#333')}>Connecting...</button>
          )}
          {peerStatus === 'connected' && (
            <button onClick={stopSession} style={btnStyle('#dc2626')}>Stop Session</button>
          )}
          {error && <p style={{ color: '#f87171', fontSize: '0.9rem', maxWidth: 400, textAlign: 'center' }}>{error}</p>}
          <StatusBadge status={fishjamStatus} />
        </div>

        {/* Right: AI Coach panel */}
        <div style={{ width: '340px', borderLeft: '1px solid #1a1a1a', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', background: '#0d0d0d' }}>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span
                className={fishjamStatus === 'joined' ? 'pulse-dot' : ''}
                style={{ width: 10, height: 10, borderRadius: '50%', background: fishjamStatus === 'joined' ? '#22c55e' : '#333', display: 'inline-block' }}
              />
              <span style={{ fontWeight: 700, fontSize: '1rem' }}>AI Coach</span>
            </div>
            <span style={{ fontSize: '0.7rem', color: wsConnected ? '#22c55e' : '#555' }}>
              {wsConnected ? '● connected' : '○ reconnecting...'}
            </span>
          </div>

          <p style={{ color: '#444', fontSize: '0.8rem', margin: 0 }}>
            {fishjamStatus === 'joined'
              ? 'Analyzing your presentation every 10 seconds...'
              : 'Start a session to get real-time coaching.'}
          </p>

          {/* Messages */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', overflowY: 'auto', flex: 1 }}>
            {coachMessages.length === 0 && peerStatus === 'connected' && (
              <div style={{ color: '#333', fontSize: '0.8rem', textAlign: 'center', marginTop: '2rem' }}>
                First feedback in ~10s...
              </div>
            )}
            {coachMessages.map((msg) => {
              const color = COLORS[msg.severity]
              return (
                <div
                  key={msg.id}
                  className="coach-msg"
                  style={{
                    background: '#141414',
                    border: `1px solid ${color}22`,
                    borderLeft: `3px solid ${color}`,
                    borderRadius: '8px',
                    padding: '0.75rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                    <span style={{ fontSize: '0.7rem', color, fontWeight: 700, letterSpacing: '0.05em' }}>
                      {ICONS[msg.type] ?? '🎯'} {msg.type.replace('_', ' ').toUpperCase()}
                    </span>
                    <span style={{ fontSize: '0.65rem', color: '#555' }}>{msg.time}</span>
                  </div>
                  <div style={{ fontSize: '0.85rem', color: '#d1d5db', lineHeight: 1.5 }}>{msg.message}</div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null
  const color = status === 'joined' ? '#22c55e' : status === 'error' ? '#ef4444' : '#facc15'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block' }} />
      Fishjam: {status}
    </div>
  )
}

function btnStyle(bg: string): React.CSSProperties {
  return {
    padding: '0.75rem 2.5rem',
    fontSize: '1rem',
    fontWeight: 600,
    background: bg,
    color: '#fff',
    border: 'none',
    borderRadius: '10px',
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  }
}

export default function SessionPage() {
  return (
    <FishjamContextProvider>
      <SessionInner />
    </FishjamContextProvider>
  )
}

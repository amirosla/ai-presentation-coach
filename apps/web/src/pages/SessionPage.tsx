import { useEffect, useRef, useState } from 'react'
import { create } from '@fishjam-dev/react-client'

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

function SessionInner() {
  const connect = useConnect()
  const disconnect = useDisconnect()
  const fishjamStatus = useStatus()
  const client = useClient()

  const [peerStatus, setPeerStatus] = useState<PeerStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const screenVideoRef = useRef<HTMLVideoElement>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const audioStreamRef = useRef<MediaStream | null>(null)

  const startSession = async () => {
    setPeerStatus('connecting')
    setError(null)

    try {
      // 1. Capture screen
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 5 },
        audio: false,
      })
      screenStreamRef.current = screenStream

      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = screenStream
      }

      // 2. Capture microphone
      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true },
        video: false,
      })
      audioStreamRef.current = audioStream

      // 3. Get Fishjam peer token from backend
      const res = await fetch('/api/room', { method: 'POST' })
      if (!res.ok) throw new Error(`Backend error: ${res.status}`)
      const { peerToken } = await res.json()

      // 4. Connect to Fishjam (default host: localhost:5002)
      connect({
        peerMetadata: { name: 'presenter' },
        token: peerToken,
        signaling: { protocol: 'ws', host: 'localhost:5002' },
      })

      setPeerStatus('connected')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setError(msg)
      setPeerStatus('error')
      screenStreamRef.current?.getTracks().forEach(t => t.stop())
      audioStreamRef.current?.getTracks().forEach(t => t.stop())
    }
  }

  // Publish tracks once Fishjam reports "joined"
  useEffect(() => {
    if (fishjamStatus !== 'joined' || !client) return

    const screenStream = screenStreamRef.current
    const audioStream = audioStreamRef.current

    screenStream?.getVideoTracks().forEach(track => {
      client.addTrack(track, screenStream, { type: 'screen' })
    })
    audioStream?.getAudioTracks().forEach(track => {
      client.addTrack(track, audioStream, { type: 'audio' })
    })
  }, [fishjamStatus, client])

  const stopSession = () => {
    disconnect()
    screenStreamRef.current?.getTracks().forEach(t => t.stop())
    audioStreamRef.current?.getTracks().forEach(t => t.stop())
    if (screenVideoRef.current) screenVideoRef.current.srcObject = null
    setPeerStatus('idle')
  }

  // Stop session if user closes screen share natively
  useEffect(() => {
    const stream = screenStreamRef.current
    if (!stream) return
    const track = stream.getVideoTracks()[0]
    if (!track) return
    track.onended = stopSession
    return () => { track.onended = null }
  }, [peerStatus])

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#0f0f0f' }}>

      {/* Left: screen preview */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', gap: '1.5rem' }}>
        <div style={{ width: '100%', maxWidth: '900px', aspectRatio: '16/9', background: '#1a1a1a', borderRadius: '12px', overflow: 'hidden', border: '1px solid #333' }}>
          {peerStatus === 'connected' ? (
            <video ref={screenVideoRef} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555' }}>
              Screen preview will appear here
            </div>
          )}
        </div>

        {peerStatus === 'idle' && (
          <button onClick={startSession} style={btnStyle('#4f46e5')}>Start Session</button>
        )}
        {peerStatus === 'connecting' && (
          <button disabled style={btnStyle('#555')}>Connecting...</button>
        )}
        {peerStatus === 'connected' && (
          <button onClick={stopSession} style={btnStyle('#dc2626')}>Stop Session</button>
        )}
        {error && <p style={{ color: '#f87171', fontSize: '0.9rem' }}>{error}</p>}

        <StatusBadge status={fishjamStatus} />
      </div>

      {/* Right: AI Coach panel */}
      <div style={{ width: '320px', borderLeft: '1px solid #222', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <PulseDot active={fishjamStatus === 'joined'} />
          <span style={{ fontWeight: 600 }}>AI Coach</span>
        </div>
        <p style={{ color: '#555', fontSize: '0.85rem' }}>
          {fishjamStatus === 'joined'
            ? 'Listening and watching your presentation...'
            : 'Start a session to get real-time coaching.'}
        </p>
        {/* Feedback messages — Etap 4 */}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null
  const color = status === 'joined' ? '#22c55e' : status === 'error' ? '#ef4444' : '#facc15'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
      Fishjam: {status}
    </div>
  )
}

function PulseDot({ active }: { active: boolean }) {
  return (
    <span style={{
      width: 10, height: 10, borderRadius: '50%',
      background: active ? '#22c55e' : '#444',
      display: 'inline-block',
      boxShadow: active ? '0 0 0 3px rgba(34,197,94,0.3)' : 'none',
    }} />
  )
}

function btnStyle(bg: string): React.CSSProperties {
  return { padding: '0.75rem 2rem', fontSize: '1rem', fontWeight: 600, background: bg, color: '#fff', border: 'none', borderRadius: '8px' }
}

export default function SessionPage() {
  return (
    <FishjamContextProvider>
      <SessionInner />
    </FishjamContextProvider>
  )
}

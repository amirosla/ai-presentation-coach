import { useRef, useCallback } from 'react'

type WhipConfig = {
  whipEndpoint: string
  whipBearerToken: string
}

export function useWhipStream() {
  const pcRef = useRef<RTCPeerConnection | null>(null)

  const connect = useCallback(async (stream: MediaStream, config: WhipConfig) => {
    if (pcRef.current) {
      pcRef.current.close()
    }

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    })
    pcRef.current = pc

    // Add all tracks from the stream
    stream.getTracks().forEach(track => pc.addTrack(track, stream))

    // Create offer
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)

    // Wait for ICE gathering to complete
    await new Promise<void>(resolve => {
      if (pc.iceGatheringState === 'complete') return resolve()
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') resolve()
      }
      // Timeout fallback after 3s
      setTimeout(resolve, 3000)
    })

    // Send offer to Smelter WHIP endpoint
    const res = await fetch(config.whipEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sdp',
        'Authorization': `Bearer ${config.whipBearerToken}`,
      },
      body: pc.localDescription?.sdp,
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`WHIP offer rejected: ${res.status} ${text}`)
    }

    const answerSdp = await res.text()
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })

    console.log('[WHIP] Connected to Smelter')
    return pc
  }, [])

  const disconnect = useCallback(() => {
    pcRef.current?.close()
    pcRef.current = null
    console.log('[WHIP] Disconnected from Smelter')
  }, [])

  return { connect, disconnect }
}

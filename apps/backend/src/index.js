import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../../.env') })
import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { WebSocketServer } from 'ws'

const app = express()
const server = createServer(app)
const PORT = process.env.PORT || 4000
const FISHJAM_URL = process.env.FISHJAM_SERVER_URL || 'http://localhost:5002'
const FISHJAM_TOKEN = process.env.FISHJAM_SERVER_TOKEN

app.use(cors())
app.use(express.json())

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Create Fishjam room + peer, return peer token to frontend
app.post('/api/room', async (_req, res) => {
  try {
    // 1. Create room
    const roomRes = await fetch(`${FISHJAM_URL}/room`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FISHJAM_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ maxPeers: 10 }),
    })

    if (!roomRes.ok) {
      const text = await roomRes.text()
      throw new Error(`Fishjam create room failed: ${roomRes.status} ${text}`)
    }

    const roomData = await roomRes.json()
    const roomId = roomData.data.room.id
    console.log(`[Fishjam] Room created: ${roomId}`)

    // 2. Add peer to room
    const peerRes = await fetch(`${FISHJAM_URL}/room/${roomId}/peer`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FISHJAM_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'webrtc' }),
    })

    if (!peerRes.ok) {
      const text = await peerRes.text()
      throw new Error(`Fishjam add peer failed: ${peerRes.status} ${text}`)
    }

    const peerData = await peerRes.json()
    const peerToken = peerData.data.token
    console.log(`[Fishjam] Peer created in room ${roomId}`)

    res.json({
      roomId,
      peerToken,
      fishjamUrl: FISHJAM_URL.replace('http', 'ws').replace('https', 'wss'),
    })
  } catch (err) {
    console.error('[Fishjam] Error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// WebSocket server — pushes AI feedback to frontend clients
const wss = new WebSocketServer({ server, path: '/ws' })

wss.on('connection', (ws) => {
  console.log('[WS] Frontend client connected')
  ws.on('close', () => console.log('[WS] Frontend client disconnected'))
})

server.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`)
})

import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../../.env') })

import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { WebSocketServer } from 'ws'
import { initSmelter, getSmelterConfig } from './smelter.js'

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

// Create Fishjam room + peer
app.post('/api/room', async (_req, res) => {
  try {
    const roomRes = await fetch(`${FISHJAM_URL}/room`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FISHJAM_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ maxPeers: 10 }),
    })
    if (!roomRes.ok) throw new Error(`Fishjam create room failed: ${roomRes.status} ${await roomRes.text()}`)
    const roomData = await roomRes.json()
    const roomId = roomData.data.room.id
    console.log(`[Fishjam] Room created: ${roomId}`)

    const peerRes = await fetch(`${FISHJAM_URL}/room/${roomId}/peer`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FISHJAM_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'webrtc' }),
    })
    if (!peerRes.ok) throw new Error(`Fishjam add peer failed: ${peerRes.status} ${await peerRes.text()}`)
    const peerData = await peerRes.json()
    console.log(`[Fishjam] Peer created in room ${roomId}`)

    res.json({
      roomId,
      peerToken: peerData.data.token,
      fishjamUrl: FISHJAM_URL.replace('http', 'ws').replace('https', 'wss'),
    })
  } catch (err) {
    console.error('[Fishjam] Error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Return Smelter WHIP config to frontend
app.get('/api/smelter-config', (_req, res) => {
  const cfg = getSmelterConfig()
  if (!cfg) return res.status(503).json({ error: 'Smelter not ready' })
  res.json(cfg)
})

// ── WebSocket servers ──────────────────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true })
const frameWss = new WebSocketServer({ noServer: true })

// Route WS connections by path
server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws/coach') {
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
  } else if (req.url === '/ws/frames') {
    frameWss.handleUpgrade(req, socket, head, ws => frameWss.emit('connection', ws, req))
  } else {
    socket.destroy()
  }
})

// Frontend clients receiving AI feedback
wss.on('connection', (ws) => {
  console.log('[WS/coach] Frontend connected')
  ws.on('close', () => console.log('[WS/coach] Frontend disconnected'))
})

// Frontend sends canvas frames here
frameWss.on('connection', (ws) => {
  console.log('[WS/frames] Frame stream connected')

  ws.on('message', (data) => {
    // data = base64 JPEG string
    const frameB64 = data.toString()
    console.log(`[WS/frames] Frame received, size: ${frameB64.length} chars`)
    // TODO Etap 3: forward to Gemini Live API
  })

  ws.on('close', () => console.log('[WS/frames] Frame stream disconnected'))
})

// Helper: broadcast AI feedback to all coach clients
export function broadcastCoachMessage(msg) {
  const json = JSON.stringify(msg)
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(json)
  })
}

// ── Start ──────────────────────────────────────────────────────────────────

server.listen(PORT, async () => {
  console.log(`Backend running on http://localhost:${PORT}`)
  await initSmelter()
})

import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { WebSocketServer } from 'ws'

const app = express()
const server = createServer(app)
const PORT = process.env.PORT || 4000

app.use(cors())
app.use(express.json())

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// WebSocket server — will push AI feedback to frontend clients
const wss = new WebSocketServer({ server, path: '/ws' })

wss.on('connection', (ws) => {
  console.log('[WS] Frontend client connected')

  ws.on('close', () => {
    console.log('[WS] Frontend client disconnected')
  })
})

server.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`)
})

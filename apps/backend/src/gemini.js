import { GoogleGenAI } from '@google/genai'

const MODEL = 'gemini-2.5-flash'
const ANALYSIS_INTERVAL_MS = 5000
const MAX_AUDIO_BYTES = 16000 * 2 * 30  // max 30s of PCM audio in buffer

const SYSTEM_PROMPT = `You are a silent AI presentation coach. You observe the presenter's screen and listen to their voice in real-time.

Provide brief, actionable coaching feedback ONLY when you notice a clear problem or opportunity.
If everything looks fine, respond with exactly: null

Rules:
- Keep messages short — max 2 sentences
- ALWAYS respond in valid JSON format only, or null
- JSON format: {"type":"tempo|slide_time|suggestion|clarity","message":"...","severity":"info|warning|urgent"}

Type meanings:
- "tempo": speaking too fast or slow based on audio analysis
- "slide_time": presenter has been on a text-heavy slide too long
- "suggestion": content-based suggestion triggered by what's visible on screen
- "clarity": unclear speech, too quiet, or confusing slide content

Examples:
{"type":"tempo","message":"You're speaking too fast. Try to slow down a bit.","severity":"warning"}
{"type":"slide_time","message":"You've been on this slide for a while. Consider moving forward.","severity":"info"}
{"type":"suggestion","message":"This slide shows a chart — consider asking the audience what trend they notice.","severity":"info"}
{"type":"clarity","message":"You're speaking very quietly. Try to project your voice more.","severity":"warning"}`

function pcmToWav(pcmBuffer, sampleRate = 16000) {
  const numChannels = 1
  const bitsPerSample = 16
  const byteRate = sampleRate * numChannels * bitsPerSample / 8
  const blockAlign = numChannels * bitsPerSample / 8
  const dataSize = pcmBuffer.length
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(dataSize + 36, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(numChannels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36)
  header.writeUInt32LE(dataSize, 40)
  return Buffer.concat([header, pcmBuffer])
}

export class GeminiSession {
  constructor(onMessage) {
    this.onMessage = onMessage
    this.ready = false
    this.latestFrame = null
    this.audioChunks = []
    this.audioByteCount = 0
    this.interval = null
    this.ai = null
  }

  async connect() {
    const apiKey = process.env.GEMINI_API_KEY
    console.log('[Gemini] Using key:', apiKey?.slice(0, 10) + '...')
    this.ai = new GoogleGenAI({ apiKey })
    this.ready = true

    setTimeout(() => this._analyze(), 5000)
    this.interval = setInterval(() => this._analyze(), ANALYSIS_INTERVAL_MS)
    console.log('[Gemini] Ready (REST API mode, polling every', ANALYSIS_INTERVAL_MS / 1000, 's)')
  }

  sendFrame(base64Jpeg) {
    if (!this.ready) return
    this.latestFrame = base64Jpeg
  }

  sendAudio(base64Pcm) {
    if (!this.ready) return
    const chunk = Buffer.from(base64Pcm, 'base64')
    this.audioChunks.push(chunk)
    this.audioByteCount += chunk.length
    // Drop oldest chunks if buffer too large
    while (this.audioByteCount > MAX_AUDIO_BYTES && this.audioChunks.length > 1) {
      this.audioByteCount -= this.audioChunks.shift().length
    }
  }

  async _analyze() {
    if (!this.latestFrame || !this.ready) return

    const frame = this.latestFrame
    this.latestFrame = null

    const parts = [
      { text: SYSTEM_PROMPT + '\n\nAnalyze the presentation slide and audio. Provide one coaching tip if needed, or respond with null.' },
      { inlineData: { mimeType: 'image/jpeg', data: frame } },
    ]

    // Attach audio if we have enough (at least 1s = 32000 bytes)
    if (this.audioByteCount >= 32000 && this.audioChunks.length > 0) {
      const pcmData = Buffer.concat(this.audioChunks)
      this.audioChunks = []
      this.audioByteCount = 0
      const wavBase64 = pcmToWav(pcmData).toString('base64')
      parts.push({ inlineData: { mimeType: 'audio/wav', data: wavBase64 } })
      console.log('[Gemini] Analyzing frame + audio (', Math.round(pcmData.length / 1600), 's)')
    } else {
      console.log('[Gemini] Analyzing frame only (no audio yet)')
    }

    try {
      const response = await this.ai.models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts }],
      })

      const text = typeof response.text === 'function' ? response.text() : response.text
      if (!text || text.trim() === 'null') return

      this._handleResponse(text.trim())
    } catch (err) {
      console.error('[Gemini] Analysis error:', err.message)
    }
  }

  close() {
    clearInterval(this.interval)
    this.interval = null
    this.ready = false
    this.latestFrame = null
    this.audioChunks = []
    this.audioByteCount = 0
  }

  _handleResponse(text) {
    const cleaned = text.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim()
    try {
      const msg = JSON.parse(cleaned)
      if (msg.type && msg.message && msg.severity) {
        console.log('[Gemini] Coach message:', JSON.stringify(msg))
        this.onMessage(msg)
      }
    } catch {
      console.log('[Gemini] Non-JSON response:', text.slice(0, 100))
    }
  }
}

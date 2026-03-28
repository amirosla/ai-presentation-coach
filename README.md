# AI Presentation Coach

Real-time AI coaching for presenters. Captures your screen and microphone during a live presentation, analyzes them with Gemini, and delivers instant feedback — "slow down", "you've been on this slide too long", "your audio is disconnected from the slide content".

## How it works

```
Browser (screen + mic)
  │
  ├─► WebSocket /ws/frames  (1fps JPEG) ──► Gemini API ──► coaching JSON
  ├─► WebSocket /ws/audio   (PCM 16kHz) ──►     ↑
  └─► WebRTC via Fishjam ──► Smelter (compositor)
                                                 │
  Browser ◄── WebSocket /ws/coach (feedback) ◄──┘
```

Every 5 seconds the backend sends the latest screen frame + accumulated audio to Gemini 2.5 Flash. Gemini responds with a JSON coaching tip that appears instantly in the UI.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite + TypeScript |
| Backend | Node.js + Express + WebSocket (`ws`) |
| WebRTC SFU | Fishjam |
| Video compositor | Smelter |
| AI | Google Gemini 2.5 Flash (`@google/genai`) |

## Prerequisites

- Node.js 18+
- Docker + Docker Compose
- Google Gemini API key ([aistudio.google.com/apikey](https://aistudio.google.com/apikey))

## Setup

**1. Clone and install dependencies**

```bash
npm install --prefix apps/backend
npm install --prefix apps/web
```

**2. Configure environment**

Create `.env` in the project root:

```env
GEMINI_API_KEY=your_key_here
FISHJAM_SERVER_TOKEN=supersecret123
FISHJAM_SERVER_URL=http://localhost:5002
PORT=4000
```

**3. Start infrastructure**

```bash
docker compose up -d
```

Starts Fishjam (port 5002) and Smelter (ports 8081, 9000).

**4. Start backend**

```bash
cd apps/backend && npm run dev
```

**5. Start frontend**

```bash
cd apps/web && npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

## Usage

1. Click **Start Session**
2. When prompted, share a **specific application window** (not your entire screen — the mirror effect confuses the AI)
3. Allow microphone access
4. Start presenting — coaching tips appear in the right panel every 5 seconds

## Coaching feedback types

| Type | Meaning |
|---|---|
| `tempo` | Speaking too fast or too slow |
| `slide_time` | Staying on a slide too long |
| `suggestion` | Content-based tip from what's visible |
| `clarity` | Unclear speech or confusing slide layout |

Severity levels: `info` (blue), `warning` (yellow), `urgent` (red)

## Architecture notes

- Screen frames are extracted via canvas at 1fps on the frontend and sent over WebSocket as base64 JPEG
- Audio is captured at 16kHz mono PCM, converted to WAV with a proper header, and sent alongside each frame
- Fishjam handles WebRTC room management; Smelter receives the stream via WHIP for video composition
- If Smelter is unavailable, the frame pipeline falls back to canvas extraction only

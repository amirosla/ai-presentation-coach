const SMELTER_URL = process.env.SMELTER_URL || 'http://localhost:8081'
const INPUT_ID = 'screen_input'
const OUTPUT_ID = 'screen_output'

async function smelterPost(path, body) {
  const res = await fetch(`${SMELTER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Smelter ${path} failed: ${res.status} ${text}`)
  return text ? JSON.parse(text) : {}
}

let smelterConfig = null

export async function initSmelter() {
  try {
    // Reset to clean state
    await smelterPost('/api/reset', {})
    console.log('[Smelter] Reset OK')

    // Register WHIP server input (browser will push stream here)
    const inputRes = await smelterPost(`/api/input/${INPUT_ID}/register`, {
      type: 'whip_server',
      required: false,
    })
    console.log('[Smelter] WHIP input registered, bearer:', inputRes.bearer_token?.slice(0, 8) + '...')

    // Register WHEP server output (passthrough layout: show screen_input)
    const outputRes = await smelterPost(`/api/output/${OUTPUT_ID}/register`, {
      type: 'whep_server',
      video: {
        resolution: { width: 1280, height: 720 },
        encoder: { type: 'ffmpeg_h264', preset: 'ultrafast' },
        initial: {
          root: {
            type: 'input_stream',
            input_id: INPUT_ID,
          },
        },
      },
      audio: {
        encoder: { type: 'opus', sample_rate: 16000 },
        initial: {
          inputs: [{ input_id: INPUT_ID }],
        },
      },
    })
    console.log('[Smelter] WHEP output registered:', outputRes.endpoint_route || OUTPUT_ID)

    // Start Smelter processing
    await smelterPost('/api/start', {})
    console.log('[Smelter] Started')

    smelterConfig = {
      whipEndpoint: `http://localhost:9000/whip/${INPUT_ID}`,
      whipBearerToken: inputRes.bearer_token,
      whepEndpoint: `http://localhost:9000/whep/${outputRes.endpoint_route || OUTPUT_ID}`,
    }

    return smelterConfig
  } catch (err) {
    console.error('[Smelter] Init failed:', err.message)
    // Non-fatal — AI pipeline still works via canvas frames
    return null
  }
}

export function getSmelterConfig() {
  return smelterConfig
}

import { createClient } from '@supabase/supabase-js'
import { recordSchema } from '../../../shared/record-schema.ts'

const MAX_BYTES = 65536
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
})

// No CORS de navegador: este endpoint es servidor-a-servidor.
// verify_jwt=false porque se utiliza una credencial de integración propia,
// NO porque la función sea pública sin autenticación.
export async function handleRequest(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' })
  const bearer = request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/i)?.[1]
  if (!bearer) return json(401, { error: 'INVALID_CREDENTIAL' })
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return json(415, { error: 'JSON_REQUIRED' })
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BYTES) return json(413, { error: 'PAYLOAD_TOO_LARGE' })

  let payload: unknown
  try {
    const reader = request.body?.getReader()
    if (!reader) return json(400, { error: 'EMPTY_BODY' })
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BYTES) { await reader.cancel(); return json(413, { error: 'PAYLOAD_TOO_LARGE' }) }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch { return json(400, { error: 'INVALID_JSON' }) }

  const parsed = recordSchema.safeParse(payload)
  if (!parsed.success) return json(422, { error: 'INVALID_RECORD', issues: parsed.error.issues.map(({ path, message }) => ({ path: path.join('.'), message })) })
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return json(503, { error: 'SERVICE_NOT_CONFIGURED' })
  const keyHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bearer)))].map(byte => byte.toString(16).padStart(2, '0')).join('')
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  try {
    const { data, error } = await admin.rpc('ingest_record', { p_payload: parsed.data, p_key_hash: keyHash })
    if (error) {
      const code = error.message.split(':')[0]
      const statuses: Record<string, number> = { INVALID_CREDENTIAL: 401, FORBIDDEN_PRODUCER: 403, NODE_MISMATCH: 403, ALERT_PRODUCER_REQUIRED: 403, UNKNOWN_NODE: 422, FUTURE_TIMESTAMP: 422, UNIT_MISMATCH: 422, RECORD_CONFLICT: 409 }
      if (statuses[code]) return json(statuses[code], { error: code, ...(code === 'UNIT_MISMATCH' ? { field: error.message.split(':')[1] } : {}) })
      console.error('ingest_record database failure', { code: error.code })
      return json(503, { error: 'STORAGE_UNAVAILABLE' })
    }
    return json(data.duplicate ? 200 : 201, data)
  } catch {
    return json(503, { error: 'STORAGE_UNAVAILABLE' })
  }
}


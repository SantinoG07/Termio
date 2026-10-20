import { recordSchema, type NormalizedRecord } from '../shared/record-schema.ts'

export interface CollectorConfig {
  sourceUrl: string
  sourceToken?: string
  ingestUrl: string
  ingestKey: string
  expectedNodeId: string
  expectedGroup: number
  expectedEnvironment: 'test' | 'operational'
  timeoutMs: number
  intervalMs: number
}
export class CollectorError extends Error {
  readonly retryable: boolean
  constructor(message: string, retryable: boolean) { super(message); this.retryable = retryable }
}
const boundedNumber = (value: string | undefined, fallback: number, min: number, max: number) => {
  const result = value ? Number(value) : fallback
  if (!Number.isInteger(result) || result < min || result > max) throw new Error(`Configuración numérica inválida; rango ${min}..${max}`)
  return result
}
function configuredUrl(value: string | undefined, name: string, allowHttp: boolean) {
  if (!value) throw new Error(`Falta ${name}`)
  const url = new URL(value)
  if (url.username || url.password) throw new Error(`${name}: no incluir credenciales en la URL`)
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) throw new Error(`${name} requiere HTTPS; HTTP de la fuente solo se permite con ALLOW_SOURCE_HTTP=true`)
  if (url.hostname.endsWith('.invalid') || url.hostname.toLowerCase().includes('tu_project_ref')) throw new Error(`Reemplazá el ejemplo de ${name}`)
  return url.toString()
}
export function readCollectorConfig(env: Record<string, string | undefined>): CollectorConfig {
  if (!env.INGEST_KEY || !/^[a-f0-9]{64}$/i.test(env.INGEST_KEY)) throw new Error('INGEST_KEY debe ser la credencial privada de 64 caracteres hexadecimales del grupo, no una publishable key')
  if (!env.EXPECTED_NODE_ID || !/^[a-z][a-z0-9_]{2,63}$/.test(env.EXPECTED_NODE_ID)) throw new Error('Falta EXPECTED_NODE_ID válido')
  const expectedEnvironment = env.EXPECTED_ENVIRONMENT ?? 'test'
  if (expectedEnvironment !== 'test' && expectedEnvironment !== 'operational') throw new Error('EXPECTED_ENVIRONMENT inválido')
  return {
    sourceUrl: configuredUrl(env.SOURCE_URL, 'SOURCE_URL', env.ALLOW_SOURCE_HTTP === 'true'),
    sourceToken: env.SOURCE_TOKEN || undefined,
    ingestUrl: configuredUrl(env.INGEST_URL, 'INGEST_URL', false),
    ingestKey: env.INGEST_KEY,
    expectedNodeId: env.EXPECTED_NODE_ID,
    expectedGroup: boundedNumber(env.EXPECTED_GROUP, 6, 1, 6),
    expectedEnvironment,
    timeoutMs: boundedNumber(env.REQUEST_TIMEOUT_MS, 5000, 100, 60000),
    intervalMs: boundedNumber(env.POLL_INTERVAL_MS, 10000, 1000, 3600000),
  }
}
// Adaptador intencionalmente identidad: la fuente devuelve UN registro del contrato.
// Si la URL pública devuelve otro formato, adaptar acá SIN inventar fecha, ID u origen.
export function adaptSource(payload: unknown): unknown { return payload }

async function readJsonLimited(response: Response): Promise<unknown> {
  if (!(response.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) throw new CollectorError('La fuente no respondió application/json', false)
  const reader = response.body?.getReader()
  if (!reader) throw new CollectorError('Respuesta vacía', false)
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > 65536) { await reader.cancel(); throw new CollectorError('La respuesta supera 64 KiB', false) }
    chunks.push(value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  catch { throw new CollectorError('La fuente devolvió JSON inválido', false) }
}
export async function fetchRecord(config: CollectorConfig, fetcher: typeof fetch = fetch): Promise<NormalizedRecord> {
  const response = await fetcher(config.sourceUrl, {
    method: 'GET', redirect: 'error', signal: AbortSignal.timeout(config.timeoutMs),
    headers: { Accept: 'application/json', ...(config.sourceToken ? { Authorization: `Bearer ${config.sourceToken}` } : {}) },
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new CollectorError(`Fuente: HTTP ${response.status}`, response.status >= 500 || [408, 429].includes(response.status))
  }
  const parsed = recordSchema.safeParse(adaptSource(await readJsonLimited(response)))
  if (!parsed.success) throw new CollectorError('JSON incompatible con el contrato: ' + parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '), false)
  const record = parsed.data
  if (record.node_id !== config.expectedNodeId || record.group !== config.expectedGroup || record.metadata.environment !== config.expectedEnvironment) throw new CollectorError('La fuente no corresponde al nodo, grupo o entorno configurado', false)
  if (Date.parse(record.timestamp) > Date.now() + 300000) throw new CollectorError('La fecha de la fuente está en el futuro', false)
  return record
}
export async function sendRecord(config: CollectorConfig, record: NormalizedRecord, fetcher: typeof fetch = fetch) {
  const response = await fetcher(config.ingestUrl, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(config.timeoutMs),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.ingestKey}` },
    body: JSON.stringify(record),
  })
  if (![200, 201].includes(response.status)) {
    await response.body?.cancel()
    throw new CollectorError(`Recepción Termio: HTTP ${response.status}. Revisá la credencial, el registro de nodos y las unidades.`, response.status >= 500 || [408, 429].includes(response.status))
  }
  const result = await readJsonLimited(response) as { record_id?: string; duplicate?: boolean }
  if (result.record_id !== record.record_id || typeof result.duplicate !== 'boolean') throw new CollectorError('La API de destino no confirmó el identificador enviado', false)
  return result
}

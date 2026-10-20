import { z } from 'zod'
import { endpoint, type SourceConfig, type LocalConfig } from './config.ts'
import { LocalError, Store, deliveryEligible, sourceKey } from './store.ts'
import type { NormalizedRecord } from '../../shared/record-schema.ts'

const pageSchema = z.object({ items: z.array(z.unknown()).max(100), next_cursor: z.string().min(1).max(4096).nullable(), has_more: z.boolean() }).strict()
export async function jsonRequest(url: URL, token: string | undefined, timeout: number, fetcher: typeof fetch = fetch, body?: unknown, maxBytes = 1024 * 1024) {
  const response = await fetcher(url, {
    method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(timeout),
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!response.ok) { await response.body?.cancel(); throw new LocalError(response.status, `REMOTE_HTTP_${response.status}`) }
  if (!(response.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) { await response.body?.cancel(); throw new LocalError(422, 'EXPECTED_JSON') }
  const reader = response.body?.getReader()
  if (!reader) throw new LocalError(422, 'EMPTY_RESPONSE')
  const chunks: Uint8Array[] = []; let length = 0
  for (;;) {
    const { done, value } = await reader.read(); if (done) break
    length += value.byteLength
    if (length > maxBytes) { await reader.cancel(); throw new LocalError(413, 'RESPONSE_TOO_LARGE') }
    chunks.push(value)
  }
  const bytes = Buffer.concat(chunks)
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown }
  catch { throw new LocalError(422, 'INVALID_JSON') }
}

export async function pollSource(store: Store, source: SourceConfig, env: Record<string, string | undefined> = process.env, fetcher: typeof fetch = fetch) {
  const key = sourceKey(source)
  try {
    const status = await jsonRequest(endpoint(source.base_url, source.paths.status), env[source.token_env], source.timeout_ms, fetcher, undefined, 65536)
    const parsedStatus = store.validate(status, source)
    if (parsedStatus.record_type !== 'state') throw new LocalError(422, 'STATUS_REQUIRES_STATE', [{ field: 'record_type' }])
    store.ingest(status, source)
    for (const kind of ['records', 'alerts'] as const) {
      // Nueva direccion de API => historial independiente. No saltar datos con un cursor de otro servidor.
      const cursorKey = `${key}:${kind}:${endpoint(source.base_url, source.paths[kind]).toString()}`
      let cursor = store.cursor(cursorKey)
      for (let pageIndex = 0; pageIndex < 10; pageIndex++) {
        const url = endpoint(source.base_url, source.paths[kind]); url.searchParams.set('limit', '100')
        if (cursor !== null) url.searchParams.set('cursor', cursor)
        const body = await jsonRequest(url, env[source.token_env], source.timeout_ms, fetcher)
        const parsed = pageSchema.safeParse(body)
        if (!parsed.success) throw new LocalError(422, 'INVALID_COLLECTION', parsed.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })))
        const page = parsed.data
        if (page.has_more && (!page.items.length || page.next_cursor === null || page.next_cursor === cursor)) throw new LocalError(422, 'CURSOR_NOT_ADVANCING')
        if (kind === 'alerts') for (const item of page.items) if (store.validate(item, source).record_type !== 'alert') throw new LocalError(422, 'ALERT_COLLECTION_REQUIRES_ALERT')
        // null al final NO borra el ultimo checkpoint util ni reinicia el historial.
        const next = page.next_cursor ?? cursor
        store.ingestPage(page.items, source, cursorKey, next)
        cursor = next
        if (!page.has_more) break
        // Diez paginas por ciclo: el siguiente ciclo continua desde el cursor persistido.
      }
    }
    store.connection(source, true)
    return true
  } catch (error) {
    const code = error instanceof LocalError ? error.code : 'COMMUNICATION_FAILURE'
    store.reject(key, error); store.connection(source, false, code)
    return false
  }
}

export async function deliverPending(store: Store, config: LocalConfig, env: Record<string, string | undefined> = process.env, fetcher: typeof fetch = fetch) {
  const delivery = config.group5_delivery
  if (!delivery.enabled) return
  const rows = store.db.prepare(`SELECT o.record_id,o.attempts,r.canonical_payload FROM outbox o JOIN records r USING(record_id)
    WHERE o.state='pending' AND o.next_attempt_ms<=? ORDER BY r.ingest_sequence LIMIT 10`).all(Date.now()) as { record_id: string; attempts: number; canonical_payload: string }[]
  for (const row of rows) {
    const payload = JSON.parse(row.canonical_payload) as NormalizedRecord
    if (!deliveryEligible(payload, delivery)) {
      store.db.prepare("UPDATE outbox SET state='expired',last_error='EVENT_NO_LONGER_ELIGIBLE' WHERE record_id=?").run(row.record_id); continue
    }
    try {
      const reply = await jsonRequest(endpoint(delivery.base_url, delivery.events_path), env[delivery.token_env], 5000, fetcher, payload, 65536)
      // Solo se registra RECEPCION TECNICA, nunca ejecucion de sirena ni reconocimiento humano.
      const receipt = z.object({ record_id: z.literal(row.record_id), duplicate: z.boolean() }).passthrough().safeParse(reply)
      if (!receipt.success) throw new LocalError(422, 'INVALID_TECHNICAL_RECEIPT')
      store.db.prepare("UPDATE outbox SET state='technical_receipt',attempts=attempts+1,last_error=NULL,technical_received_at=? WHERE record_id=?").run(new Date().toISOString(), row.record_id)
    } catch (error) {
      const code = error instanceof LocalError ? error.code : 'COMMUNICATION_FAILURE'
      const permanent = error instanceof LocalError && [400, 401, 403, 404, 409, 413, 415, 422].includes(error.status)
      const wait = Math.min(60000, 1000 * 2 ** Math.min(row.attempts, 6))
      store.db.prepare('UPDATE outbox SET state=?,attempts=attempts+1,next_attempt_ms=?,last_error=? WHERE record_id=?').run(permanent ? 'failed' : 'pending', Date.now() + wait, code, row.record_id)
      store.reject('group5_delivery', error)
    }
  }
}

export function startWorkers(store: Store, config: LocalConfig) {
  let stopped = false
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const active = new Set<Promise<void>>()
  const schedule = (run: () => Promise<unknown>, delay: number) => {
    if (stopped) return
    const timer = setTimeout(() => {
      timers.delete(timer)
      if (stopped) return
      const work = (async () => {
        try { await run() } catch { console.error('Error interno de persistencia en worker; revisar almacenamiento local') }
        finally { schedule(run, delay) }
      })()
      active.add(work); void work.finally(() => active.delete(work))
    }, delay)
    timers.add(timer)
  }
  for (const source of config.sources.filter(s => s.enabled)) schedule(() => pollSource(store, source), source.poll_interval_ms)
  if (config.group5_delivery.enabled) schedule(() => deliverPending(store, config), 2000)
  return async () => { stopped = true; for (const timer of timers) clearTimeout(timer); await Promise.allSettled(active) }
}

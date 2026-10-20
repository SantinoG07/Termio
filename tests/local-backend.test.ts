import { describe, it, expect } from 'vitest'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Store, sourceKey } from '../backend/src/store.ts'
import { configSchema, nodeSchema, validateConfiguration, type LocalConfig, type SourceConfig } from '../backend/src/config.ts'
import { pollSource, deliverPending } from '../backend/src/poller.ts'
import { createLocalServer } from '../backend/src/server.ts'
import { recordSchema, type NormalizedRecord } from '../shared/record-schema.ts'

const nodes = JSON.parse(readFileSync('backend/config/nodes.json', 'utf8')).map((n: unknown) => nodeSchema.parse(n))
const baseConfig = configSchema.parse(JSON.parse(readFileSync('backend/config/groups.json', 'utf8')))
const source: SourceConfig = { ...baseConfig.sources[0], enabled: true, base_url: 'http://127.0.0.1:9999' }
function reading(overrides: Partial<NormalizedRecord> = {}): NormalizedRecord {
  return { schema_version: '1.0.0', record_id: randomUUID(), record_type: 'reading', node_id: 'fire_node_01', group: 1, subsystem: nodes[0].subsystem, timestamp: new Date().toISOString(), status: 'active', alert_level: 'medium', data: { temperature: 31.5 }, metadata: { environment: 'test', source_type: 'simulated', alert_evaluated: true, clock_synced: true, units: { temperature: 'degC' }, quality: { temperature: 'valid' } }, ...overrides }
}
function critical(): NormalizedRecord {
  return reading({ record_type: 'event', alert_level: 'critical', data: { event_code: 'TEST_CRITICAL', message: 'Evento simulado de prueba', related_record_ids: [] }, metadata: { environment: 'test', source_type: 'simulated', alert_evaluated: true, clock_synced: true, units: {}, quality: {} } })
}
function status(): NormalizedRecord { return reading({ record_type: 'state' }) }
const json = (value: unknown, code = 200) => new Response(JSON.stringify(value), { status: code, headers: { 'Content-Type': 'application/json' } })
const withStore = async (run: (s: Store) => unknown, config = baseConfig) => {
  const store = new Store(':memory:', nodes, config.group5_delivery)
  try { await run(store) } finally { store.close() }
}
const deliveryConfig = (): LocalConfig => ({ ...baseConfig, group5_delivery: { ...baseConfig.group5_delivery, enabled: true, allow_simulated: true, base_url: 'http://127.0.0.1:9998' } })

describe('SQLite y contrato local', () => {
  it('guarda y reconoce duplicados incluso cambiando el orden de las claves', () => withStore(s => {
    const record = reading()
    expect(s.ingest(record).duplicate).toBe(false)
    expect(s.ingest(Object.fromEntries(Object.entries(record).reverse())).duplicate).toBe(true)
    expect(s.rows('test')).toHaveLength(1)
    expect(() => s.ingest({ ...record, data: { temperature: 32 } })).toThrow('RECORD_CONFLICT')
  }))
  it('rechaza tipos, identidad, unidades desconocidas y porcentajes fuera de rango', () => withStore(s => {
    expect(() => s.ingest(reading({ group: 2 }))).toThrow('NODE_MISMATCH')
    const badUnits = reading(); badUnits.metadata.units.temperature = 'F'
    expect(() => s.ingest(badUnits)).toThrow('UNIT_MISMATCH')
    const unknown = reading({ data: { unknown_sensor: 1 } }); unknown.metadata.units = { unknown_sensor: 'W' }; unknown.metadata.quality = { unknown_sensor: 'valid' }
    expect(() => s.ingest(unknown)).toThrow('UNIT_MISMATCH')
    expect(() => s.ingest(reading({ data: { humidity: 110 } }))).toThrow('INVALID_RECORD')
    expect(() => s.ingest({ ...reading(), group: '1' })).toThrow('INVALID_RECORD')
  }))
  it('no mezcla nodos ni entornos y solo Grupo 5 produce alertas', () => withStore(s => {
    const record = reading(); record.metadata.environment = 'operational'
    expect(() => s.ingest(record, source)).toThrow('SOURCE_MISMATCH')
    const alert = reading({ record_type: 'alert', data: { alert_id: 'a', message: 'x', channels: [], related_record_ids: [], alert_status: 'active' }, metadata: { environment: 'test', source_type: 'simulated', alert_evaluated: true, clock_synced: true, units: {}, quality: {} } })
    expect(() => s.ingest(alert)).toThrow('ALERT_PRODUCER_REQUIRED')
  }))
  it('pagina y cursor se revierten juntos ante un registro invalido', () => withStore(s => {
    s.ingestPage([], source, 'cursor', 'old')
    expect(() => s.ingestPage([reading(), { bad: true }], source, 'cursor', 'new')).toThrow('INVALID_RECORD')
    expect(s.rows('test')).toHaveLength(0); expect(s.cursor('cursor')).toBe('old')
  }))
  it('el snapshot no retrocede por datos atrasados ni toma un reloj no sincronizado', () => withStore(s => {
    const current = reading(); s.ingest(current)
    s.ingest(reading({ timestamp: new Date(Date.now() - 60000).toISOString() }))
    const unsynced = reading({ timestamp: new Date(Date.now() + 1000).toISOString() }); unsynced.metadata.clock_synced = false; s.ingest(unsynced)
    expect(s.dashboard('test', [source]).snapshots[0].record_id).toBe(current.record_id)
    expect(s.rows('operational')).toHaveLength(0)
  }))
  it('snapshot y ultima alerta no dependen de los 200 registros recientes', () => withStore(s => {
    const current = reading(); s.ingest(current)
    const alert = reading({ node_id: nodes[4].node_id, group: 5, subsystem: nodes[4].subsystem, record_type: 'alert', data: { alert_id: 'a', alert_status: 'active', message: 'Prueba', channels: [], related_record_ids: [] }, metadata: { environment: 'test', source_type: 'simulated', alert_evaluated: true, clock_synced: true, units: {}, quality: {} } })
    s.ingest(alert)
    for (let i = 0; i < 205; i++) s.ingest(reading({ record_type: 'event', data: { event_code: 'x', message: 'x' }, metadata: { environment: 'test', source_type: 'simulated', alert_evaluated: true, clock_synced: true, units: {}, quality: {} } }))
    const result = s.dashboard('test', [source]); expect(result.records).toHaveLength(200)
    expect(result.snapshots[0].record_id).toBe(current.record_id); expect(result.alertRecords[0].record_id).toBe(alert.record_id)
  }))
  it('conserva registros y checkpoints al reabrir el archivo SQLite', () => {
    const dir = mkdtempSync(join(tmpdir(), 'termio-test-')); const path = join(dir, 'termio.db')
    try {
      const first = new Store(path, nodes, baseConfig.group5_delivery)
      const r = reading(); first.ingestPage([r], source, 'history', 'checkpoint'); first.close()
      const reopened = new Store(path, nodes, baseConfig.group5_delivery)
      expect(reopened.rows('test')[0].record_id).toBe(r.record_id); expect(reopened.cursor('history')).toBe('checkpoint'); reopened.close()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('coleccion local devuelve contrato y paginacion estable', () => withStore(s => {
    const records = [reading(), reading(), reading()]; for (const r of records) s.ingest(r)
    const first = s.collection('test', 0, 2); expect(first.has_more).toBe(true); expect(first.items[0]).toEqual(records[0]); expect(recordSchema.safeParse(first.items[0]).success).toBe(true)
    const after = Number(Buffer.from(first.next_cursor, 'base64url').toString().split(':')[1])
    expect(s.collection('test', after, 2).items).toEqual([records[2]])
  }))
})

describe('Consultas a los grupos', () => {
  it('GET status + paginas + alertas, y guarda el cursor despues del commit', () => withStore(async s => {
    const state = status(); const r1 = reading(); const r2 = reading(); const calls: string[] = []
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input)); calls.push(url.pathname + url.search)
      expect(init?.method).toBe('GET'); expect(init?.redirect).toBe('error')
      if (url.pathname.endsWith('/status')) return json(state)
      if (url.pathname.endsWith('/alerts')) return json({ items: [], next_cursor: null, has_more: false })
      return json(url.searchParams.get('cursor') === 'one' ? { items: [r2], next_cursor: 'two', has_more: false } : { items: [r1], next_cursor: 'one', has_more: true })
    }
    expect(await pollSource(s, source, {}, fetcher)).toBe(true)
    expect(calls).toHaveLength(4); expect(s.rows('test')).toHaveLength(3)
    expect(s.cursor(`${sourceKey(source)}:records:${source.base_url}/api/v1/records`)).toBe('two')
  }))
  it('rechazo de pagina no adelanta cursor y tres fallos indican desconexion', () => withStore(async s => {
    const state = status()
    const fetcher: typeof fetch = async input => String(input).includes('/status') ? json(state) : json({ items: [reading(), { bad: true }], next_cursor: 'bad', has_more: false })
    for (let i = 0; i < 3; i++) expect(await pollSource(s, source, {}, fetcher)).toBe(false)
    expect(s.rows('test')).toHaveLength(1); expect(s.dashboard('test', [source]).nodes[0].observed_connection).toBe('offline')
    expect(s.db.prepare('SELECT count(*) AS n FROM rejections').get()?.n).toBe(3)
    expect(s.cursor(`${sourceKey(source)}:records:${source.base_url}/api/v1/records`)).toBeNull()
  }))
  it('rechaza cursores estancados y respuestas que no sean application/json', () => withStore(async s => {
    const state = status()
    expect(await pollSource(s, source, {}, async input => String(input).includes('/status') ? json(state) : json({ items: [], next_cursor: 'same', has_more: true }))).toBe(false)
    expect(await pollSource(s, source, {}, async () => new Response('html', { headers: { 'content-type': 'text/html' } }))).toBe(false)
  }))
  it('configuracion no admite una ruta que envie tokens a otro host', () => {
    const config = structuredClone(baseConfig); config.sources[0] = { ...source, paths: { ...source.paths, status: '//otro-servidor/api' } }
    expect(configSchema.safeParse(config).success).toBe(false)
    const noNode = structuredClone(baseConfig); noNode.sources[0].node_id = 'unknown'
    expect(() => validateConfiguration(noNode, nodes)).toThrow('Fuente sin nodo')
  })
})

describe('Eventos y recepcion tecnica de Grupo 5', () => {
  it('no encola eventos si no se habilita entrega explicitamente', () => withStore(s => { s.ingest(critical()); expect(s.db.prepare('SELECT count(*) AS n FROM outbox').get()?.n).toBe(0) }))
  it('no reenvia lecturas, eventos no evaluados, atrasados ni simulacion operativa', () => withStore(s => {
    s.ingest(reading({ alert_level: 'critical' }))
    const unevaluated = critical(); unevaluated.metadata.alert_evaluated = false; s.ingest(unevaluated)
    s.ingest(criticalRecordOld())
    const operational = critical(); operational.metadata.environment = 'operational'; s.ingest(operational)
    expect(s.db.prepare('SELECT count(*) AS n FROM outbox').get()?.n).toBe(0)
  }, deliveryConfig()))
  it('reintenta con el mismo evento y solo marca recepcion tecnica', () => withStore(async s => {
    const event = critical(); s.ingest(event); s.ingest(event)
    const sent: unknown[] = []
    const fail: typeof fetch = async (_url, init) => { sent.push(JSON.parse(String(init?.body))); return json({}, 503) }
    await deliverPending(s, deliveryConfig(), {}, fail)
    expect(s.db.prepare('SELECT state FROM outbox').get()?.state).toBe('pending')
    s.db.exec('UPDATE outbox SET next_attempt_ms=0')
    const success: typeof fetch = async (_url, init) => { sent.push(JSON.parse(String(init?.body))); return json({ record_id: event.record_id, duplicate: true }) }
    await deliverPending(s, deliveryConfig(), {}, success)
    expect(sent).toEqual([event, event]); expect(s.db.prepare('SELECT state FROM outbox').get()?.state).toBe('technical_receipt')
    expect(s.dashboard('test', []).alertRecords).toHaveLength(0)
  }, deliveryConfig()))
  it('no considera una respuesta generica como confirmacion y evita reintentar 401', () => withStore(async s => {
    s.ingest(critical()); await deliverPending(s, deliveryConfig(), {}, async () => json({ ok: true }))
    expect(s.db.prepare('SELECT state FROM outbox').get()?.state).toBe('failed')
    s.ingest(critical()); await deliverPending(s, deliveryConfig(), {}, async () => json({}, 401))
    expect(s.db.prepare("SELECT count(*) AS n FROM outbox WHERE state='pending'").get()?.n).toBe(0)
  }, deliveryConfig()))
})
function criticalRecordOld() { return { ...critical(), timestamp: new Date(Date.now() - 600000).toISOString() } }

it('API local responde 201,200,409,422 y exige credencial para escribir', () => withStore(async s => {
  const config = { ...baseConfig, sources: [source] }
  const secret = 'test-only-token-at-least-24-characters'
  const server = createLocalServer(s, config, { [source.ingest_token_env]: secret })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const record = reading()
  const send = (payload: unknown, auth = true) => fetch(base + '/api/v1/records', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${secret}` } : {}) }, body: JSON.stringify(payload) })
  try {
    expect((await send(record, false)).status).toBe(401)
    expect((await send(record)).status).toBe(201); expect((await send(record)).status).toBe(200)
    expect((await send({ ...record, alert_level: 'high' })).status).toBe(409)
    expect((await send({ ...record, group: '1' })).status).toBe(422)
    expect((await fetch(base + '/api/v1/records?cursor=invalid')).status).toBe(400)
    const dashboard = await (await fetch(base + '/api/v1/dashboard')).json() as { records: unknown[] }
    expect(dashboard.records).toHaveLength(1)
    expect((await fetch(base + '/api/v1/dashboard', { headers: { Origin: 'https://untrusted.invalid' } })).status).toBe(403)
  } finally { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections() }) }
}))

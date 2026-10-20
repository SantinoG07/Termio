import { DatabaseSync } from 'node:sqlite'
import { createSerialDebug } from '../../shared/serial-debug.ts'
import { defaultBridgeConfig, parseBridgeConfig, type BridgeConfig } from './bridge-config.ts'
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { recordSchema, type NormalizedRecord } from '../../shared/record-schema.ts'
import type { LocalNode, SourceConfig, DeliveryConfig } from './config.ts'

export class LocalError extends Error {
  status: number
  code: string
  details: unknown
  constructor(status: number, code: string, details: unknown = []) {
    super(code); this.status = status; this.code = code; this.details = details
  }
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k])).join(',') + '}'
  return JSON.stringify(value)
}
export const sourceKey = (s: SourceConfig) => `${s.node_id}:${s.environment}`
export function deliveryEligible(record: NormalizedRecord, delivery: DeliveryConfig, now = Date.now()) {
  if (!delivery.enabled || record.group === 5 || record.record_type !== 'event' || record.alert_level !== 'critical' || !record.metadata.alert_evaluated || !record.metadata.clock_synced) return false
  if (record.metadata.environment !== delivery.environment || now - Date.parse(record.timestamp) > delivery.max_event_age_seconds * 1000) return false
  // Nunca reenviar simulacion hacia dispositivos operativos.
  if (record.metadata.source_type !== 'real' && (delivery.environment !== 'test' || !delivery.allow_simulated)) return false
  return true
}
interface DbRow { ingest_sequence: number; payload: string; received_at: string }

export class Store {
  db: DatabaseSync
  nodes: LocalNode[]
  delivery: DeliveryConfig
  bridgeStatus = { ready: false, configured: false, network: null as null | { uptime_s: number; heap: number; min_heap: number; clients: number; channel: number; dhcp_offers: number; dhcp_acks: number; dhcp_naks: number; dhcp_errors: number; reset_reason: number }, busy: false, last_cycle_at: null as string | null, last_error: null as string | null, current: null as string | null }
  diagnosticStatus = { last_boot: null as Record<string,string|number> | null, events: [] as Record<string,string|number>[], telemetry_at: null as string | null, log_error: null as string | null }
  ledStatus = { requested: [false,false,false,false,false], acknowledged: null as boolean[] | null, last_ack_at: null as string | null }
  centralStatus = { busy: false, requests: 0, completed: 0, failed: 0, last_request_at: null as string | null, last_path: null as string | null, last_status: null as number | null, last_error: null as string | null }
  requestBridgePoll?: () => { queued: boolean; busy: boolean }
  notifyBridgeConfig?: () => void
  bridgeRevision = 0
  serialStatus = { enabled: false, connected: false, port: null as string | null, last_received_at: null as string | null, last_error: null as string | null, accepted: 0, duplicates: 0, rejected: 0, last_error_details: [] as { field?: string; message?: string }[], debug: createSerialDebug() }
  constructor(filename: string, nodes: LocalNode[], delivery: DeliveryConfig) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true })
    this.db = new DatabaseSync(filename)
    this.nodes = nodes; this.delivery = delivery
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;')
    this.db.exec(readFileSync(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8'))
    this.db.exec('CREATE TABLE IF NOT EXISTS local_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    this.db.exec('CREATE TABLE IF NOT EXISTS serial_receipts (node_id TEXT NOT NULL REFERENCES nodes(node_id), environment TEXT NOT NULL, last_received_at TEXT NOT NULL, PRIMARY KEY(node_id,environment))')
    const upsert = this.db.prepare('INSERT INTO nodes(node_id,spec) VALUES (?,?) ON CONFLICT(node_id) DO UPDATE SET spec=excluded.spec')
    for (const node of nodes) upsert.run(node.node_id, JSON.stringify(node))
  }
  transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = operation(); this.db.exec('COMMIT'); return result }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  validate(payload: unknown, source?: SourceConfig) {
    const parsed = recordSchema.safeParse(payload)
    if (!parsed.success) throw new LocalError(422, 'INVALID_RECORD', parsed.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })))
    const record = parsed.data
    const node = this.nodes.find(n => n.node_id === record.node_id && n.enabled)
    if (!node) throw new LocalError(422, 'UNKNOWN_NODE', [{ field: 'node_id' }])
    if (node.group_number !== record.group || node.subsystem !== record.subsystem) throw new LocalError(422, 'NODE_MISMATCH', [{ field: 'group/subsystem' }])
    if (source && (record.node_id !== source.node_id || record.metadata.environment !== source.environment)) throw new LocalError(422, 'SOURCE_MISMATCH', [{ field: 'node_id/metadata.environment' }])
    if (Date.parse(record.timestamp) > Date.now() + 300000) throw new LocalError(422, 'FUTURE_TIMESTAMP', [{ field: 'timestamp' }])
    if (['alert', 'confirmation'].includes(record.record_type) && record.group !== 5) throw new LocalError(422, 'ALERT_PRODUCER_REQUIRED', [{ field: 'group' }])
    for (const [name, value] of Object.entries(record.data)) {
      if (typeof value === 'number' || (value === null && name in node.variable_units)) {
        if (!(name in node.variable_units)) throw new LocalError(422, 'UNKNOWN_VARIABLE', [{ field: `data.${name}`, message: 'Variable no registrada para este nodo. Acordar nombre y unidad antes de integrarla.' }])
        if (record.metadata.units[name] !== node.variable_units[name]) throw new LocalError(422, 'UNIT_MISMATCH', [{ field: `metadata.units.${name}`, message: `Unidad esperada: ${node.variable_units[name]}; recibida: ${record.metadata.units[name] ?? '(ausente)'}. No se convierte automáticamente.` }])
      }
    }
    return record
  }
  insert(payload: unknown, source?: SourceConfig) {
    const record = this.validate(payload, source)
    const original = canonical(payload)
    const existing = this.db.prepare('SELECT canonical_payload FROM records WHERE record_id=?').get(record.record_id) as { canonical_payload: string } | undefined
    if (existing) {
      if (existing.canonical_payload !== original) throw new LocalError(409, 'RECORD_CONFLICT', [{ field: 'record_id' }])
      return { record_id: record.record_id, duplicate: true }
    }
    this.db.prepare('INSERT INTO records(record_id,node_id,environment,record_type,observed_ms,received_at,canonical_payload,payload) VALUES (?,?,?,?,?,?,?,?)').run(
      record.record_id, record.node_id, record.metadata.environment, record.record_type, Date.parse(record.timestamp), new Date().toISOString(), original, JSON.stringify(record))
    if (deliveryEligible(record, this.delivery)) this.db.prepare('INSERT INTO outbox(record_id) VALUES (?)').run(record.record_id)
    return { record_id: record.record_id, duplicate: false }
  }
  ingest(payload: unknown, source?: SourceConfig) { return this.transaction(() => this.insert(payload, source)) }
  getBridgeConfig(): BridgeConfig {
    const row = this.db.prepare("SELECT value FROM local_settings WHERE key='bridge'").get() as { value: string } | undefined
    return parseBridgeConfig(row ? JSON.parse(row.value) : defaultBridgeConfig, this.nodes)
  }
  setBridgeConfig(payload: unknown) {
    const config = parseBridgeConfig(payload, this.nodes)
    this.db.prepare("INSERT INTO local_settings(key,value) VALUES ('bridge',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(config))
    this.bridgeRevision++
    return config
  }
  ingestSerial(records: unknown[], checkpoint?: { key: string; next: string | null }) {
    return this.transaction(() => {
      const results = records.map(payload => {
      const result = this.insert(payload)
      const record = this.validate(payload)
      this.db.prepare('INSERT INTO serial_receipts(node_id,environment,last_received_at) VALUES (?,?,?) ON CONFLICT(node_id,environment) DO UPDATE SET last_received_at=excluded.last_received_at').run(record.node_id, record.metadata.environment, new Date().toISOString())
      return result
      })
      if (checkpoint) this.db.prepare('INSERT INTO cursors(source_key,value) VALUES (?,?) ON CONFLICT(source_key) DO UPDATE SET value=excluded.value').run(checkpoint.key, checkpoint.next)
      return results
    })
  }
  ingestPage(items: unknown[], source: SourceConfig, key: string, next: string | null) {
    // La pagina completa y su cursor se confirman juntos o no se guarda nada.
    return this.transaction(() => {
      const results = items.map(item => this.insert(item, source))
      this.db.prepare('INSERT INTO cursors(source_key,value) VALUES (?,?) ON CONFLICT(source_key) DO UPDATE SET value=excluded.value').run(key, next)
      return results
    })
  }
  cursor(key: string) { return (this.db.prepare('SELECT value FROM cursors WHERE source_key=?').get(key) as { value: string | null } | undefined)?.value ?? null }
  reject(source: string, error: unknown) {
    const e = error instanceof LocalError ? error : new LocalError(503, 'COMMUNICATION_FAILURE')
    // No persistir tokens, cabeceras, URL privadas ni payloads rechazados completos.
    this.db.prepare('INSERT INTO rejections(received_at,source_key,error_code,details) VALUES (?,?,?,?)').run(new Date().toISOString(), source, e.code, JSON.stringify(e.details))
  }
  connection(source: SourceConfig, ok: boolean, errorCode: string | null = null) {
    const key = sourceKey(source); const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO connection_state(source_key,failures,last_success_at,last_attempt_at,last_error) VALUES (?,?,?,?,?)
      ON CONFLICT(source_key) DO UPDATE SET failures=CASE WHEN ? THEN 0 ELSE connection_state.failures+1 END,
      last_success_at=CASE WHEN ? THEN excluded.last_success_at ELSE connection_state.last_success_at END,
      last_attempt_at=excluded.last_attempt_at,last_error=excluded.last_error`).run(key, ok ? 0 : 1, ok ? now : null, now, errorCode, ok ? 1 : 0, ok ? 1 : 0)
  }
  rows(environment: string) {
    const rows = this.db.prepare('SELECT ingest_sequence,payload,received_at FROM records WHERE environment=? ORDER BY ingest_sequence DESC LIMIT 200').all(environment) as unknown as DbRow[]
    return rows.map(row => this.toRow(row))
  }
  toRow(row: DbRow) {
    const r = JSON.parse(row.payload) as NormalizedRecord
    return { ingest_sequence: row.ingest_sequence, record_id: r.record_id, record_type: r.record_type, node_id: r.node_id, group_number: r.group, observed_at: r.timestamp, received_at: row.received_at, status: r.status, alert_level: r.alert_level, environment: r.metadata.environment, source_type: r.metadata.source_type, clock_synced: r.metadata.clock_synced, alert_evaluated: r.metadata.alert_evaluated, data: r.data, metadata: r.metadata }
  }
  dashboard(environment: string, sources: SourceConfig[]) {
    const latest = this.db.prepare(`SELECT ingest_sequence,payload,received_at FROM (
      SELECT *,ROW_NUMBER() OVER (PARTITION BY node_id ORDER BY observed_ms DESC,ingest_sequence DESC) AS ranking
      FROM records WHERE environment=? AND record_type IN ('reading','state') AND json_extract(payload,'$.metadata.clock_synced')=1
    ) WHERE ranking=1`).all(environment) as unknown as DbRow[]
    const alerts = this.db.prepare(`SELECT ingest_sequence,payload,received_at FROM (
      SELECT *,ROW_NUMBER() OVER (PARTITION BY node_id,json_extract(payload,'$.data.alert_id') ORDER BY observed_ms DESC,ingest_sequence DESC) AS ranking
      FROM records WHERE environment=? AND record_type='alert' AND json_extract(payload,'$.metadata.clock_synced')=1
    ) WHERE ranking=1`).all(environment) as unknown as DbRow[]
    return {
      nodes: this.nodes.map(node => {
        const source = sources.find(s => s.node_id === node.node_id && s.environment === environment)
        const state = source ? this.db.prepare('SELECT * FROM connection_state WHERE source_key=?').get(sourceKey(source)) as { failures: number } | undefined : undefined
        const serial = this.db.prepare('SELECT last_received_at FROM serial_receipts WHERE node_id=? AND environment=?').get(node.node_id, environment) as { last_received_at: string } | undefined
        const serialFresh = serial && Date.now() - Date.parse(serial.last_received_at) <= node.expected_interval_seconds * 3000
        const observed_connection = serialFresh ? 'online' : source?.enabled ? (!state ? 'pending' : state.failures >= 3 ? 'offline' : state.failures ? 'degraded' : 'online') : serial ? 'offline' : 'not_configured'
        return { ...node, expected_interval_seconds: source?.enabled ? source.poll_interval_ms / 1000 : node.expected_interval_seconds, observed_connection, last_serial_received_at: serial?.last_received_at ?? null }
      }),
      bridge: { ...this.bridgeStatus },
      serial: { ...this.serialStatus },
      records: this.rows(environment), snapshots: latest.map(row => this.toRow(row)), alertRecords: alerts.map(row => this.toRow(row)),
      connections: this.db.prepare('SELECT * FROM connection_state').all(),
      outbox: this.db.prepare('SELECT record_id,state,attempts,next_attempt_ms,last_error,technical_received_at FROM outbox ORDER BY rowid DESC LIMIT 100').all(),
    }
  }
  collection(environment: string, after: number, limit: number) {
    const rows = this.db.prepare('SELECT ingest_sequence,canonical_payload FROM records WHERE environment=? AND ingest_sequence>? ORDER BY ingest_sequence LIMIT ?').all(environment, after, limit + 1) as { ingest_sequence: number; canonical_payload: string }[]
    const page = rows.slice(0, limit)
    const last = page.at(-1)?.ingest_sequence ?? after
    return { items: page.map(row => JSON.parse(row.canonical_payload)), next_cursor: Buffer.from(`${environment}:${last}`).toString('base64url'), has_more: rows.length > limit }
  }
  close() { this.db.close() }
}

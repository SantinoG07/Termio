import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { SerialDecoder, acceptSerialPayload } from '../backend/src/serial.ts'
import { Store } from '../backend/src/store.ts'
import { configSchema, nodeSchema } from '../backend/src/config.ts'

const nodes = JSON.parse(readFileSync('backend/config/nodes.json', 'utf8')).map((n: unknown) => nodeSchema.parse(n))
const config = configSchema.parse(JSON.parse(readFileSync('backend/config/groups.json', 'utf8')))
const record = () => ({ schema_version: '1.0.0', record_id: randomUUID(), record_type: 'reading', node_id: nodes[0].node_id, group: 1, subsystem: nodes[0].subsystem, timestamp: new Date().toISOString(), status: 'active', alert_level: 'low', data: { temperature: 28.5, wind_speed: null }, metadata: { environment: 'test', source_type: 'simulated', alert_evaluated: true, clock_synced: true, units: { temperature: 'degC', wind_speed: 'm/s' }, quality: { temperature: 'valid', wind_speed: 'missing' } } })
function fixture() {
  const values: unknown[] = []; const errors: string[] = []
  return { values, errors, decoder: new SerialDecoder(p => values.push(p), e => errors.push(e)) }
}

describe('USB serie a SQLite', () => {
  it('extrae JSON multilinea entre marcadores con logs y chunks arbitrarios', () => {
    const f = fixture(); const r = record()
    const text = `Equipo: Incendios\r\nHTTP: 200\r\n--- INICIO DE RESPUESTA ---\r\n${JSON.stringify(r, null, 2)}\r\n--- FIN DE RESPUESTA ---\r\n`
    for (let i = 0; i < text.length; i += 7) f.decoder.push(text.slice(i, i + 7))
    expect(f.values).toEqual([r]); expect(f.errors).toEqual([])
  })
  it('acepta la variante corta de marcadores y JSON de una linea', () => {
    const f = fixture(); const r = record()
    f.decoder.push(`HTTP: 200\n--- RESPUESTA ---\n${JSON.stringify(r)}\n--- FIN ---\n${JSON.stringify(r)}\n`)
    expect(f.values).toEqual([r, r])
  })
  it('no ingiere respuestas HTTP fallidas ni frames sin confirmar HTTP 200', () => {
    const f = fixture(); const r = JSON.stringify(record())
    f.decoder.push(`HTTP: 500\n--- RESPUESTA ---\n${r}\n--- FIN ---\n--- RESPUESTA ---\n${r}\n--- FIN ---\n`)
    expect(f.values).toEqual([])
  })
  it('rechaza JSON truncado y recupera el siguiente frame', () => {
    const f = fixture(); const r = record()
    f.decoder.push(`HTTP: 200\n--- RESPUESTA ---\n{truncado\n--- FIN ---\n${JSON.stringify(r)}\n`)
    expect(f.errors).toEqual(['SERIAL_INVALID_JSON']); expect(f.values).toEqual([r])
  })
  it('limita el tamaño y recupera despues de una linea excesiva', () => {
    const f = fixture(); const r = record()
    f.decoder.push('x'.repeat(70000) + '\n' + JSON.stringify(r) + '\n')
    expect(f.errors).toEqual(['SERIAL_LINE_TOO_LARGE']); expect(f.values).toEqual([r])
  })
  it('persiste, deduplica y presenta snapshots aun con polling HTTP deshabilitado', () => {
    const s = new Store(':memory:', nodes, config.group5_delivery)
    try {
      const r = record()
      expect(acceptSerialPayload(s, r)[0].duplicate).toBe(false)
      expect(acceptSerialPayload(s, r)[0].duplicate).toBe(true)
      const dashboard = s.dashboard('test', config.sources)
      expect(dashboard.records).toHaveLength(1)
      expect(dashboard.snapshots[0].data.temperature).toBe(28.5)
      expect(dashboard.nodes[0].observed_connection).toBe('online')
      expect(dashboard.nodes[0].last_serial_received_at).toBeTruthy()
      expect(s.dashboard('operational', config.sources).records).toHaveLength(0)
      s.db.prepare("UPDATE serial_receipts SET last_received_at='2000-01-01T00:00:00Z'").run()
      expect(s.dashboard('test', config.sources).nodes[0].observed_connection).toBe('offline')
      expect(() => acceptSerialPayload(s, { ...r, data: { temperature: 30, wind_speed: null } })).toThrow('RECORD_CONFLICT')
    } finally { s.close() }
  })
  it('colecciones atomicas: no guarda una pagina parcialmente invalida', () => {
    const s = new Store(':memory:', nodes, config.group5_delivery)
    try {
      expect(() => acceptSerialPayload(s, { items: [record(), { invalid: true }], next_cursor: null, has_more: false })).toThrow('INVALID_RECORD')
      expect(s.rows('test')).toHaveLength(0)
      expect(s.db.prepare('SELECT * FROM serial_receipts').all()).toHaveLength(0)
      expect(() => acceptSerialPayload(s, { items: [] })).toThrow('SERIAL_INVALID_COLLECTION')
      expect(acceptSerialPayload(s, { items: [record()], next_cursor: null, has_more: false })).toHaveLength(1)
    } finally { s.close() }
  })
})

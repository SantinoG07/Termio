import { describe, expect, it } from 'vitest'
import { currentAlerts, freshness, latestByNode } from '../src/lib/domain'
import { createDemoRecords, demoNodes } from '../src/lib/demo'

const now = Date.parse('2026-10-14T13:30:00Z')
const records = createDemoRecords(now)
const fire = records.find(row => row.node_id === 'fire_node_01')!
describe('Monitoreo', () => {
  it('un reenvío antiguo no reemplaza una medición actual', () => {
    const old = { ...fire, record_id: 'old', ingest_sequence: 100, observed_at: new Date(now - 86400000).toISOString(), received_at: new Date(now).toISOString() }
    expect(latestByNode([old, fire]).get(fire.node_id)?.record_id).toBe(fire.record_id)
  })
  it('no considera vigente un dato sin reloj sincronizado', () => {
    expect(latestByNode([{ ...fire, clock_synced: false }]).size).toBe(0)
  })
  it('distingue sin datos, activo y desactualizado', () => {
    expect(freshness(demoNodes[0], undefined, now)).toBe('Sin datos')
    expect(freshness(demoNodes[0], fire, now)).toBe('Activo')
    expect(freshness(demoNodes[0], fire, now + 300000)).toBe('Desactualizado')
  })
  it('una alerta resuelta no sigue abierta', () => {
    const alert = records.find(row => row.record_type === 'alert')!
    const resolved = { ...alert, ingest_sequence: 100, observed_at: new Date(now).toISOString(), data: { ...alert.data, alert_status: 'resolved' } }
    expect(currentAlerts([alert]).length).toBe(1)
    expect(currentAlerts([resolved, alert]).length).toBe(0)
  })
})

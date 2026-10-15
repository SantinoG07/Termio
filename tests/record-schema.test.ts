import { describe, expect, it } from 'vitest'
import { recordSchema } from '../shared/record-schema'
import fixture from '../examples/reading.json'

describe('Contrato 1.0.0', () => {
  it('acepta el ejemplo y offsets de zona horaria', () => {
    expect(recordSchema.safeParse(fixture).success).toBe(true)
    expect(recordSchema.safeParse({ ...fixture, timestamp: '2026-10-14T10:30:00-03:00' }).success).toBe(true)
  })
  it.each(['2026-10-14T10:30:00', '14/10/2026 10:30'])('rechaza fecha ambigua: %s', timestamp => {
    expect(recordSchema.safeParse({ ...fixture, timestamp }).success).toBe(false)
  })
  it('no transforma números escritos como texto ni grupos string', () => {
    expect(recordSchema.safeParse({ ...fixture, group: '1' }).success).toBe(false)
    expect(recordSchema.safeParse({ ...fixture, data: { ...fixture.data, temperature: '31.5' } }).success).toBe(false)
    expect(recordSchema.safeParse({ ...fixture, data: { temperature: NaN } }).success).toBe(false)
  })
  it('rechaza porcentajes fuera de rango y unidades faltantes', () => {
    expect(recordSchema.safeParse({ ...fixture, data: { ...fixture.data, humidity: 101 } }).success).toBe(false)
    expect(recordSchema.safeParse({ ...fixture, metadata: { ...fixture.metadata, units: {} } }).success).toBe(false)
  })
  it('requiere procedencia por variable en registros mixtos', () => {
    expect(recordSchema.safeParse({ ...fixture, metadata: { ...fixture.metadata, source_type: 'mixed' } }).success).toBe(false)
    expect(recordSchema.safeParse({ ...fixture, metadata: { ...fixture.metadata, source_type: 'mixed', sources: { temperature: 'real', humidity: 'simulated', wind_speed: 'real' } } }).success).toBe(true)
  })
  it('acepta null solo si se identifica la falla', () => {
    expect(recordSchema.safeParse({ ...fixture, data: { ...fixture.data, temperature: null } }).success).toBe(false)
    expect(recordSchema.safeParse({ ...fixture, data: { ...fixture.data, temperature: null }, metadata: { ...fixture.metadata, quality: { ...fixture.metadata.quality, temperature: 'missing' } } }).success).toBe(true)
  })
  it('rechaza niveles desconocidos y claves raíz no acordadas', () => {
    expect(recordSchema.safeParse({ ...fixture, alert_level: 'red' }).success).toBe(false)
    expect(recordSchema.safeParse({ ...fixture, typo: 1 }).success).toBe(false)
  })
  it('requiere el contenido específico de eventos y confirmaciones', () => {
    expect(recordSchema.safeParse({ ...fixture, record_type: 'event' }).success).toBe(false)
    expect(recordSchema.safeParse({ ...fixture, record_type: 'confirmation' }).success).toBe(false)
  })
})

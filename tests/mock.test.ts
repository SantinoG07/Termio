import { describe, expect, it } from 'vitest'
import { applyMockFallback, isMockRecord } from '../src/lib/mock'
import { createDemoRecords, demoNodes } from '../src/lib/demo'

const now = Date.parse('2026-10-20T12:00:00Z')
const base = createDemoRecords(now)

describe('relleno interno de datos', () => {
  it('cubre solo los grupos sin datos vigentes', () => {
    const result = applyMockFallback({ nodes: demoNodes, records: base, snapshots: base, alertRecords: base, environment: 'test', now, enabled: true })
    expect(result.mockNodes).toEqual(['volcanic_node_01'])
    expect(result.records.length).toBe(base.length + 1)
    expect(isMockRecord(result.snapshots[0])).toBe(true)
  })

  it('no modifica nada cuando el relleno está desactivado', () => {
    const result = applyMockFallback({ nodes: demoNodes, records: base, snapshots: base, alertRecords: base, environment: 'test', now, enabled: false })
    expect(result.mockNodes).toEqual([])
    expect(result.records).toBe(base)
  })

  it('cubre todos los grupos cuando no hay datos', () => {
    const result = applyMockFallback({ nodes: demoNodes, records: [], snapshots: [], alertRecords: [], environment: 'operational', now, enabled: true })
    expect(result.mockNodes).toHaveLength(6)
    expect(result.records.every(isMockRecord)).toBe(true)
    expect(result.snapshots.every(isMockRecord)).toBe(true)
    expect(result.records[0].environment).toBe('operational')
  })
})

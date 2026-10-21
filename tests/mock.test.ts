import { describe, expect, it } from 'vitest'
import { applyMockFallback, isMockRecord } from '../src/lib/mock'
import { createDemoRecords, demoNodes } from '../src/lib/demo'

const now = Date.parse('2026-10-20T12:00:00Z')
const base = createDemoRecords(now)

describe('relleno interno de datos', () => {
  it('cubre solo los grupos sin datos vigentes', () => {
    const result = applyMockFallback({ nodes: demoNodes, records: base, snapshots: base, alertRecords: base, environment: 'test', now, enabledGroups: [1, 2, 3, 4, 5] })
    expect(result.mockNodes).toEqual(['volcanic_node_01'])
    expect(result.records.length).toBe(base.length + 1)
    expect(isMockRecord(result.snapshots[0])).toBe(true)
  })

  it('no modifica nada cuando el relleno está desactivado', () => {
    const result = applyMockFallback({ nodes: demoNodes, records: base, snapshots: base, alertRecords: base, environment: 'test', now, enabledGroups: [] })
    expect(result.mockNodes).toEqual([])
    expect(result.records).toBe(base)
  })

  it('respeta la selección por grupo', () => {
    const result = applyMockFallback({ nodes: demoNodes, records: [], snapshots: [], alertRecords: [], environment: 'test', now, enabledGroups: [2, 4] })
    expect(result.mockNodes).toEqual(['volcanic_node_01', 'water_node_01'])
  })

  it('cubre todos los grupos cuando no hay datos', () => {
    const result = applyMockFallback({ nodes: demoNodes, records: [], snapshots: [], alertRecords: [], environment: 'operational', now, enabledGroups: [1, 2, 3, 4, 5] })
    expect(result.mockNodes).toHaveLength(5)
    expect(result.records.every(isMockRecord)).toBe(true)
    expect(result.snapshots.every(isMockRecord)).toBe(true)
    expect(result.records[0].environment).toBe('operational')
  })
})

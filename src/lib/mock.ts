import { freshness, latestByNode, type NodeInfo, type RecordRow } from './domain'

// Relleno interno de datos: no se muestra en la vista principal.
const MOCK_PROP = '__termioMock'
const STORAGE_KEY = 'termio.internal.mockFallback'

export function isMockRecord(row: RecordRow): boolean {
  return Object.prototype.hasOwnProperty.call(row, MOCK_PROP) && Boolean((row as RecordRow & { [MOCK_PROP]?: boolean })[MOCK_PROP])
}

export function readMockFallback(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === null ? true : stored === '1'
  } catch {
    return true
  }
}

export function writeMockFallback(enabled: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    // El panel sigue funcionando aunque el navegador bloquee el almacenamiento.
  }
}

export interface MockFallbackInput {
  nodes: NodeInfo[]
  records: RecordRow[]
  snapshots: RecordRow[]
  alertRecords: RecordRow[]
  environment: 'test' | 'operational'
  now: number
  enabled: boolean
}

export interface MockFallbackResult {
  nodes: NodeInfo[]
  records: RecordRow[]
  snapshots: RecordRow[]
  alertRecords: RecordRow[]
  mockNodes: string[]
}

type MockValue = number | string

const baseValues: Record<number, Record<string, MockValue>> = {
  1: { temperature: 29.4, humidity: 31 },
  2: { pm2_5: 16, temperature: 11.8 },
  3: { battery_level: 78, generation_power: 42 },
  4: { water_level: 47, flow_rate: 2.6 },
  5: { device_state: 'ready' },
  6: { connected_nodes: 6, total_nodes: 6 },
}

function vary(value: MockValue, key: string): MockValue {
  if (typeof value !== 'number') return value
  if (key === 'connected_nodes' || key === 'total_nodes') return Math.round(value)
  const span = Math.max(1, Math.abs(value) * 0.04)
  const next = value + (Math.random() * 2 - 1) * span
  if (['humidity', 'battery_level', 'water_level'].includes(key)) return Math.round(Math.min(100, Math.max(0, next)) * 10) / 10
  return Math.round(next * 10) / 10
}

function createId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
    const random = (Math.random() * 16) | 0
    return (character === 'x' ? random : (random & 0x3) | 0x8).toString(16)
  })
}

function createMockRecord(node: NodeInfo, environment: 'test' | 'operational', now: number, sequence: number, index: number): RecordRow {
  const source = baseValues[node.group_number] ?? { device_state: 'ready' }
  const data = Object.fromEntries(Object.entries(source).map(([key, value]) => [key, vary(value, key)]))
  const units = Object.fromEntries(Object.keys(data).map(key => [key, node.variable_units[key] ?? 'string']))
  const quality = Object.fromEntries(Object.keys(data).map(key => [key, 'valid' as const]))
  const record: RecordRow = {
    ingest_sequence: sequence,
    record_id: createId(),
    record_type: node.group_number >= 5 ? 'state' : 'reading',
    node_id: node.node_id,
    group_number: node.group_number,
    observed_at: new Date(now - index * 2500 - 1000).toISOString(),
    received_at: new Date(now).toISOString(),
    status: 'active',
    alert_level: 'normal',
    environment,
    source_type: 'real',
    clock_synced: true,
    alert_evaluated: true,
    data,
    metadata: { environment, source_type: 'real', alert_evaluated: true, clock_synced: true, units, quality },
  }
  Object.defineProperty(record, MOCK_PROP, { value: true, enumerable: false })
  return record
}

export function applyMockFallback(input: MockFallbackInput): MockFallbackResult {
  if (!input.enabled) return { nodes: input.nodes, records: input.records, snapshots: input.snapshots, alertRecords: input.alertRecords, mockNodes: [] }
  const latest = latestByNode(input.snapshots)
  let sequence = input.records.reduce((max, row) => Math.max(max, row.ingest_sequence), 0)
  const generated: RecordRow[] = []
  const mockNodes: string[] = []
  input.nodes.filter(node => node.enabled).forEach((node, index) => {
    const row = latest.get(node.node_id)
    if (row && freshness(node, row, input.now) === 'Activo') return
    sequence += 1
    generated.push(createMockRecord(node, input.environment, input.now, sequence, index))
    mockNodes.push(node.node_id)
  })
  if (!generated.length) return { nodes: input.nodes, records: input.records, snapshots: input.snapshots, alertRecords: input.alertRecords, mockNodes }
  return {
    nodes: input.nodes,
    records: [...generated.slice().reverse(), ...input.records].slice(0, 200),
    snapshots: [...generated, ...input.snapshots],
    alertRecords: input.alertRecords,
    mockNodes,
  }
}

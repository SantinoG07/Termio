import type { NormalizedRecord } from '../../shared/record-schema'

export interface NodeInfo {
  node_id: string
  group_number: number
  subsystem: string
  expected_interval_seconds: number
  enabled: boolean
  variable_units: Record<string, string>
  observed_connection?: 'not_configured' | 'pending' | 'offline' | 'degraded' | 'online'
}
export interface RecordRow {
  ingest_sequence: number
  record_id: string
  record_type: NormalizedRecord['record_type']
  node_id: string
  group_number: number
  observed_at: string
  received_at: string
  status: NormalizedRecord['status']
  alert_level: NormalizedRecord['alert_level']
  environment: 'test' | 'operational'
  source_type: 'real' | 'simulated' | 'mixed'
  clock_synced: boolean
  alert_evaluated: boolean
  data: NormalizedRecord['data']
  metadata: NormalizedRecord['metadata']
}
export const levelLabels = { normal: 'Normal', low: 'Bajo', medium: 'Medio', high: 'Alto', critical: 'Crítico' }
export const typeLabels = { reading: 'Medición', state: 'Estado', event: 'Evento', alert: 'Alerta', confirmation: 'Confirmación' }
export const sourceLabels = { real: 'Real', simulated: 'Simulado', mixed: 'Mixto' }
export const statusLabels = { active: 'Activo', offline: 'Sin conexión', error: 'Error' }
export const dateLabel = (value: string) => new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(value))

export function latestByNode(records: RecordRow[]) {
  const result = new Map<string, RecordRow>()
  for (const row of records) {
    if (!['reading', 'state'].includes(row.record_type) || !row.clock_synced) continue
    const previous = result.get(row.node_id)
    if (!previous || Date.parse(row.observed_at) > Date.parse(previous.observed_at) || (row.observed_at === previous.observed_at && row.ingest_sequence > previous.ingest_sequence)) result.set(row.node_id, row)
  }
  return result
}
export function freshness(node: NodeInfo, row: RecordRow | undefined, now: number) {
  if (node.observed_connection === 'offline') return 'Sin conexión'
  if (node.observed_connection === 'not_configured') return 'Sin configurar'
  if (!row) return 'Sin datos'
  if (!row.clock_synced) return 'Reloj no sincronizado'
  if (now - Date.parse(row.observed_at) > node.expected_interval_seconds * 3000) return 'Desactualizado'
  return statusLabels[row.status]
}

export function currentAlerts(records: RecordRow[]) {
  const latest = new Map<string, RecordRow>()
  for (const record of records.filter(row => row.record_type === 'alert' && row.clock_synced)) {
    const id = String(record.data.alert_id)
    const previous = latest.get(id)
    if (!previous || Date.parse(record.observed_at) > Date.parse(previous.observed_at) || (record.observed_at === previous.observed_at && record.ingest_sequence > previous.ingest_sequence)) latest.set(id, record)
  }
  return [...latest.values()].filter(row => ['active', 'pending'].includes(String(row.data.alert_status)))
}

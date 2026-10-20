import type { NodeInfo, RecordRow } from './domain'
export const localMode = import.meta.env.VITE_DATA_SOURCE === 'local'
export interface LocalDashboard {
  nodes: NodeInfo[]
  records: RecordRow[]
  snapshots: RecordRow[]
  alertRecords: RecordRow[]
}
export async function loadLocalDashboard(environment: 'test' | 'operational'): Promise<LocalDashboard> {
  const response = await fetch(`/api/v1/dashboard?environment=${environment}`, { signal: AbortSignal.timeout(5000), cache: 'no-store' })
  if (!response.ok) throw new Error(`Backend local: HTTP ${response.status}. Revisá que npm run local:server esté ejecutándose.`)
  const data = await response.json() as LocalDashboard
  if (!Array.isArray(data.nodes) || !Array.isArray(data.records) || !Array.isArray(data.snapshots) || !Array.isArray(data.alertRecords)) throw new Error('Respuesta del backend local incompatible.')
  return data
}

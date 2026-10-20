import type { NodeInfo, RecordRow } from './domain'
import type { SerialDebug } from '../../shared/serial-debug'
export async function bridgeRequest<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch('/api/v1/bridge' + path, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}), cache: 'no-store', signal: AbortSignal.timeout(5000) })
  const data = await response.json()
  if (!response.ok) throw new Error(`${data.error ?? 'Error del puente'}: ${JSON.stringify(data.details ?? [])}`)
  return data as T
}
export const requestBridgePoll = () => bridgeRequest('/poll', 'POST')
export const localMode = import.meta.env.VITE_DATA_SOURCE === 'local'
export interface SerialStatus {
  enabled: boolean
  connected: boolean
  port: string | null
  last_received_at: string | null
  last_error: string | null
  accepted: number
  duplicates: number
  rejected: number
  last_error_details?: { field?: string; message?: string }[]
  debug?: SerialDebug
}
export interface LocalDashboard {
  serial?: SerialStatus
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

import type { NodeInfo, RecordRow } from './domain'

export const demoNodes: NodeInfo[] = [
  ['fire_node_01', 'Monitoreo de incendios forestales', { temperature: 'degC', humidity: '%' }],
  ['volcanic_node_01', 'Nodo volcánico y calidad ambiental', { pm2_5: 'ug/m3', temperature: 'degC' }],
  ['energy_node_01', 'Sistema energético autónomo', { battery_level: '%', generation_power: 'W' }],
  ['water_node_01', 'Administración inteligente de agua', { water_level: '%', flow_rate: 'L/min' }],
  ['alert_node_01', 'Comunicaciones y alertas de emergencia', {}],
  ['monitoring_center', 'Centro de monitoreo e integración', { connected_nodes: 'count', total_nodes: 'count' }],
].map(([id, name, units], i) => ({ node_id: String(id), group_number: i + 1, subsystem: String(name), expected_interval_seconds: 60, enabled: true, variable_units: units as Record<string, string> }))

// Fixtures locales, nunca enviadas a Supabase. Se conserva su fecha: no se simula un heartbeat.
export function createDemoRecords(now = Date.now()): RecordRow[] {
  const values: RecordRow['data'][] = [
    { temperature: 31.5, humidity: 28 }, { pm2_5: 18, temperature: 12.3 },
    { battery_level: 74, generation_power: 38 }, { water_level: 42, flow_rate: 2.4 },
    { device_state: 'ready' }, { connected_nodes: 5, total_nodes: 6 },
  ]
  const rows = demoNodes.map((node, i): RecordRow => ({
    ingest_sequence: i + 1,
    record_id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    record_type: i < 4 ? 'reading' : 'state', node_id: node.node_id, group_number: node.group_number,
    observed_at: new Date(now - (i === 1 ? 240000 : 10000 + i * 1000)).toISOString(),
    received_at: new Date(now - 5000).toISOString(), status: 'active',
    alert_level: i === 0 ? 'medium' : 'normal', environment: 'test', source_type: 'simulated',
    clock_synced: true, alert_evaluated: true, data: values[i],
    metadata: { environment: 'test', source_type: 'simulated', alert_evaluated: true, clock_synced: true, units: node.variable_units, quality: Object.fromEntries(Object.keys(values[i]).map(key => [key, 'valid' as const])) },
  }))
  rows.push({ ...rows[4], record_id: '00000000-0000-4000-8000-000000000007', ingest_sequence: 7, record_type: 'alert', alert_level: 'medium', data: { alert_id: 'demo-fire-01', alert_status: 'active', message: 'Escenario de prueba: condiciones de incendio bajo observación.', channels: ['dashboard'], related_record_ids: [rows[0].record_id] }, metadata: { ...rows[4].metadata, units: {}, quality: {} } })
  return rows.sort((a, b) => b.ingest_sequence - a.ingest_sequence)
}

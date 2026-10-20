import { z } from 'zod'
import type { LocalNode } from './config.ts'

const route = z.union([z.literal(''), z.string().max(180).regex(/^\/(?!\/)[A-Za-z0-9_./~-]*$/)])
export const bridgeConfigSchema = z.object({
  interval_ms: z.number().int().min(5000).max(3600000),
  paused: z.boolean().default(false),
  channel: z.union([z.literal(1), z.literal(6), z.literal(11)]).default(6),
  devices: z.array(z.object({
    id: z.string().regex(/^[a-z0-9_-]{1,40}$/), name: z.string().trim().min(1).max(80).regex(/^[^\x00-\x1f\x7f]+$/),
    node_id: z.string(), mac: z.string().regex(/^(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/).transform(s => s.toUpperCase()),
    ip: z.union([z.literal(''), z.string().regex(/^192\.168\.4\.(?:[2-9]|[1-9][0-9])$/)]).default(''),
    port: z.number().int().min(1).max(65535), enabled: z.boolean(),
    environment: z.enum(['test', 'operational']),
    endpoints: z.object({ status: route, records: route, alerts: route }).strict(),
  }).strict()).max(16),
}).strict()
export type BridgeConfig = z.infer<typeof bridgeConfigSchema>
export type BridgeDevice = BridgeConfig['devices'][number]
export function parseBridgeConfig(payload: unknown, nodes: LocalNode[]) {
  const config = bridgeConfigSchema.parse(payload)
  if (new Set(config.devices.map(d => d.id)).size !== config.devices.length) throw new Error('Identificadores de equipo repetidos')
  const macIPs = new Map<string, string>(); const ipMACs = new Map<string, string>()
  for (const d of config.devices) {
    if ((parseInt(d.mac.slice(0, 2), 16) & 1) || d.mac === '00:00:00:00:00:00') throw new Error('La MAC debe ser unicast y no nula')
    if (d.ip) {
      if (macIPs.has(d.mac) && macIPs.get(d.mac) !== d.ip) throw new Error('Una MAC no puede tener dos IP reservadas')
      if (ipMACs.has(d.ip) && ipMACs.get(d.ip) !== d.mac) throw new Error('La IP reservada ya pertenece a otra MAC')
      macIPs.set(d.mac, d.ip); ipMACs.set(d.ip, d.mac)
    }
    if (!nodes.some(n => n.node_id === d.node_id && n.enabled)) throw new Error(`Nodo no habilitado: ${d.node_id}`)
    if (d.enabled && !Object.values(d.endpoints).some(Boolean)) throw new Error(`Sin endpoints GET: ${d.name}`)
  }
  return config
}
const device = (id: string, name: string, node_id: string, mac: string, port: number, status: string, enabled = true, ip = ''): BridgeDevice => ({ id, name, node_id, mac, ip, port, enabled, environment: 'test', endpoints: { status, records: '', alerts: '' } })
export const defaultBridgeConfig: BridgeConfig = {
  interval_ms: 10000, paused: false, channel: 6,
  devices: [
    device('fire', 'Incendios', 'fire_node_01', 'EC:8E:77:10:D4:E8', 8081, '/api/incendios'),
    device('energy', 'Sistema energético', 'energy_node_01', '74:97:79:51:DD:C1', 80, '/api/v1/status'),
    device('volcanic', 'Volcánico', 'volcanic_node_01', '3C:58:C2:A4:54:BB', 80, '/api/v1/status'),
    device('water', 'Inundaciones', 'water_node_01', '38:87:D5:BC:7C:67', 80, '/api/v1/status', true, '192.168.4.7'),
  ],
}

import { readFileSync } from 'node:fs'
import { z } from 'zod'

const pathSchema = z.string().regex(/^\/(?!\/)[^?#]*$/)
const envName = z.string().regex(/^[A-Z][A-Z0-9_]*$/)
export const nodeSchema = z.object({
  node_id: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/), group_number: z.number().int().min(1).max(6),
  subsystem: z.string().min(1).max(120), expected_interval_seconds: z.number().int().min(1).max(86400),
  enabled: z.boolean(), variable_units: z.record(z.string()),
}).strict()
export type LocalNode = z.infer<typeof nodeSchema>
const sourceSchema = z.object({
  node_id: z.string(), enabled: z.boolean(), base_url: z.string(), environment: z.enum(['test', 'operational']),
  token_env: envName, ingest_token_env: envName,
  poll_interval_ms: z.number().int().min(1000).max(3600000), timeout_ms: z.number().int().min(100).max(60000),
  paths: z.object({ status: pathSchema, records: pathSchema, alerts: pathSchema }).strict(),
}).strict()
export type SourceConfig = z.infer<typeof sourceSchema>
const deliverySchema = z.object({
  enabled: z.boolean(), base_url: z.string(), events_path: pathSchema, token_env: envName,
  environment: z.enum(['test', 'operational']), allow_simulated: z.boolean(),
  max_event_age_seconds: z.number().int().min(1).max(86400),
}).strict()
export type DeliveryConfig = z.infer<typeof deliverySchema>
export const configSchema = z.object({ sources: z.array(sourceSchema), group5_delivery: deliverySchema }).strict()
export type LocalConfig = z.infer<typeof configSchema>

export function endpoint(base: string, path: string) {
  const root = new URL(base)
  if (!['http:', 'https:'].includes(root.protocol) || root.username || root.password || root.search || root.hash || root.pathname !== '/') throw new Error('La URL base debe ser un origen HTTP(S), sin rutas ni credenciales')
  const result = new URL(path, root)
  if (result.origin !== root.origin) throw new Error('La ruta no puede cambiar de servidor')
  return result
}
export function validateConfiguration(config: LocalConfig, nodes: LocalNode[]) {
  if (new Set(nodes.map(n => n.node_id)).size !== nodes.length || new Set(config.sources.map(s => s.node_id)).size !== config.sources.length) throw new Error('Identificador de nodo repetido en configuracion')
  for (const source of config.sources) {
    const node = nodes.find(n => n.node_id === source.node_id)
    if (!node) throw new Error('Fuente sin nodo registrado: ' + source.node_id)
    if (source.enabled && !node.enabled) throw new Error('Fuente habilitada con nodo deshabilitado: ' + node.node_id)
    if (source.enabled) for (const path of Object.values(source.paths)) endpoint(source.base_url, path)
  }
  if (config.group5_delivery.enabled) endpoint(config.group5_delivery.base_url, config.group5_delivery.events_path)
}
export function loadConfiguration() {
  const config = configSchema.parse(JSON.parse(readFileSync(process.env.LOCAL_GROUPS_FILE || 'backend/config/groups.json', 'utf8')))
  const nodes = z.array(nodeSchema).parse(JSON.parse(readFileSync('backend/config/nodes.json', 'utf8')))
  validateConfiguration(config, nodes)
  return { config, nodes }
}

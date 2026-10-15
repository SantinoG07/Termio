import { z } from 'zod'

export const alertLevels = ['normal', 'low', 'medium', 'high', 'critical'] as const
export const recordTypes = ['reading', 'state', 'event', 'alert', 'confirmation'] as const
const fieldName = /^[a-z][a-z0-9_]*$/
const numericFields = new Set(['temperature', 'humidity', 'wind_speed', 'smoke_level', 'pm2_5', 'pm10', 'so2_concentration', 'co2_concentration', 'voltage', 'current', 'generation_power', 'consumption_power', 'stored_energy', 'battery_level', 'water_level', 'water_volume', 'flow_rate', 'water_temperature', 'connected_nodes', 'total_nodes'])
const dictionaries = <T extends z.ZodTypeAny>(value: T) => z.record(z.string().regex(fieldName), value)
const quality = z.enum(['valid', 'missing', 'invalid', 'uncalibrated'])
const source = z.enum(['real', 'simulated'])
const text = z.string().trim().min(1).max(2000)
const dataValue = z.union([z.number().finite(), z.boolean(), text, z.null(), z.array(text).max(100)])

export const baseRecordSchema = z.object({
  schema_version: z.literal('1.0.0'),
  record_id: z.string().uuid(),
  record_type: z.enum(recordTypes),
  node_id: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
  group: z.number().int().min(1).max(6),
  subsystem: z.string().trim().min(1).max(120),
  timestamp: z.string().datetime({ offset: true }),
  status: z.enum(['active', 'offline', 'error']),
  alert_level: z.enum(alertLevels),
  data: dictionaries(dataValue),
  metadata: z.object({
    environment: z.enum(['test', 'operational']),
    source_type: z.enum(['real', 'simulated', 'mixed']),
    alert_evaluated: z.boolean(),
    clock_synced: z.boolean(),
    units: dictionaries(z.string().min(1).max(32)).default({}),
    quality: dictionaries(quality).default({}),
    sources: dictionaries(source).optional(),
    supersedes_record_id: z.string().uuid().optional(),
    extensions: z.record(z.unknown()).optional(),
  }).strict(),
}).strict()

export const recordSchema = baseRecordSchema.superRefine((record, ctx) => {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message })
  if (!Object.keys(record.data).length) issue(['data'], 'El registro debe contener al menos una variable')
  for (const [key, value] of Object.entries(record.data)) {
    if (numericFields.has(key) && value !== null && typeof value !== 'number') issue(['data', key], 'La variable debe ser un número JSON o null')
    if (key === 'pump_state' && !['on', 'off', 'unknown'].includes(String(value))) issue(['data', key], 'Estado de bomba inválido')
    if (key === 'valve_state' && !['open', 'closed', 'unknown'].includes(String(value))) issue(['data', key], 'Estado de válvula inválido')
    if (typeof value === 'number' && !record.metadata.units[key]) issue(['metadata', 'units', key], 'Falta la unidad de la variable numérica')
    if (record.record_type === 'reading' && !record.metadata.quality[key]) issue(['metadata', 'quality', key], 'Falta la calidad de la medición')
    const q = record.metadata.quality[key]
    if (value === null && q !== 'missing' && q !== 'invalid') issue(['metadata', 'quality', key], 'Un valor null debe tener calidad missing o invalid')
    if (q === 'valid' && value === null) issue(['data', key], 'Un valor válido no puede ser null')
    if (q === 'missing' && value !== null) issue(['data', key], 'Una medición missing debe ser null')
    if (q === 'invalid' && value !== null) issue(['data', key], 'El dato normalizado inválido debe ser null; conservar el crudo en extensions')
    if (record.metadata.source_type === 'mixed' && !record.metadata.sources?.[key]) issue(['metadata', 'sources', key], 'Falta el origen de la variable mixta')
    if (typeof value === 'number' && ['humidity', 'battery_level', 'water_level'].includes(key) && (value < 0 || value > 100)) issue(['data', key], 'El porcentaje debe estar entre 0 y 100')
    if (typeof value === 'number' && ['pm2_5', 'pm10', 'water_volume', 'wind_speed', 'stored_energy', 'generation_power', 'consumption_power', 'connected_nodes', 'total_nodes'].includes(key) && value < 0) issue(['data', key], 'El valor no puede ser negativo')
    if (['connected_nodes', 'total_nodes'].includes(key) && typeof value === 'number' && !Number.isInteger(value)) issue(['data', key], 'El contador debe ser entero')
  }
  for (const key of ['units', 'quality', 'sources'] as const) {
    for (const name of Object.keys(record.metadata[key] ?? {})) {
      if (!(name in record.data)) issue(['metadata', key, name], 'La variable no existe en data')
    }
  }
  if (record.record_type === 'event' && (!record.data.event_code || typeof record.data.event_code !== 'string' || typeof record.data.message !== 'string')) issue(['data'], 'Un evento requiere event_code y message')
  if (record.record_type === 'alert') {
    if (typeof record.data.alert_id !== 'string' || typeof record.data.message !== 'string' || !Array.isArray(record.data.channels) || !Array.isArray(record.data.related_record_ids)) issue(['data'], 'Una alerta requiere alert_id, message, channels y related_record_ids')
    if (!['pending', 'active', 'resolved', 'cancelled'].includes(String(record.data.alert_status))) issue(['data', 'alert_status'], 'Estado de alerta inválido')
  }
  if (record.record_type === 'confirmation') {
    if (typeof record.data.alert_id !== 'string' || !['technical_receipt', 'device_execution', 'human_acknowledgement'].includes(String(record.data.confirmation_type)) || !['success', 'failure'].includes(String(record.data.result))) issue(['data'], 'Confirmación incompleta o inválida')
  }
  if (record.data.related_record_ids !== undefined && (!Array.isArray(record.data.related_record_ids) || record.data.related_record_ids.some(id => !z.string().uuid().safeParse(id).success))) issue(['data', 'related_record_ids'], 'Las referencias deben ser UUID')
})

export type NormalizedRecord = z.infer<typeof recordSchema>

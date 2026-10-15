import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

const url = process.env.INGEST_URL
const key = process.env.GROUP_1_INGEST_KEY
if (!url || !key) {
  console.error('Definí INGEST_URL y GROUP_1_INGEST_KEY en tu terminal. No uses variables VITE_.')
  process.exit(1)
}
const fixture = JSON.parse(await readFile(new URL('../examples/reading.json', import.meta.url), 'utf8'))
const payload = { ...fixture, record_id: randomUUID(), timestamp: new Date().toISOString() }
const post = (body, credential = key) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(credential ? { Authorization: `Bearer ${credential}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) })
async function check(label, body, expected, credential = key) {
  const response = await post(body, credential)
  const result = await response.json()
  if (response.status !== expected) throw new Error(`${label}: esperado ${expected}, obtenido ${response.status}: ${JSON.stringify(result)}`)
  console.log(`OK ${label}: HTTP ${response.status}`)
  return result
}
try {
  await check('sin credencial', payload, 401, '')
  await check('contrato inválido', { ...payload, alert_level: 'red' }, 422)
  await check('grupo no autorizado', { ...payload, group: 2 }, 403)
  await check('unidad incorrecta', { ...payload, metadata: { ...payload.metadata, units: { ...payload.metadata.units, temperature: 'F' } } }, 422)
  const created = await check('primera recepción', payload, 201)
  const duplicate = await check('reintento idéntico', payload, 200)
  if (created.duplicate || !duplicate.duplicate) throw new Error('Semántica de duplicados incorrecta')
  await check('conflicto de identificador', { ...payload, data: { ...payload.data, temperature: 32 } }, 409)
  console.log(`Registro simulado de prueba almacenado: ${payload.record_id}`)
} catch (error) { console.error(error.message); process.exit(1) }

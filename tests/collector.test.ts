import { describe, expect, it } from 'vitest'
import { CollectorError, fetchRecord, readCollectorConfig, sendRecord } from '../scripts/collector-lib.ts'
import fixture from '../examples/reading.json'

const env = { SOURCE_URL: 'https://source.example.test/api/status', INGEST_URL: 'https://project.example.test/functions/v1/ingest-record', INGEST_KEY: 'b'.repeat(64), EXPECTED_NODE_ID: 'fire_node_01', EXPECTED_GROUP: '1', EXPECTED_ENVIRONMENT: 'test', SOURCE_TOKEN: 'separate-source-token' }
const config = readCollectorConfig(env)
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
describe('Colector público / ESP32', () => {
  it('requiere configuración y distingue URL de origen y destino', () => {
    expect(config.sourceUrl).not.toBe(config.ingestUrl)
    expect(() => readCollectorConfig({ ...env, INGEST_KEY: '' })).toThrow('INGEST_KEY')
    expect(() => readCollectorConfig({ ...env, SOURCE_URL: 'https://tu-api.example.invalid/api/status' })).toThrow('Reemplazá')
  })
  it('HTTP local requiere habilitación explícita, destino siempre HTTPS', () => {
    expect(() => readCollectorConfig({ ...env, SOURCE_URL: 'http://192.168.1.50/api/status' })).toThrow('HTTPS')
    expect(readCollectorConfig({ ...env, SOURCE_URL: 'http://192.168.1.50/api/status', ALLOW_SOURCE_HTTP: 'true' }).sourceUrl).toBe('http://192.168.1.50/api/status')
    expect(() => readCollectorConfig({ ...env, INGEST_URL: 'http://example.test', ALLOW_SOURCE_HTTP: 'true' })).toThrow('HTTPS')
  })
  it('GET conserva el ID y la fecha originales y no filtra credencial de ingesta', async () => {
    let header: Headers | undefined
    const mock: typeof fetch = async (_url, options) => { header = new Headers(options?.headers); expect(options?.method).toBe('GET'); expect(options?.redirect).toBe('error'); return response(fixture) }
    const record = await fetchRecord(config, mock)
    expect(record.record_id).toBe(fixture.record_id)
    expect(record.timestamp).toBe(fixture.timestamp)
    expect(header!.get('Authorization')).toBe('Bearer separate-source-token')
    expect(header!.get('Authorization')).not.toContain(env.INGEST_KEY)
  })
  it('rechaza arrays, nodos ajenos, entornos cruzados y contratos inválidos', async () => {
    for (const invalid of [[fixture], { ...fixture, node_id: 'water_node_01' }, { ...fixture, metadata: { ...fixture.metadata, environment: 'operational' } }, { ...fixture, data: {} }]) {
      await expect(fetchRecord(config, async () => response(invalid))).rejects.toBeInstanceOf(CollectorError)
    }
  })
  it('marca fallos transitorios como reintentables y credenciales erróneas como definitivos', async () => {
    await expect(fetchRecord(config, async () => response({}, 503))).rejects.toMatchObject({ retryable: true })
    await expect(fetchRecord(config, async () => response({}, 401))).rejects.toMatchObject({ retryable: false })
  })
  it('rechaza respuestas no JSON o excesivas', async () => {
    await expect(fetchRecord(config, async () => new Response('<html>'))).rejects.toThrow('application/json')
    await expect(fetchRecord(config, async () => response({ huge: 'x'.repeat(70000) }))).rejects.toThrow('64 KiB')
  })
  it('POST reintenta la misma muestra sin cambiar UUID ni contenido', async () => {
    const record = await fetchRecord(config, async () => response(fixture))
    const bodies: string[] = []
    const mock: typeof fetch = async (_url, options) => {
      expect(new Headers(options?.headers).get('Authorization')).toBe(`Bearer ${env.INGEST_KEY}`)
      bodies.push(String(options?.body))
      return response({ record_id: record.record_id, duplicate: bodies.length > 1 }, bodies.length > 1 ? 200 : 201)
    }
    expect((await sendRecord(config, record, mock)).duplicate).toBe(false)
    expect((await sendRecord(config, record, mock)).duplicate).toBe(true)
    expect(bodies[0]).toBe(bodies[1])
  })
  it('un conflicto no se reintenta ni se acepta una confirmación de otro registro', async () => {
    const record = await fetchRecord(config, async () => response(fixture))
    await expect(sendRecord(config, record, async () => response({}, 409))).rejects.toMatchObject({ retryable: false })
    await expect(sendRecord(config, record, async () => response({ record_id: 'otro', duplicate: false }, 201))).rejects.toThrow('identificador')
  })
})

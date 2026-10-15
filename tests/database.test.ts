import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import fixture from '../examples/reading.json'

const db = new PGlite()
const hash = 'a'.repeat(64)
const owner = '11111111-1111-4111-8111-111111111111'
const outsider = '22222222-2222-4222-8222-222222222222'
const path = (name: string) => new URL(`../supabase/migrations/${name}`, import.meta.url)
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    grant usage on schema auth, public to authenticated, anon, service_role;
    grant execute on function auth.uid() to authenticated;
    insert into auth.users values ('${owner}'), ('${outsider}');`)
  await db.exec(await readFile(path('202610140001_initial.sql'), 'utf8'))
  await db.exec(await readFile(path('202610140002_read_models.sql'), 'utf8'))
  await db.query('insert into public.workspace_members(user_id) values ($1)', [owner])
  await db.query("insert into public.integration_credentials(group_number,key_hash,label) values (1,$1,'test fixture')", [hash])
}, 30000)
afterAll(() => db.close())
const ingest = async (payload: unknown, keyHash = hash) => {
  const result = await db.query<{ result: { duplicate: boolean; record_id: string } }>('select public.ingest_record($1::jsonb,$2) as result', [JSON.stringify(payload), keyHash])
  return result.rows[0].result
}
describe('Migraciones, transacción de ingesta y RLS (PostgreSQL embebido)', () => {
  it('registra los seis nodos sin insertar mediciones ficticias', async () => {
    const result = await db.query<{ total: number }>('select count(*)::int as total from public.nodes')
    expect(result.rows[0].total).toBe(6)
    expect((await db.query('select * from public.records')).rows).toHaveLength(0)
  })
  it('inserta una vez y deduplica semánticamente un reintento', async () => {
    await db.exec('set role service_role')
    expect((await ingest(fixture)).duplicate).toBe(false)
    expect((await ingest(fixture)).duplicate).toBe(true)
    expect((await db.query('select * from public.records')).rows).toHaveLength(1)
    await db.exec('reset role')
  })
  it('rechaza reutilizar un ID con contenido diferente', async () => {
    await expect(ingest({ ...fixture, data: { ...fixture.data, temperature: 32 } })).rejects.toThrow('RECORD_CONFLICT')
  })
  it('rechaza credenciales inexistentes, suplantación de grupo y entorno no autorizado', async () => {
    await expect(ingest(fixture, 'b'.repeat(64))).rejects.toThrow('INVALID_CREDENTIAL')
    await expect(ingest({ ...fixture, group: 2 })).rejects.toThrow('FORBIDDEN_PRODUCER')
    await expect(ingest({ ...fixture, metadata: { ...fixture.metadata, environment: 'operational' } })).rejects.toThrow('FORBIDDEN_PRODUCER')
  })
  it('rechaza una unidad no acordada y una fecha futura', async () => {
    await expect(ingest({ ...fixture, metadata: { ...fixture.metadata, units: { ...fixture.metadata.units, temperature: 'F' } } })).rejects.toThrow('UNIT_MISMATCH')
    await expect(ingest({ ...fixture, timestamp: '2099-01-01T00:00:00Z' })).rejects.toThrow('FUTURE_TIMESTAMP')
  })
  it('un reenvío antiguo no reemplaza el snapshot vigente', async () => {
    await ingest({ ...fixture, record_id: '33333333-3333-4333-8333-333333333333', timestamp: '2026-10-13T13:30:00Z' })
    const result = await db.query<{ record_id: string }>('select record_id from public.node_latest_records')
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].record_id).toBe(fixture.record_id)
  })
  it('un miembro puede leer, pero no escribir ni consultar credenciales', async () => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner])
    await db.exec('set role authenticated')
    expect((await db.query('select * from public.records')).rows.length).toBe(2)
    expect((await db.query('select * from public.node_latest_records')).rows).toHaveLength(1)
    await expect(db.query('select key_hash from public.integration_credentials')).rejects.toThrow('permission denied')
    await expect(db.query('delete from public.records')).rejects.toThrow('permission denied')
    await expect(ingest(fixture)).rejects.toThrow('permission denied')
    await db.exec('reset role')
  })
  it('un usuario sin membresía no puede leer registros ni snapshots', async () => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [outsider])
    await db.exec('set role authenticated')
    expect((await db.query('select * from public.records')).rows).toHaveLength(0)
    expect((await db.query('select * from public.node_latest_records')).rows).toHaveLength(0)
    expect((await db.query('select * from public.nodes')).rows).toHaveLength(0)
    await db.exec('reset role')
  })
  it('anon no tiene permisos de lectura', async () => {
    await db.exec('set role anon')
    await expect(db.query('select * from public.records')).rejects.toThrow('permission denied')
    await db.exec('reset role')
  })
})

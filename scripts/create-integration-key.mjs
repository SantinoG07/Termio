import { createHash, randomBytes } from 'node:crypto'

const group = Number(process.argv[2])
if (!Number.isInteger(group) || group < 1 || group > 6) {
  console.error('Uso: node scripts/create-integration-key.mjs <grupo 1..6>')
  process.exit(1)
}
const token = randomBytes(32).toString('hex')
const hash = createHash('sha256').update(token).digest('hex')
console.log('CREDENCIAL PRIVADA: guardala en el backend del grupo, nunca en VITE_ ni en Git. No la pegues en el chat.')
console.log(token)
console.log('\nSQL para ejecutar como administrador en Supabase (habilita solo pruebas durante 30 días):')
console.log(`insert into public.integration_credentials(group_number, key_hash, label) values (${group}, '${hash}', 'Grupo ${group} - prueba');`)

import { loadConfiguration } from './config.ts'
import { Store } from './store.ts'
import { createLocalServer } from './server.ts'
import { startWorkers } from './poller.ts'

const { config, nodes } = loadConfiguration()
const store = new Store(process.env.LOCAL_DB_PATH || 'data/termio.db', nodes, config.group5_delivery)
const port = Number(process.env.LOCAL_API_PORT || 3001)
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('LOCAL_API_PORT invalido')
const server = createLocalServer(store, config)
let stopWorkers: (() => Promise<void>) | undefined
let closing = false
async function close() {
  if (closing) return
  closing = true
  const closed = new Promise<void>(resolve => server.close(() => resolve()))
  await stopWorkers?.(); await closed; store.close()
}
process.on('SIGINT', () => { void close() })
process.on('SIGTERM', () => { void close() })
server.on('error', () => { console.error('No se pudo iniciar el servidor local; revisar puerto y permisos.'); void close().finally(() => { process.exitCode = 1 }) })
server.listen(port, '127.0.0.1', () => {
  console.log(`Termio local: http://127.0.0.1:${port} | SQLite local | sin Supabase`)
  console.log(`Fuentes habilitadas: ${config.sources.filter(s => s.enabled).length}. Configurar backend/config/groups.json y reiniciar.`)
  console.log('API limitada a esta PC. Las consultas salientes alcanzan los ESP32 por la red Wi-Fi local.')
  stopWorkers = startWorkers(store, config)
})

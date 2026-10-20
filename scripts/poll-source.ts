import { CollectorError, fetchRecord, readCollectorConfig, sendRecord } from './collector-lib.ts'
import type { NormalizedRecord } from '../shared/record-schema.ts'

async function main() {
  const config = readCollectorConfig(process.env)
  const once = process.argv.includes('--once')
  let stopped = false
  let pending: NormalizedRecord | undefined
  process.on('SIGINT', () => { stopped = true })
  process.on('SIGTERM', () => { stopped = true })
  console.log(`Colector iniciado: nodo ${config.expectedNodeId}, grupo ${config.expectedGroup}, entorno ${config.expectedEnvironment}. Ctrl+C para salir.`)
  // No imprimir URLs completas ni cabeceras: pueden contener tokens.
  do {
    try {
      pending ??= await fetchRecord(config)
      const result = await sendRecord(config, pending)
      console.log(`${new Date().toISOString()} ${result.duplicate ? 'Ya almacenado' : 'Almacenado'}: ${pending.record_id}`)
      pending = undefined
    } catch (error) {
      const known = error instanceof CollectorError
      console.error(known ? error.message : 'Fallo de red o timeout. Se reintentará sin imprimir detalles sensibles.')
      if (once || (known && !error.retryable)) { process.exitCode = 1; break }
      // Conservar el mismo registro/UUID en memoria hasta confirmar su recepción.
      // No es una cola persistente: detener el proceso pierde este pendiente.
    }
    if (once || stopped) break
    await new Promise(resolve => setTimeout(resolve, config.intervalMs))
  } while (!stopped)
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'No se pudo iniciar el colector'); process.exitCode = 1 })

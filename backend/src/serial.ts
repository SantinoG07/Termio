import { spawn, type ChildProcess } from 'node:child_process'
import { readdirSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { StringDecoder } from 'node:string_decoder'
import { LocalError, type Store } from './store.ts'
import { observeSerialDiagnostic, currentRequest } from '../../shared/serial-debug.ts'
import { BridgeController } from './bridge.ts'
import { GatewayController } from './gateway.ts'
import { DiagnosticJournal } from './diagnostic-journal.ts'
import { resolve } from 'node:path'
import type { SourceConfig } from './config.ts'

const MAX_BYTES = 65536

// Compatible con el sketch actual: logs, HTTP: 200 y cuerpo entre marcadores.
// Tambien acepta un registro JSON en una sola linea sin logs mezclados.
export class SerialDecoder {
  private line = ''
  private body: string[] | null = null
  private size = 0
  private httpCode: number | null = null
  private discardLine = false
  private receive: (payload: unknown) => void
  private reject: (code: string) => void
  private diagnostic: (line: string) => void
  constructor(receive: (payload: unknown) => void, reject: (code: string) => void, diagnostic: (line: string) => void = () => {}) {
    this.receive = receive; this.reject = reject; this.diagnostic = diagnostic
  }
  push(chunk: string) {
    for (const char of chunk) {
      if (char === '\n') {
        if (!this.discardLine) this.process(this.line.replace(/\r$/, ''))
        this.line = ''; this.discardLine = false
      } else if (!this.discardLine) {
        this.line += char
        if (this.line.length > MAX_BYTES) {
          this.line = ''; this.body = null; this.discardLine = true
          this.reject('SERIAL_LINE_TOO_LARGE')
        }
      }
    }
  }
  private process(line: string) {
    const text = line.trim()
    if (this.body && text.startsWith('TERMIO_BRIDGE ') && /"event"\s*:\s*"boot"/.test(text)) {
      this.body=null;this.httpCode=null;this.reject('SERIAL_INTERRUPTED_BY_REBOOT')
    }
    if (!this.body) this.diagnostic(text)
    const code = /^HTTP:\s*(\d{3})$/.exec(text)
    if (code && !this.body) { this.httpCode = Number(code[1]); return }
    if (text === '--- INICIO DE RESPUESTA ---' || text === '--- RESPUESTA ---') {
      this.body = []; this.size = 0; return
    }
    if (text === '--- FIN DE RESPUESTA ---' || text === '--- FIN ---') {
      const body = this.body
      this.body = null
      if (body && this.httpCode === 200) this.parse(body.join('\n'))
      this.httpCode = null
      return
    }
    if (this.body) {
      this.size += Buffer.byteLength(line, 'utf8') + 1
      if (this.size > MAX_BYTES) { this.body = null; this.httpCode = null; this.reject('SERIAL_BODY_TOO_LARGE') }
      else this.body.push(line)
      return
    }
    // Ignorar diagnosticos y respuestas HTTP fallidas fuera de un frame.
    if (this.httpCode === null && text.startsWith('{')) this.parse(text)
  }
  private parse(text: string) {
    if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) { this.reject('SERIAL_BODY_TOO_LARGE'); return }
    let payload: unknown
    try { payload = JSON.parse(text) } catch { this.reject('SERIAL_INVALID_JSON'); return }
    this.receive(payload)
  }
}

export function acceptSerialPayload(store: Store, payload: unknown, source?: SourceConfig, checkpointKey?: string) {
  let records: unknown[]
  let checkpoint: { key: string; next: string | null } | undefined
  if (payload && typeof payload === 'object' && 'items' in payload) {
    const page = payload as { items: unknown; has_more?: unknown; next_cursor?: unknown }
    if (!Array.isArray(page.items) || page.items.length > 100 || typeof page.has_more !== 'boolean' || !(page.next_cursor === null || typeof page.next_cursor === 'string')) throw new LocalError(422, 'SERIAL_INVALID_COLLECTION')
    records = page.items
    if (checkpointKey) {
      const previous = store.cursor(checkpointKey)
      if (page.has_more && (typeof page.next_cursor !== 'string' || !page.next_cursor || page.next_cursor === previous)) throw new LocalError(422, 'CURSOR_NOT_ADVANCING')
      if (typeof page.next_cursor === 'string' && page.next_cursor.length > 512) throw new LocalError(422, 'CURSOR_TOO_LONG')
      checkpoint = { key: checkpointKey, next: typeof page.next_cursor === 'string' ? page.next_cursor : previous }
    }
  } else {
    if (checkpointKey) throw new LocalError(422, 'EXPECTED_COLLECTION')
    records = [payload]
  }
  for (const record of records) store.validate(record, source)
  return store.ingestSerial(records, checkpoint)
}

function detectPort() {
  const candidates = new Map<string, string>()
  try {
    for (const name of readdirSync('/dev/serial/by-id')) {
      const path = '/dev/serial/by-id/' + name
      candidates.set(realpathSync(path), path)
    }
  } catch { /* No hay enlaces estables. */ }
  try {
    for (const name of readdirSync('/dev').filter(n => /^tty(USB|ACM)\d+$/.test(n))) {
      const path = '/dev/' + name
      if (!candidates.has(realpathSync(path))) candidates.set(realpathSync(path), path)
    }
  } catch { /* Reintentar sin interrumpir el dashboard. */ }
  if (candidates.size > 1) throw new Error('SERIAL_AMBIGUOUS_PORT')
  return [...candidates.values()][0]
}

export function startSerial(store: Store, options: { port?: string; baud?: number; python?: string } = {}) {
  const requested = options.port ?? process.env.SERIAL_PORT ?? 'off'
  const baud = options.baud ?? Number(process.env.SERIAL_BAUD || 115200)
  if (!['9600', '19200', '38400', '57600', '115200', '230400'].includes(String(baud))) throw new Error('SERIAL_BAUD invalido')
  store.serialStatus.enabled = requested !== 'off'
  if (requested === 'off') return async () => {}
  const journal=new DiagnosticJournal(resolve(process.env.SERIAL_DIAGNOSTIC_LOG || 'backend/data/serial-diagnostic.log'))
  store.diagnosticStatus.log_error=journal.error
  let stopped = false
  let child: ChildProcess | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const send = (line: string) => {
    if (!child?.stdin?.writable || !store.serialStatus.connected) return false
    child.stdin.write(line, error => { if (error) store.bridgeStatus.last_error = 'SERIAL_WRITE_FAILED' })
    return true
  }
  const bridge = new BridgeController(store, send)
  const gateway = new GatewayController(store, send)
  const fail = (code: string, details: unknown = []) => {
    bridge.rejected(code)
    store.serialStatus.last_error = code
    store.serialStatus.last_error_details = Array.isArray(details) ? details.slice(0, 20).map(d => ({ field: typeof d?.field === 'string' ? d.field.slice(0, 150) : undefined, message: typeof d?.message === 'string' ? d.message.slice(0, 200) : undefined })) : []
    const request = currentRequest(store.serialStatus.debug)
    if (request) { request.ingest = 'rejected'; request.error = code }
    store.serialStatus.rejected++
    store.reject('serial', new LocalError(422, code, store.serialStatus.last_error_details))
    console.error(`[Serial] ${code}`)
  }
  function connect() {
    if (stopped) return
    let port: string | undefined
    try { port = requested === 'auto' ? detectPort() : requested }
    catch { store.serialStatus.last_error = 'SERIAL_AMBIGUOUS_PORT' }
    if (!port) {
      store.serialStatus.connected = false
      store.serialStatus.last_error ||= 'SERIAL_NO_DEVICE'
      timer = setTimeout(connect, 3000)
      return
    }
    store.serialStatus.port = port
    const decoder = new StringDecoder('utf8')
    const parser = new SerialDecoder(payload => {
      try {
        const context = bridge.context()
        const results = acceptSerialPayload(store, payload, context.source, context.checkpointKey)
        bridge.ingested(payload)
        store.serialStatus.last_received_at = new Date().toISOString()
        store.serialStatus.last_error = null
        store.serialStatus.last_error_details = []
        const request = currentRequest(store.serialStatus.debug)
        if (request && results.length) request.ingest = results.some(r => !r.duplicate) ? 'new' : 'duplicate'
        const value = payload as { items?: unknown[]; node_id?: string; record_id?: string; timestamp?: string }
        const last = (Array.isArray(value?.items) ? value.items.at(-1) : value) as typeof value | undefined
        if (last && typeof last.node_id === 'string' && typeof last.record_id === 'string' && typeof last.timestamp === 'string') store.serialStatus.debug.last_record = { node_id: last.node_id, record_id: last.record_id, timestamp: last.timestamp, duplicate: results.at(-1)?.duplicate ?? false }
        store.serialStatus.accepted += results.filter(r => !r.duplicate).length
        store.serialStatus.duplicates += results.filter(r => r.duplicate).length
        console.log(`[Serial] ${results.length} registro(s): ${results.filter(r => !r.duplicate).length} nuevo(s), ${results.filter(r => r.duplicate).length} duplicado(s).`)
      } catch (error) { fail(error instanceof LocalError ? error.code : 'SERIAL_STORAGE_ERROR', error instanceof LocalError ? error.details : []) }
    }, fail, line => {
      if (line.startsWith('TERMIO_BRIDGE ')) {
        const text = line.slice(14)
        try { const p = JSON.parse(text); if (p && typeof p === 'object' && typeof p.event === 'string' && p.event.startsWith('api_')) gateway.packet(p); else { if(p?.event==='boot')gateway.stop(); bridge.packet(text) } } catch { /* Invalid diagnostic, not a producer record. */ }
      }
      else observeSerialDiagnostic(store.serialStatus.debug, line)
    })
    child = spawn(options.python ?? process.env.SERIAL_PYTHON ?? 'python3', [fileURLToPath(new URL('../../scripts/serial-reader.py', import.meta.url)), port, String(baud)], { stdio: ['pipe', 'pipe', 'pipe'] })
    child.stdin?.on('error', () => { store.bridgeStatus.last_error = 'SERIAL_WRITE_FAILED' })
    child.stdout?.on('data', (data: Buffer) => {
      store.serialStatus.debug.bytes_received += data.length
      store.serialStatus.debug.last_byte_at = new Date().toISOString()
      const text=decoder.write(data)
      journal.push(text);store.diagnosticStatus.log_error=journal.error
      parser.push(text)
    })
    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString()
      if (text.includes('SERIAL_READY')) {
        store.serialStatus.connected = true; store.serialStatus.last_error = null
        bridge.hello()
        console.log('[Serial] Puerto abierto. Cerrar el monitor serie de Arduino mientras se usa el backend.')
      } else {
        store.serialStatus.last_error = text.includes('PERMISSION') ? 'SERIAL_PERMISSION_DENIED' : text.includes('BUSY') ? 'SERIAL_PORT_BUSY' : 'SERIAL_PORT_ERROR'
      }
    })
    child.on('error', () => { store.serialStatus.last_error = 'SERIAL_PYTHON_OR_PORT_UNAVAILABLE' })
    child.on('close', () => {
      gateway.stop()
      bridge.disconnected()
      store.serialStatus.connected = false
      if (!stopped) timer = setTimeout(connect, 3000)
    })
  }
  connect()
  return async () => {
    stopped = true
    journal.close()
    gateway.stop()
    bridge.stop()
    if (timer) clearTimeout(timer)
    const active = child
    if (active && active.exitCode === null && active.signalCode === null) {
      await new Promise<void>(resolve => { active.once('close', () => resolve()); active.kill('SIGTERM') })
    }
    store.serialStatus.connected = false
  }
}

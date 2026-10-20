export interface SerialRequestDebug {
  equipment: string
  at: string
  mac: string | null
  ip: string | null
  url: string | null
  stage: 'preparing' | 'requesting' | 'http_ok' | 'http_error' | 'connection_error' | 'not_found'
  http_status: number | null
  error: string | null
  ingest: 'new' | 'duplicate' | 'rejected' | null
  last_result?: { at: string; http_status: number | null; stage: SerialRequestDebug['stage']; ingest: SerialRequestDebug['ingest']; error: string | null }
}
export interface SerialDebug {
  bytes_received: number
  last_byte_at: string | null
  ap_clients: number | null
  clients_at: string | null
  clients: { mac: string; ip: string }[]
  current_equipment: string | null
  requests: SerialRequestDebug[]
  events: { at: string; message: string }[]
  last_record: { node_id: string; record_id: string; timestamp: string; duplicate: boolean } | null
}
export function createSerialDebug(): SerialDebug {
  return { bytes_received: 0, last_byte_at: null, ap_clients: null, clients_at: null, clients: [], current_equipment: null, requests: [], events: [], last_record: null }
}
export function currentRequest(debug: SerialDebug) {
  return debug.requests.find(r => r.equipment === debug.current_equipment)
}
// Solo interpreta diagnosticos conocidos. Nunca almacena cuerpos JSON, claves o cabeceras.
export function observeSerialDiagnostic(debug: SerialDebug, text: string, at = new Date().toISOString()) {
  const log = (message: string) => { debug.events.push({ at, message }); if (debug.events.length > 60) debug.events.shift() }
  const equipment = (name: string) => {
    name = name.slice(0, 100)
    debug.current_equipment = name
    let row = currentRequest(debug)
    if (!row) {
      row = { equipment: name, at, mac: null, ip: null, url: null, stage: 'preparing', http_status: null, error: null, ingest: null }
      debug.requests.push(row)
      if (debug.requests.length > 32) debug.requests.shift()
    }
    if (!['preparing', 'requesting'].includes(row.stage)) row.last_result = { at: row.at, http_status: row.http_status, stage: row.stage, ingest: row.ingest, error: row.error }
    Object.assign(row, { at, mac: null, ip: null, url: null, stage: 'preparing', http_status: null, error: null, ingest: null })
    return row
  }
  let match = /^Cantidad:\s*(\d{1,2})$/.exec(text)
  if (match) {
    debug.ap_clients = Number(match[1]); debug.clients_at = at; debug.clients = []; debug.current_equipment = null
    log(`AP: ${debug.ap_clients} cliente(s) asociado(s)`); return
  }
  match = /^MAC:\s*([0-9a-f:]{17})\s*\|\s*IP:\s*(\d{1,3}(?:\.\d{1,3}){3}|Sin IP DHCP disponible)$/i.exec(text)
  if (match) {
    if (debug.clients.length < 32) debug.clients.push({ mac: match[1].toUpperCase(), ip: match[2] })
    return
  }
  match = /^Equipo:\s*(.{1,100})$/.exec(text)
  if (match) { equipment(match[1]); return }
  match = /^([^:]{1,95}): no conectado o sin IP DHCP disponible\.$/.exec(text)
  if (match) { equipment(match[1]).stage = 'not_found'; log(`${match[1]}: MAC no encontrada o sin IP DHCP`); return }
  const row = currentRequest(debug)
  if (!row) return
  match = /^MAC:\s*([0-9a-f:]{17})$/i.exec(text) || /^MAC buscada:\s*([0-9a-f:]{17})$/i.exec(text)
  if (match) { row.mac = match[1].toUpperCase(); return }
  match = /^IP detectada:\s*(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text)
  if (match) { row.ip = match[1]; return }
  if (text.startsWith('GET ')) {
    try {
      const url = new URL(text.slice(4))
      if (!['http:', 'https:'].includes(url.protocol)) return
      // Quitar credenciales, query y fragmentos aunque se agreguen por error al firmware.
      row.url = `${url.origin}${url.pathname}`.slice(0, 220)
      row.stage = 'requesting'; row.at = at
      log(`${row.equipment}: GET ${row.url}`)
    } catch { /* Ignorar URL no interpretable. */ }
    return
  }
  match = /^HTTP:\s*(\d{3})$/.exec(text)
  if (match) {
    row.http_status = Number(match[1]); row.stage = row.http_status === 200 ? 'http_ok' : 'http_error'; row.at = at
    log(`${row.equipment}: HTTP ${row.http_status}`); return
  }
  if (text.startsWith('ERROR de conexion HTTP:') || text.startsWith('Error HTTP:')) {
    const value = text.slice(text.indexOf(':') + 1).trim().toLowerCase()
    const safe = ['connection refused', 'connection lost', 'read timeout', 'connection timeout', 'not connected', 'send header failed', 'send payload failed'].find(v => value === v) ?? 'error de transporte HTTP'
    row.stage = 'connection_error'; row.error = safe; row.at = at
    log(`${row.equipment}: ${safe}`)
  }
}

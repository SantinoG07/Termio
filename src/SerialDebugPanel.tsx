import type { SerialStatus } from './lib/local'
import { dateLabel } from './lib/domain'
import './SerialDebugPanel.css'

const stages = {
  preparing: 'Preparando', requesting: 'Esperando HTTP', http_ok: 'HTTP correcto',
  http_error: 'Error HTTP', connection_error: 'Fallo de conexión', not_found: 'MAC no encontrada / sin IP DHCP',
}
export function SerialDebugPanel({ serial }: { serial: SerialStatus }) {
  const debug = serial.debug
  if (!debug) return null
  const silent = serial.connected && (!debug.last_byte_at || Date.now() - Date.parse(debug.last_byte_at) > 30000)
  return <details className="content-panel serial-debug" open>
    <summary>Diagnóstico ESP32 → SQLite → web</summary>
    <div className="serial-debug-content">
      <p className="small muted">Solo diagnóstico: no envía comandos ni activa dispositivos. Actualiza con la consulta de la página cada 10 s.</p>
      <p><strong>Wi-Fi AP:</strong> {debug.ap_clients === null ? 'Esperando el listado del firmware' : `${debug.ap_clients} equipo(s) asociado(s)`}{debug.clients_at && ` · ${dateLabel(debug.clients_at)}`}</p>
      <p><strong>USB:</strong> {debug.bytes_received.toLocaleString('es-AR')} bytes recibidos{debug.last_byte_at && ` · último tráfico: ${dateLabel(debug.last_byte_at)}`}</p>
      {silent && <p className="error-text">El puerto está abierto, pero no llegó tráfico serie reciente. Revisá que el sketch esté ejecutándose y use 115200 baudios.</p>}
      {!!debug.clients.length && <ul>{debug.clients.map(client => <li key={client.mac}><code>{client.mac}</code> → <code>{client.ip}</code></li>)}</ul>}
      {!debug.requests.length ? <p>Esperando el próximo ciclo de consultas del ESP32. Estar conectado al AP no garantiza que una API esté disponible.</p> : <div className="table-scroll"><table aria-label="Diagnóstico por equipo"><thead><tr><th>Equipo / MAC</th><th>Petición</th><th>Resultado</th><th>SQLite</th></tr></thead><tbody>{debug.requests.map(request => <tr key={request.equipment}>
        <td><strong>{request.equipment}</strong><span className="small muted">{request.mac ?? 'MAC pendiente'} · {dateLabel(request.at)}</span></td>
        <td><code>{request.url ?? request.ip ?? 'Sin IP disponible'}</code></td>
        <td>{stages[request.stage]}{request.http_status !== null && ` (${request.http_status})`}{request.error && <span className="error-text small">{request.error}</span>}{request.stage === 'connection_error' && <span className="small muted">Revisar puerto, servidor escuchando en 0.0.0.0 y firewall.</span>}</td>
        <td>{request.ingest === 'new' ? 'Nuevo: guardado' : request.ingest === 'duplicate' ? 'Duplicado: ya existe' : request.ingest === 'rejected' ? 'Rechazado por validación' : ['preparing', 'requesting'].includes(request.stage) ? 'Consulta en curso' : 'Sin registro aceptado en este intento'}{request.last_result && <span className="small muted">Intento anterior ({dateLabel(request.last_result.at)}): {request.last_result.http_status !== null ? `HTTP ${request.last_result.http_status}` : stages[request.last_result.stage]} · {request.last_result.ingest === 'new' ? 'guardado' : request.last_result.ingest === 'duplicate' ? 'duplicado, ya guardado' : request.last_result.ingest === 'rejected' ? 'rechazado' : request.last_result.error ?? 'sin ingesta'}</span>}</td>
      </tr>)}</tbody></table></div>}
      {debug.last_record && <div className="serial-debug-record"><strong>Último registro aceptado: {debug.last_record.node_id}</strong><p><code>{debug.last_record.record_id}</code> · fecha del dato: {dateLabel(debug.last_record.timestamp)}</p>{debug.last_record.duplicate && <p>El productor está repitiendo el mismo registro. No se agrega otra fila ni se cambia su fecha. Cada medición nueva necesita un record_id nuevo y su timestamp real.</p>}</div>}
      {serial.last_error && !!serial.last_error_details?.length && <ul className="error-text">{serial.last_error_details.map((detail, index) => <li key={index}>{detail.field ?? 'registro'}: {detail.message ?? serial.last_error}</li>)}</ul>}
      <details><summary>Últimos eventos técnicos ({debug.events.length}, máximo 60)</summary><ol className="serial-debug-events">{[...debug.events].reverse().map((event, index) => <li key={`${event.at}-${index}`}><time>{dateLabel(event.at)}</time> {event.message}</li>)}</ol></details>
    </div>
  </details>
}

import { useEffect } from 'react'
import { Activity, Database, Radio, RefreshCw, Settings, ShieldCheck, Wifi, X } from 'lucide-react'
import { BridgeSettings } from './BridgeSettings'
import { SerialDebugPanel } from './SerialDebugPanel'
import { dateLabel, type NodeInfo, type RecordRow } from './lib/domain'
import type { SerialStatus } from './lib/local'
import type { MockGroupSettings } from './lib/mock'
import './SecretPanel.css'

const serialErrors: Record<string, string> = {
  SERIAL_NO_DEVICE: 'Conectá el ESP32 por USB.',
  UNKNOWN_VARIABLE: 'La variable todavía no está registrada para este nodo. Hay que acordar su nombre y unidad.',
  UNIT_MISMATCH: 'La unidad recibida no coincide con la registrada. Consultá el detalle; no se convierten unidades automáticamente.',
  SERIAL_AMBIGUOUS_PORT: 'Hay varios puertos: configurá SERIAL_PORT en .env.backend.',
  SERIAL_PERMISSION_DENIED: 'Tu usuario no tiene permiso para abrir el puerto serie.',
  SERIAL_PORT_BUSY: 'El puerto está ocupado. Cerrá el monitor serie de Arduino.',
  NODE_MISMATCH: 'El grupo o subsistema del JSON no coincide con backend/config/nodes.json.',
  INVALID_RECORD: 'El JSON no cumple el contrato. Revisá los campos indicados en la tabla rejections de SQLite.',
  RECORD_CONFLICT: 'Se reutilizó un record_id con datos diferentes. Cada medición nueva necesita un identificador nuevo.',
}

function SerialNotice({ serial }: { serial: SerialStatus }) {
  return <div className={`notice ${serial.last_error && serial.last_error !== 'SERIAL_NO_DEVICE' ? 'error-notice' : ''}`} role="status"><Radio size={20} /><div><strong>ESP32 por USB · {!serial.enabled ? 'Deshabilitado' : serial.connected ? 'Puerto abierto' : 'Esperando conexión'}</strong><span>{serial.port ?? 'Detección automática'} · {serial.accepted} nuevos · {serial.duplicates} duplicados · {serial.rejected} rechazados desde el inicio.</span><span>{serial.last_received_at ? `Último JSON aceptado: ${dateLabel(serial.last_received_at)}` : 'Todavía no se recibió un JSON válido.'}</span>{serial.last_error && <span>{serialErrors[serial.last_error] ?? serial.last_error}</span>}</div></div>
}

export interface SecretPanelProps {
  environment: 'test' | 'operational'
  onEnvironment: (value: 'test' | 'operational') => void
  serial?: SerialStatus
  localMode: boolean
  demo: boolean
  lastSync: string | null
  nodes: NodeInfo[]
  records: RecordRow[]
  mockedNodes: string[]
  mockGroups: MockGroupSettings
  onMockGroup: (groupNumber: number, enabled: boolean) => void
  onRefresh: () => void
  onClose: () => void
}

export function SecretPanel({ environment, onEnvironment, serial, localMode, demo, lastSync, nodes, records, mockedNodes, mockGroups, onMockGroup, onRefresh, onClose }: SecretPanelProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const mode = localMode ? 'Backend local' : demo ? 'Demostración' : 'Supabase'
  return <div className="secret-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="secret-panel" role="dialog" aria-modal="true" aria-labelledby="secret-title">
      <header className="secret-head">
        <div><span className="eyebrow">ACCESO INTERNO</span><h2 id="secret-title">Panel técnico</h2><p className="small muted">Diagnóstico, configuración y datos internos.</p></div>
        <button className="secondary" onClick={onClose} aria-label="Cerrar panel técnico"><X size={18} /> Cerrar</button>
      </header>
      <div className="secret-grid">
        <section className="secret-card">
          <h3><Wifi size={18} /> Estado</h3>
          <dl className="secret-kv">
            <div><dt>Modo</dt><dd>{mode}</dd></div>
            <div><dt>Última consulta</dt><dd>{lastSync ? dateLabel(lastSync) : 'Sin consulta'}</dd></div>
            <div><dt>Nodos</dt><dd>{nodes.length}</dd></div>
            <div><dt>Registros</dt><dd>{records.length}</dd></div>
          </dl>
          <button className="secondary" onClick={onRefresh}><RefreshCw size={16} /> Actualizar ahora</button>
        </section>
        <section className="secret-card">
          <h3><Settings size={18} /> Entorno</h3>
          <label className="secret-field">Entorno de datos
            <select value={environment} onChange={event => onEnvironment(event.target.value as 'test' | 'operational')}>
              <option value="test">Pruebas</option>
              <option value="operational">Operativo</option>
            </select>
          </label>
          <p className="small muted">Cambia la fuente de datos sin salir del panel.</p>
        </section>
        <section className="secret-card secret-card-wide">
          <h3><Database size={18} /> Relleno de datos</h3>
          <p className="small muted">Elegí qué grupos se rellenan cuando no tienen datos recientes.</p>
          <div className="secret-mock-groups">
            {[1, 2, 3, 4, 5].map(group => {
              const node = nodes.find(item => item.group_number === group)
              const active = Boolean(node?.enabled)
              return <label className="secret-check" key={group}>
                <input type="checkbox" disabled={!active} checked={active && mockGroups[group] !== false} onChange={event => onMockGroup(group, event.target.checked)} />
                <span>Grupo {group} · {node ? `${node.subsystem}${node.enabled ? '' : ' · deshabilitado'}` : 'Sin nodo configurado'}</span>
              </label>
            })}
          </div>
          <p className="small muted">Los registros generados se integran al panel como datos normales. No se muestran avisos en la vista principal.</p>
          {mockedNodes.length ? <>
            <p className="small muted">Grupos cubiertos ahora:</p>
            <ul className="secret-list">{mockedNodes.map(id => {
              const node = nodes.find(item => item.node_id === id)
              return <li key={id}>Grupo {node?.group_number ?? '?'} · {node?.subsystem ?? id}</li>
            })}</ul>
          </> : <p className="small muted">Todos los grupos tienen datos vigentes.</p>}
        </section>
        {localMode && <section className="secret-card secret-card-wide">
          <h3><Radio size={18} /> Diagnóstico USB</h3>
          {serial ? <><SerialNotice serial={serial} /><SerialDebugPanel serial={serial} /></> : <p className="small muted">Sin información del puerto USB.</p>}
        </section>}
        {localMode ? <section className="secret-card secret-card-wide">
          <h3><Activity size={18} /> Equipos y endpoints</h3>
          <BridgeSettings />
        </section> : <section className="secret-card secret-card-wide">
          <h3><ShieldCheck size={18} /> Configuración</h3>
          <p className="small muted">La configuración de equipos y endpoints está disponible con el backend local.</p>
        </section>}
      </div>
      <footer className="secret-foot"><span className="small muted">Acceso reservado · Ctrl+Alt+Shift+D</span><span className="small muted">Escape para cerrar</span></footer>
    </section>
  </div>
}

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Activity, ArrowDownToLine, ArrowUpRight, Bell, CheckCircle2, Database, Droplets, Flame, LayoutDashboard, LogOut, Mountain, Radio, RefreshCw, Search, TriangleAlert, Wifi, Zap } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { configurationError, supabase } from './lib/supabase'
import { localMode, loadLocalDashboard, requestBridgePoll, type SerialStatus } from './lib/local'
import { NodeMetrics } from './NodeMetrics'
import { SecretPanel } from './SecretPanel'
import { createDemoRecords, demoNodes } from './lib/demo'
import { applyMockFallback, readMockFallback, writeMockFallback } from './lib/mock'
import { currentAlerts, dateLabel, freshness, latestByNode, levelLabels, typeLabels, type NodeInfo, type RecordRow } from './lib/domain'

const icons = [Flame, Mountain, Zap, Droplets, Radio, Activity]
const shortNames = ['Incendios forestales', 'Calidad ambiental', 'Sistema energético', 'Reservas de agua', 'Comunicaciones', 'Centro de monitoreo']
function Badge({ row }: { row: RecordRow }) {
  return <span className={`badge ${row.alert_evaluated ? row.alert_level : 'unknown'}`}><span aria-hidden="true">●</span> {row.alert_evaluated ? levelLabels[row.alert_level] : 'No evaluado'}</span>
}

export function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!supabase)
  const [authError, setAuthError] = useState('')
  const [demo, setDemo] = useState(!supabase)
  useEffect(() => {
    if (!supabase) return
    let active = true
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return
      setSession(data.session); setAuthReady(true)
      if (error) setAuthError('No se pudo recuperar la sesión. Volvé a iniciar sesión.')
    }).catch(() => { if (active) { setAuthReady(true); setAuthError('No se pudo conectar con autenticación.') } })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); setAuthReady(true) })
    return () => { active = false; subscription.unsubscribe() }
  }, [])
  if (!authReady) return <main className="center-page" role="status">Preparando acceso…</main>
  if (configurationError) return <main className="center-page"><h1>Configuración incompleta</h1><p>{configurationError}</p></main>
  if (localMode) return <Dashboard demo={false} session={null} onExitDemo={() => {}} />
  if (!demo && !session) return <Login onDemo={() => setDemo(true)} initialError={authError} />
  return <Dashboard demo={demo} session={session} onExitDemo={() => setDemo(false)} />
}

function Login({ onDemo, initialError }: { onDemo: () => void; initialError: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(initialError)
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const { error } = await supabase!.auth.signInWithPassword({ email, password })
      if (error) setError('No se pudo iniciar sesión. Revisá tus credenciales y la conexión.')
    } catch { setError('No se pudo conectar. Intentá nuevamente.') }
    finally { setBusy(false) }
  }
  return <main className="login-page"><section className="login-intro"><span className="eyebrow">NAVATHON III · GRUPO 6</span><div className="brand large"><Activity /> termio<span className="brand-dot">.</span></div><h1>Información integrada.<br />Decisiones mejor informadas.</h1><p>Centro de monitoreo para Caviahue–Copahue. Un punto de encuentro para los seis subsistemas.</p></section><section className="login-card"><h2>Acceder al centro</h2><p className="muted">Ingresá con la cuenta habilitada por el Grupo 6.</p><form onSubmit={submit}><label>Correo electrónico<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label><label>Contraseña<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>{error && <p role="alert" className="error-text">{error}</p>}<button className="primary" disabled={busy}>{busy ? 'Ingresando…' : 'Iniciar sesión'}<ArrowUpRight size={18} /></button></form><button className="text-button" onClick={onDemo}>Entrar al panel</button><p className="small muted">Sin registro público. La membresía se habilita desde Supabase.</p></section></main>
}

function Dashboard({ demo, session, onExitDemo }: { demo: boolean; session: Session | null; onExitDemo: () => void }) {
  const [fixtures] = useState(() => localMode ? [] : createDemoRecords())
  const [nodes, setNodes] = useState<NodeInfo[]>(demo ? demoNodes : [])
  const [records, setRecords] = useState<RecordRow[]>(demo ? fixtures : [])
  const [snapshots, setSnapshots] = useState<RecordRow[]>(demo ? fixtures : [])
  const [alertRecords, setAlertRecords] = useState<RecordRow[]>(demo ? fixtures : [])
  const [serial, setSerial] = useState<SerialStatus | undefined>()
  const [environment, setEnvironment] = useState<'test' | 'operational'>('test')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lastSync, setLastSync] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('all')
  const [now, setNow] = useState(Date.now())
  const [selected, setSelected] = useState<RecordRow | null>(null)
  const [secretOpen, setSecretOpen] = useState(false)
  const [mockEnabled, setMockEnabled] = useState(() => readMockFallback())
  const [mockedNodes, setMockedNodes] = useState<string[]>([])
  const secretTaps = useRef({ count: 0, at: 0 })
  const path = useLocation().pathname
  const sectionTitle = path === '/nodes' ? 'Nodos del sistema' : path === '/records' ? 'Historial de registros' : path === '/alerts' ? 'Alertas y eventos' : 'Vista general'
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 10000); return () => clearInterval(timer) }, [])
  useEffect(() => { setSelected(null) }, [path, environment])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.altKey && event.shiftKey && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        setSecretOpen(value => !value)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    const hash = window.location.hash.replace('#', '')
    if (hash === 'dev' || hash === 'debug') setSecretOpen(true)
  }, [])
  function secretTap() {
    const timestamp = Date.now()
    const taps = secretTaps.current
    taps.count = timestamp - taps.at < 2000 ? taps.count + 1 : 1
    taps.at = timestamp
    if (taps.count >= 5) { taps.count = 0; setSecretOpen(true) }
  }
  function changeMock(enabled: boolean) {
    setMockEnabled(enabled)
    writeMockFallback(enabled)
    setRefresh(value => value + 1)
  }
  useEffect(() => {
    if (demo) {
      const base = environment === 'test' ? fixtures : []
      const filled = applyMockFallback({ nodes: demoNodes, records: base, snapshots: base, alertRecords: base, environment, now: Date.now(), enabled: mockEnabled })
      setError(''); setLoading(false); setNodes(demoNodes); setRecords(filled.records); setSnapshots(filled.snapshots); setAlertRecords(filled.alertRecords); setMockedNodes(filled.mockNodes); setLastSync(new Date().toISOString())
      const timer = setInterval(() => setRefresh(value => value + 1), 10000)
      return () => clearInterval(timer)
    }
    let stopped = false
    let running = false
    setNodes([]); setRecords([]); setSnapshots([]); setAlertRecords([]); setMockedNodes([]); setLastSync(null)
    async function load() {
      if (running || (!localMode && (!supabase || !session))) return
      running = true; setLoading(true)
      try {
        if (localMode) {
          const data = await loadLocalDashboard(environment)
          const filled = applyMockFallback({ nodes: data.nodes, records: data.records, snapshots: data.snapshots, alertRecords: data.alertRecords, environment, now: Date.now(), enabled: mockEnabled })
          if (!stopped) { setSerial(data.serial); setNodes(data.nodes); setRecords(filled.records); setSnapshots(filled.snapshots); setAlertRecords(filled.alertRecords); setMockedNodes(filled.mockNodes); setError(''); setLastSync(new Date().toISOString()) }
          return
        }
        if (!supabase || !session) return
        const membership = await supabase.from('workspace_members').select('user_id').eq('user_id', session.user.id).maybeSingle()
        if (membership.error) throw new Error('No se pudo verificar tu acceso al workspace.')
        if (!membership.data) throw new Error('Tu cuenta no está habilitada. El Grupo 6 debe agregar tu membresía en Supabase.')
        const results = await Promise.all([
          supabase.from('nodes').select('*').order('group_number'),
          supabase.from('records').select('ingest_sequence,record_id,record_type,node_id,group_number,observed_at,received_at,status,alert_level,environment,source_type,clock_synced,alert_evaluated,data,metadata').eq('environment', environment).order('ingest_sequence', { ascending: false }).limit(200),
          supabase.from('node_latest_records').select('*').eq('environment', environment),
          supabase.from('latest_alert_records').select('*').eq('environment', environment),
        ])
        if (results.some(result => result.error)) throw new Error('No se pudieron obtener los datos. Revisá la conexión y que las migraciones estén aplicadas.')
        if (!stopped) {
          const filled = applyMockFallback({ nodes: results[0].data as NodeInfo[], records: results[1].data as RecordRow[], snapshots: results[2].data as RecordRow[], alertRecords: results[3].data as RecordRow[], environment, now: Date.now(), enabled: mockEnabled })
          setNodes(filled.nodes); setRecords(filled.records); setSnapshots(filled.snapshots); setAlertRecords(filled.alertRecords); setMockedNodes(filled.mockNodes); setError(''); setLastSync(new Date().toISOString())
        }
      } catch (cause) { if (!stopped) setError(cause instanceof Error ? cause.message : 'Error de conexión.') }
      finally { running = false; if (!stopped) setLoading(false) }
    }
    void load()
    const timer = setInterval(() => void load(), 10000)
    return () => { stopped = true; clearInterval(timer) }
  }, [demo, environment, fixtures, mockEnabled, refresh, session])
  const latest = latestByNode(snapshots)
  const alerts = currentAlerts(alertRecords)
  const currentNodes = nodes.filter(node => node.enabled && freshness(node, latest.get(node.node_id), now) === 'Activo')
  const stale = nodes.filter(node => node.enabled && freshness(node, latest.get(node.node_id), now) !== 'Activo')
  const filtered = records.filter(row => (group === 'all' || row.group_number === Number(group)) && `${row.node_id} ${row.record_id} ${row.record_type} ${JSON.stringify(row.data)}`.toLowerCase().includes(query.toLowerCase()))
  const visibleNodes = nodes.filter(node => (group === 'all' || node.group_number === Number(group)) && `${node.node_id} ${node.subsystem}`.toLowerCase().includes(query.toLowerCase()))
  const visibleAlerts = alerts.filter(row => (group === 'all' || row.group_number === Number(group)) && `${row.node_id} ${JSON.stringify(row.data)}`.toLowerCase().includes(query.toLowerCase()))
  const filteredEvents = filtered.filter(row => ['event', 'confirmation'].includes(row.record_type))
  function exportRecords() {
    const link = document.createElement('a')
    const url = URL.createObjectURL(new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' }))
    link.href = url; link.download = `termio-${environment}-registros.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  async function logout() {
    const { error } = await supabase!.auth.signOut()
    if (error) setError('No se pudo cerrar sesión. Intentá nuevamente.')
  }
  return <div className="app-shell"><a href="#main" className="skip-link">Saltar al contenido</a><aside className="sidebar"><NavLink className="brand" to="/"><Activity size={26} /> termio<span className="brand-dot">.</span></NavLink><div className="workspace-label">CENTRO DE MONITOREO</div><nav aria-label="Navegación principal"><NavLink to="/" end><LayoutDashboard size={19} /> Vista general</NavLink><NavLink to="/nodes"><Radio size={19} /> Nodos</NavLink><NavLink to="/records"><Database size={19} /> Registros</NavLink><NavLink to="/alerts"><Bell size={19} /> Alertas <span className="nav-count">{alerts.length}</span></NavLink></nav><div className="sidebar-footer"><span className="project-mark"><Mountain size={23} /> NAVATHON III</span><p>Caviahue–Copahue<br />Neuquén, Argentina</p><div className="user-chip"><span className="avatar">G6</span><div><strong>Grupo 6</strong><span>Monitoreo e integración</span></div></div>{demo ? (supabase && <button className="text-button" onClick={onExitDemo}>Volver al acceso</button>) : !localMode && <button className="text-button" onClick={() => void logout()}><LogOut size={16} /> Cerrar sesión</button>}</div></aside><div className="main-shell"><header className="topbar"><span>Navathon III <span className="separator">/</span> {sectionTitle}</span><div className="topbar-actions"><span className="topbar-status"><span className={`dot ${error || !lastSync ? 'muted-dot' : ''}`} />{demo ? 'Sistema en línea' : error ? 'Sin sincronización' : lastSync ? 'Sistema conectado' : 'Conectando…'}</span>{!demo && !localMode && <button className="text-button" onClick={() => void logout()}><LogOut size={16} /> Salir</button>}{demo && supabase && <button className="text-button" onClick={onExitDemo}>Acceder</button>}</div></header><main id="main"><div className="page-heading"><div><span className="eyebrow">PLATAFORMA CENTRAL · GRUPO 6</span><h1>{sectionTitle}</h1><p className="muted">Todos los subsistemas, en un mismo lugar.</p></div><button className="secondary" onClick={() => { if (localMode) void requestBridgePoll().then(() => setRefresh(value => value + 1)).catch(e => setError(String(e))); else setRefresh(value => value + 1) }} disabled={loading || demo}><RefreshCw size={16} className={loading ? 'spinning' : ''} />{loading ? 'Actualizando…' : 'Actualizar'}</button></div>{error && <div className="notice error-notice" role="alert"><TriangleAlert size={20} /><div><strong>No se pudo actualizar</strong><span>{error} Los datos anteriores, si existen, pueden estar desactualizados.</span></div></div>}<section className="stats-grid" aria-label="Resumen"><Stat label="Nodos con datos vigentes" value={`${currentNodes.length}/${nodes.filter(node => node.enabled).length}`} note="Según antigüedad y estado reportado" icon={<Wifi size={20} />} /><Stat label="Alertas abiertas" value={String(alerts.length)} note="Pendientes o activas" icon={<Bell size={20} />} /><Stat label="Sin datos vigentes" value={String(stale.length)} note="Sin datos, con error o desactualizados" icon={<Radio size={20} />} /><Stat label="Registros recientes" value={String(records.length)} note="Ventana de hasta 200 registros" icon={<Database size={20} />} /></section><section className="content-panel"><div className="panel-toolbar"><div><h2>{path === '/records' ? 'Últimos registros recibidos' : path === '/alerts' ? 'Alertas abiertas' : 'Estado de los subsistemas'}</h2><p className="small muted">{lastSync ? `Última consulta: ${dateLabel(lastSync)} · cada 10 s` : 'Esperando la primera consulta'}</p></div></div><div className="filters"><label className="search-field"><Search size={17} /><span className="sr-only">Buscar nodos o registros</span><input placeholder="Buscar nodo o registro…" value={query} onChange={e => setQuery(e.target.value)} /></label><label><span className="sr-only">Filtrar por grupo</span><select value={group} onChange={e => setGroup(e.target.value)}><option value="all">Todos los grupos</option>{Array.from({ length: 6 }, (_, i) => <option key={i} value={i + 1}>Grupo {i + 1}</option>)}</select></label>{path === '/records' && <button className="secondary" onClick={exportRecords} disabled={!filtered.length}><ArrowDownToLine size={16} /> Exportar JSON</button>}</div><Routes><Route path="/" element={<NodeGrid nodes={visibleNodes} latest={latest} now={now} onSelect={setSelected} />} /><Route path="/nodes" element={<NodeGrid nodes={visibleNodes} latest={latest} now={now} onSelect={setSelected} />} /><Route path="/records" element={<RecordsTable records={filtered} onSelect={setSelected} />} /><Route path="/alerts" element={<><AlertList records={visibleAlerts} onSelect={setSelected} /><div className="subsection"><h3>Eventos y confirmaciones recientes</h3><RecordsTable records={filteredEvents} onSelect={setSelected} /></div></>} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></section>{path === '/' && <section className="integration-note"><div><span className="eyebrow">UN CONTRATO, SEIS SUBSISTEMAS</span><h2>Datos distintos. Un lenguaje común.</h2><p>JSON 1.0.0 · Fechas con zona horaria · Unidades explícitas · Origen trazable</p></div><NavLink to="/records">Explorar registros <ArrowUpRight size={18} /></NavLink></section>}<footer className="page-footer"><span className="secret-tap" onClick={secretTap}>Termio · Navathon III / 2026</span><span>La ausencia de datos no implica ausencia de riesgo.</span></footer></main></div>{selected && <RecordDialog record={selected} close={() => setSelected(null)} />}{secretOpen && <SecretPanel environment={environment} onEnvironment={setEnvironment} serial={serial} localMode={localMode} demo={demo} lastSync={lastSync} nodes={nodes} records={records} mockedNodes={mockedNodes} mockEnabled={mockEnabled} onMockEnabled={changeMock} onRefresh={() => setRefresh(value => value + 1)} onClose={() => setSecretOpen(false)} />}</div>
}

function Stat({ label, value, note, icon }: { label: string; value: string; note: string; icon: React.ReactNode }) {
  return <div className="stat"><div className="stat-top"><span>{label}</span>{icon}</div><strong>{value}</strong><span className="small muted">{note}</span></div>
}
function NodeGrid({ nodes, latest, now, onSelect }: { nodes: NodeInfo[]; latest: Map<string, RecordRow>; now: number; onSelect: (row: RecordRow) => void }) {
  if (!nodes.length) return <Empty title="No hay nodos para mostrar" detail="Revisá los filtros, la conexión o la configuración de nodos del backend." />
  return <div className="node-grid">{nodes.map(node => {
    const row = latest.get(node.node_id)
    const Icon = icons[node.group_number - 1] ?? Activity
    const fresh = freshness(node, row, now)
    return <article className="node-card" key={node.node_id}><div className="node-card-top"><span className="node-icon"><Icon size={22} /></span><span className="small muted">GRUPO {node.group_number}</span></div><h3>{shortNames[node.group_number - 1] ?? node.subsystem}</h3><p className="node-id">{node.node_id}</p><div className="node-state"><span className={fresh === 'Activo' ? 'healthy' : 'muted'}>{fresh === 'Activo' ? <CheckCircle2 size={15} /> : <TriangleAlert size={15} />}{node.enabled ? fresh : 'Deshabilitado'}</span>{row && <Badge row={row} />}</div>{row ? <NodeMetrics row={row} /> : <div className="metrics"><p className="muted">Todavía no se recibieron mediciones con reloj sincronizado.</p></div>}<div className="node-bottom"><span className="small muted">{row ? 'En línea' : 'Esperando datos'}</span><button className="text-button" disabled={!row} onClick={() => row && onSelect(row)}>Ver registro <ArrowUpRight size={16} /></button></div>{row && <span className="timestamp">Medición: {dateLabel(row.observed_at)} · UTC−3</span>}{localMode && node.last_serial_received_at && <span className="timestamp">Recibido por USB: {dateLabel(node.last_serial_received_at)}</span>}</article>
  })}</div>
}
function RecordsTable({ records, onSelect }: { records: RecordRow[]; onSelect: (row: RecordRow) => void }) {
  if (!records.length) return <Empty title="Sin registros en esta vista" detail="Los registros aparecerán cuando una integración envíe información válida. También podés revisar los filtros." />
  return <div className="table-scroll"><table><thead><tr><th>Fecha del dato · UTC−3</th><th>Nodo</th><th>Tipo</th><th>Nivel</th><th><span className="sr-only">Detalle</span></th></tr></thead><tbody>{records.map(row => <tr key={row.record_id}><td>{dateLabel(row.observed_at)}{!row.clock_synced && <span className="error-text small">Reloj no sincronizado</span>}</td><td><strong>{row.node_id}</strong><span className="small muted">Grupo {row.group_number}</span></td><td>{typeLabels[row.record_type]}</td><td><Badge row={row} /></td><td><button className="text-button" aria-label={`Ver registro ${row.record_id}`} onClick={() => onSelect(row)}>Detalle <ArrowUpRight size={16} /></button></td></tr>)}</tbody></table></div>
}
function AlertList({ records, onSelect }: { records: RecordRow[]; onSelect: (row: RecordRow) => void }) {
  if (!records.length) return <Empty title="No hay alertas abiertas registradas" detail="Esto no garantiza ausencia de riesgo. Verificá también la vigencia de los datos y el funcionamiento de los nodos." />
  return <div className="alerts-list">{records.map(row => <article className="alert-card" key={row.record_id}><Bell size={22} /><div><Badge row={row} /><h3>{String(row.data.message)}</h3><p className="small muted">{String(row.data.alert_id)} · {dateLabel(row.observed_at)}</p></div><button className="secondary" onClick={() => onSelect(row)}>Ver detalle</button></article>)}</div>
}
function Empty({ title, detail }: { title: string; detail: string }) { return <div className="empty"><Database size={26} /><h3>{title}</h3><p>{detail}</p></div> }
function RecordDialog({ record, close }: { record: RecordRow; close: () => void }) {
  useEffect(() => {
    const dialog = document.getElementById('record-dialog') as HTMLDialogElement
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return <dialog id="record-dialog" aria-labelledby="record-title" onCancel={close} onClick={e => { if (e.target === e.currentTarget) close() }}><div className="dialog-heading"><div><span className="eyebrow">REGISTRO NORMALIZADO</span><h2 id="record-title">{record.node_id}</h2></div><button className="secondary" autoFocus onClick={close}>Cerrar</button></div><p className="muted">Recibido: {dateLabel(record.received_at)}</p><pre>{JSON.stringify(record, null, 2)}</pre></dialog>
}

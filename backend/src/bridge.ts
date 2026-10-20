import { randomUUID } from 'node:crypto'
import { LocalError, type Store } from './store.ts'
import type { BridgeDevice } from './bridge-config.ts'
import { Indicators } from './indicators.ts'
import type { SourceConfig } from './config.ts'
type Kind = 'status' | 'records' | 'alerts'
interface Job { id: string; device: BridgeDevice; kind: Kind; key: string; persisted: boolean; payload?: unknown; more: boolean; error: string | null; finish: (ok: boolean) => void }
export class BridgeController {
  current: Job | undefined
  private store: Store
  private send: (line: string) => boolean
  private timer: ReturnType<typeof setTimeout> | undefined
  private timeout: ReturnType<typeof setTimeout> | undefined
  private configTimer: ReturnType<typeof setTimeout> | undefined
  private configJob: { id: string; revision: number; run: boolean } | undefined
  private heartbeat: ReturnType<typeof setInterval>
  private indicators: Indicators
  private ledCapable = false
  private lastResponse = Date.now()
  private appliedRevision = -1
  private stopped = false
  private queued = false
  constructor(store: Store, send: (line: string) => boolean) { this.store = store; this.send = send; this.indicators = new Indicators(store); store.requestBridgePoll = () => this.request(); store.notifyBridgeConfig = () => { if (!this.current && !this.store.bridgeStatus.busy) this.configure(false) }; this.heartbeat = setInterval(() => { if (!this.stopped && store.bridgeStatus.ready && !this.current && !store.centralStatus.busy && Date.now()-this.lastResponse>20000) { this.disconnected();store.bridgeStatus.last_error='ESP32_SILENT' } if (!this.stopped && !store.bridgeStatus.ready) this.hello(); else if (!this.stopped && !this.current && !store.centralStatus.busy) this.sendIndicators() },3000) }
  private sendIndicators() {
    if (!this.ledCapable || !this.store.bridgeStatus.ready) return
    const groups=this.store.bridgeStatus.configured ? this.indicators.values() : [false,false,false,false,false]
    this.store.ledStatus.requested=groups
    this.send('TERMIO_CMD '+JSON.stringify({op:'leds',groups})+'\n')
  }
  disconnected() {
    this.indicators.clear(); this.ledCapable=false
    this.store.ledStatus.requested=[false,false,false,false,false]
    this.store.ledStatus.acknowledged=null
    this.store.bridgeStatus.ready = false; this.store.bridgeStatus.configured = false; this.appliedRevision = -1
    this.current?.finish(false); this.configJob = undefined
    if (this.timer) clearTimeout(this.timer)
    if (this.configTimer) clearTimeout(this.configTimer)
  }
  hello() { this.send('TERMIO_CMD ' + JSON.stringify({ op: 'hello' }) + '\n') }
  packet(text: string) {
    let p: Record<string, unknown>
    try { p = JSON.parse(text); if (!p || typeof p !== 'object') return } catch { return }
    this.lastResponse=Date.now()
    if(p.event==='boot' || p.event==='diagnostic') {
      const event:Record<string,string|number>={at:new Date().toISOString(),event:String(p.event)}
      for(const key of ['name','boot_id','reset_reason','previous_stage','firmware','detail','uptime_ms','heap','stack_free'])if(typeof p[key]==='number' || typeof p[key]==='string')event[key]=typeof p[key]==='string'?(p[key] as string).slice(0,120):p[key] as number
      this.store.diagnosticStatus.events.push(event);this.store.diagnosticStatus.events=this.store.diagnosticStatus.events.slice(-100)
      if(p.event==='boot' && event.boot_id!==this.store.diagnosticStatus.last_boot?.boot_id){this.store.diagnosticStatus.last_boot=event;this.disconnected();this.store.bridgeStatus.network=null;this.store.bridgeStatus.last_error='ESP32_RESTARTED';this.hello()}
    }
    if (p.event === 'leds' && Array.isArray(p.groups) && p.groups.length===5 && p.groups.every(v=>typeof v==='boolean')) {
      this.store.ledStatus.acknowledged=p.groups; this.store.ledStatus.last_ack_at=new Date().toISOString()
    }
    if (p.event === 'network') {
      const keys = ['uptime_s','heap','min_heap','clients','channel','dhcp_offers','dhcp_acks','dhcp_naks','dhcp_errors','reset_reason'] as const
      if (keys.every(k => Number.isSafeInteger(p[k]) && (p[k] as number) >= 0)) {
        const previous=this.store.bridgeStatus.network
        if(previous && (p.uptime_s as number)+2<previous.uptime_s){this.disconnected();this.store.bridgeStatus.last_error='ESP32_RESTARTED';this.hello()}
        this.store.bridgeStatus.network = Object.fromEntries(keys.map(k => [k,p[k]])) as NonNullable<Store['bridgeStatus']['network']>
        this.store.diagnosticStatus.telemetry_at=new Date().toISOString()
      }
    }
    if (p.event === 'ready' && p.protocol === 1) {
      this.ledCapable=p.led_protocol===1
      this.store.bridgeStatus.ready = true
      if (!this.current && !this.configJob) this.configure(false)
    }
    if (p.event === 'configured' && p.request_id === this.configJob?.id) {
      const job = this.configJob!; this.configJob = undefined
      if (this.configTimer) clearTimeout(this.configTimer)
      if (p.ok !== true) { this.store.bridgeStatus.last_error = 'NETWORK_CONFIG_FAILED'; return }
      this.appliedRevision = job.revision; this.store.bridgeStatus.configured = true
      if (job.revision !== this.store.bridgeRevision) this.configure(job.run)
      else if (job.run || !this.store.getBridgeConfig().paused) this.request()
    }
    if (p.event === 'done' && p.request_id === this.current?.id) {
      const job = this.current!
      const ok = p.ok === true && job.persisted && !job.error
      if (!ok) this.store.bridgeStatus.last_error = job.error || (typeof p.error === 'string' ? p.error.slice(0,100) : 'NO_VALID_JSON')
      job.finish(ok)
    }
  }
  private configure(run: boolean) {
    if (this.stopped || !this.store.bridgeStatus.ready) return
    if (this.configJob) { this.configJob.run ||= run; return }
    if (this.timer) clearTimeout(this.timer)
    const config = this.store.getBridgeConfig()
    const reservations = [...new Map(config.devices.filter(d => d.ip).map(d => [d.mac,{mac:d.mac,ip:d.ip}])).values()].sort((a,b) => a.mac.localeCompare(b.mac))
    const id = randomUUID(); this.configJob = { id, revision: this.store.bridgeRevision, run }
    this.store.bridgeStatus.configured = false; this.store.bridgeStatus.last_error = null
    this.configTimer = setTimeout(() => { this.configJob = undefined; this.store.bridgeStatus.last_error = 'ESP32_CONFIG_TIMEOUT'; this.store.bridgeStatus.configured = false },15000)
    if (!this.send('TERMIO_CMD '+JSON.stringify({op:'configure',request_id:id,channel:config.channel,reservations})+'\n')) {
      clearTimeout(this.configTimer); this.configJob=undefined;this.store.bridgeStatus.last_error='SERIAL_WRITE_FAILED'
    }
  }
  context(): { source?: SourceConfig; checkpointKey?: string } {
    const job = this.current
    if (!job) return {}
    return { source: { node_id: job.device.node_id, enabled: true, base_url: '', environment: job.device.environment, token_env: 'UNUSED', ingest_token_env: 'UNUSED', poll_interval_ms: 10000, timeout_ms: 5000, paths: { status: '/', records: '/', alerts: '/' } }, checkpointKey: job.kind !== 'status' ? job.key : undefined }
  }
  ingested(payload: unknown) { if (this.current) { this.current.persisted = true; this.current.payload = payload; this.current.more = !!(payload && typeof payload === 'object' && 'has_more' in payload && payload.has_more) } }
  rejected(code: string) { if (this.current) this.current.error = code }
  request() {
    if (this.stopped || !this.store.bridgeStatus.ready) throw new LocalError(503,'SERIAL_BRIDGE_NOT_READY')
    if (this.store.bridgeStatus.busy) { this.queued=true;return {queued:true,busy:true} }
    if (this.appliedRevision !== this.store.bridgeRevision || !this.store.bridgeStatus.configured) { this.configure(true);return {queued:true,busy:false} }
    if (this.timer) clearTimeout(this.timer)
    void this.cycle();return {queued:true,busy:false}
  }
  private async cycle() {
    const status = this.store.bridgeStatus
    if (this.stopped || !status.ready || status.busy || !status.configured) return
    status.busy=true;status.last_error=null
    const revision=this.store.bridgeRevision,config=this.store.getBridgeConfig()
    try {
      for (const device of config.devices.filter(d=>d.enabled)) for (const kind of ['status','records','alerts'] as const) {
        if (!device.endpoints[kind]) continue
        for (let page=0;page<5;page++) {
          if (this.stopped || !status.ready || revision!==this.store.bridgeRevision) return
          while (this.store.centralStatus.busy && !this.stopped && status.ready) await new Promise(resolve => setTimeout(resolve,20))
          if (this.stopped || !status.ready || revision!==this.store.bridgeRevision) return
          const result=await this.get(device,kind)
          if (!result.ok || !result.more) break
        }
      }
    } catch {status.last_error='BRIDGE_CYCLE_ERROR'}
    finally {
      status.busy=false;status.current=null;status.last_cycle_at=new Date().toISOString()
      if (!this.stopped && status.ready) {
        const queued=this.queued;this.queued=false
        if (revision!==this.store.bridgeRevision) this.configure(queued)
        else if (queued || !config.paused) this.timer=setTimeout(()=>{void this.cycle()},queued?100:config.interval_ms)
      }
    }
  }
  private get(device: BridgeDevice,kind: Kind): Promise<{ok:boolean;more:boolean}> {
    const path=device.endpoints[kind]
    const key=`bridge:${device.id}:${device.mac}:${device.port}:${device.environment}:${kind}:${path}`
    let route=path
    if(kind!=='status'){const cursor=this.store.cursor(key);route+='?limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):'')}
    if(route.length>700){this.store.bridgeStatus.last_error='CURSOR_TOO_LONG';return Promise.resolve({ok:false,more:false})}
    this.store.bridgeStatus.current=`${device.name} · GET ${path}`
    return new Promise(resolve=>{
      const id=randomUUID()
      const finish=(ok:boolean)=>{if(this.current?.id!==id)return;const more=this.current.more;if(kind==='status')this.indicators.result(device,this.current.payload,ok);if(this.timeout)clearTimeout(this.timeout);this.current=undefined;this.sendIndicators();resolve({ok,more})}
      this.current={id,device,kind,key,persisted:false,more:false,error:null,finish}
      this.timeout=setTimeout(()=>{this.disconnected();this.store.bridgeStatus.last_error='ESP32_COMMAND_TIMEOUT';this.hello()},30000)
      if(!this.send('TERMIO_CMD '+JSON.stringify({op:'get',request_id:id,device_id:device.id,name:device.name,mac:device.mac,port:device.port,path:route})+'\n')){this.store.bridgeStatus.last_error='SERIAL_WRITE_FAILED';finish(false)}
    })
  }
  stop(){this.stopped=true;clearInterval(this.heartbeat);this.disconnected();this.store.requestBridgePoll=undefined;this.store.notifyBridgeConfig=undefined}
}

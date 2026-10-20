import type { Store } from './store.ts'

export const publicGroups = { incendios:'fire_node_01', volcanico:'volcanic_node_01', energia:'energy_node_01', inundaciones:'water_node_01', comunicaciones:'alert_node_01' } as const
export const MAX_PUBLIC_BYTES = 32768
export interface PublicResponse { status: number; body: unknown; headers: Record<string,string> }
const baseHeaders = { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'X-Termio-Source':'sqlite' }
const error = (status:number,code:string):PublicResponse => ({status,body:{error:code},headers:{...baseHeaders}})
interface Stored { ingest_sequence:number; canonical_payload:string; received_at:string }
export function centralAPI(store:Store,target:string,method='GET'):PublicResponse {
  if(method!=='GET')return {...error(405,'METHOD_NOT_ALLOWED'),headers:{...baseHeaders,Allow:'GET'}}
  if(target.length>1200 || !target.startsWith('/') || target.startsWith('//') || /[\x00-\x20\x7f]/.test(target) || /%(?:00|0a|0d)/i.test(target))return error(400,'INVALID_TARGET')
  let url:URL
  try{url=new URL(target,'http://termio.local')}catch{return error(400,'INVALID_TARGET')}
  const path=url.pathname.replace(/^\/v1\//,'/api/v1/')
  for(const key of url.searchParams.keys())if(!['environment','limit','cursor'].includes(key) || url.searchParams.getAll(key).length!==1)return error(400,'INVALID_QUERY')
  const environment=url.searchParams.get('environment')??'test'
  if(!['test','operational'].includes(environment))return error(400,'INVALID_ENVIRONMENT')
  if(path==='/api/v1/health')return {status:200,body:{status:'ok',service:'termio-central',schema_version:'1.0.0',storage:'sqlite',read_only:true},headers:{...baseHeaders}}
  if(path==='/api/v1/nodes')return {status:200,body:{items:Object.entries(publicGroups).map(([slug,id])=>{
    const n=store.nodes.find(n=>n.node_id===id)!
    return {node_id:n.node_id,group:n.group_number,subsystem:n.subsystem,expected_interval_seconds:n.expected_interval_seconds,variable_units:n.variable_units,endpoints:Object.fromEntries(['latest','status','records','alerts'].map(k=>[k,`/api/v1/${slug}/${k}`]))}
  }),next_cursor:null,has_more:false},headers:{...baseHeaders}}
  const match=/^\/api\/v1\/(incendios|volcanico|energia|inundaciones|comunicaciones)\/(latest|status|records|alerts)$/.exec(path)
  const global=path==='/api/v1/records'
  if(!match && !global)return error(404,'NOT_FOUND')
  const node=match?publicGroups[match[1] as keyof typeof publicGroups]:null
  const kind=match?.[2]??'records'
  if(kind==='status' || kind==='latest') {
    if(url.searchParams.has('cursor') || url.searchParams.has('limit'))return error(400,'INVALID_QUERY')
    const types=kind==='status'?"record_type='state'":"record_type IN ('reading','state')"
    const row=store.db.prepare(`SELECT ingest_sequence,canonical_payload,received_at FROM records WHERE node_id=? AND environment=? AND ${types} AND json_extract(payload,'$.metadata.clock_synced')=1 ORDER BY observed_ms DESC,ingest_sequence DESC LIMIT 1`).get(node!,environment) as Stored|undefined
    if(!row)return error(404,kind==='status'?'NO_SYNCHRONIZED_STATE':'NO_SYNCHRONIZED_READING_OR_STATE')
    const body=JSON.parse(row.canonical_payload)
    const bytes=Buffer.byteLength(JSON.stringify(body));if(bytes>MAX_PUBLIC_BYTES)return error(413,'RECORD_TOO_LARGE_FOR_GATEWAY')
    const interval=store.nodes.find(n=>n.node_id===node)!.expected_interval_seconds
    const age=Math.max(0,Math.floor((Date.now()-Date.parse(body.timestamp))/1000))
    const receipt=store.db.prepare('SELECT last_received_at FROM serial_receipts WHERE node_id=? AND environment=?').get(node!,environment) as {last_received_at:string}|undefined
    return {status:200,body,headers:{...baseHeaders,'X-Termio-Received-At':row.received_at,'X-Termio-Data-Age-Seconds':String(age),'X-Termio-Stale':String(age>interval*3),'X-Termio-Clock-Synced':'true','X-Termio-Connection':!receipt?'unknown':Date.now()-Date.parse(receipt.last_received_at)<=interval*3000?'online':'offline'}}
  }
  const limitText=url.searchParams.get('limit')??'100'
  if(!/^\d{1,3}$/.test(limitText))return error(400,'INVALID_LIMIT')
  const limit=Number(limitText);if(limit<1 || limit>100)return error(400,'INVALID_LIMIT')
  const scope=`central:${node??'all'}:${kind}:${environment}`
  let after=0
  const cursor=url.searchParams.get('cursor')
  if(cursor!==null){
    try{
      if(!/^[A-Za-z0-9_-]{1,512}$/.test(cursor))return error(400,'INVALID_CURSOR')
      const decoded=Buffer.from(cursor,'base64url').toString('utf8'),p=JSON.parse(decoded)
      if(p.scope!==scope || !Number.isSafeInteger(p.after) || p.after<0 || Buffer.from(decoded).toString('base64url')!==cursor)return error(400,'INVALID_CURSOR')
      after=p.after
    }catch{return error(400,'INVALID_CURSOR')}
  }
  const params:(string|number)[]=[environment,after];let filter=''
  if(node){filter+=' AND node_id=?';params.push(node)}
  if(kind==='alerts')filter+=" AND record_type='alert'"
  params.push(limit+1)
  const rows=store.db.prepare(`SELECT ingest_sequence,canonical_payload,received_at FROM records WHERE environment=? AND ingest_sequence>?${filter} ORDER BY ingest_sequence LIMIT ?`).all(...params) as unknown as Stored[]
  const items:unknown[]=[];let last=after
  for(const row of rows.slice(0,limit)){
    const item=JSON.parse(row.canonical_payload),nextItems=[...items,item]
    const testBody={items:nextItems,next_cursor:Buffer.from(JSON.stringify({scope,after:row.ingest_sequence})).toString('base64url'),has_more:true}
    if(Buffer.byteLength(JSON.stringify(testBody))>MAX_PUBLIC_BYTES){if(!items.length)return error(413,'RECORD_TOO_LARGE_FOR_GATEWAY');break}
    items.push(item);last=row.ingest_sequence
  }
  return {status:200,body:{items,next_cursor:items.length?Buffer.from(JSON.stringify({scope,after:last})).toString('base64url'):null,has_more:rows.length>items.length},headers:{...baseHeaders}}
}

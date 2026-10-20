import { it,expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { Store } from '../backend/src/store.ts'
import { configSchema,nodeSchema } from '../backend/src/config.ts'
import { centralAPI,MAX_PUBLIC_BYTES } from '../backend/src/central-api.ts'
import { GatewayController } from '../backend/src/gateway.ts'
import { createLocalServer } from '../backend/src/server.ts'
const nodes=JSON.parse(readFileSync('backend/config/nodes.json','utf8')).map((n:unknown)=>nodeSchema.parse(n))
const config=configSchema.parse(JSON.parse(readFileSync('backend/config/groups.json','utf8')))
const fixture=(name='volcanic')=>({...JSON.parse(readFileSync(`tests/fixtures/${name}-api.json`,'utf8')),record_id:randomUUID(),timestamp:new Date().toISOString()})
async function withStore(run:(s:Store)=>unknown){const s=new Store(':memory:',nodes,config.group5_delivery);try{await run(s)}finally{s.close()}}
const value=(s:Store,path:string)=>centralAPI(s,path).body as any
it('central conserva el JSON original, unidades ADC, identidad y procedencia',()=>withStore(s=>{
 const r=fixture();s.ingestSerial([r]);const response=centralAPI(s,'/api/v1/volcanico/latest')
 expect(response.status).toBe(200);expect(response.body).toEqual(r);expect(response.headers['X-Termio-Source']).toBe('sqlite');expect(response.headers['X-Termio-Connection']).toBe('online');expect(response.headers['X-Termio-Stale']).toBe('false')
 expect(value(s,'/v1/volcanico/latest')).toEqual(r)
 expect(value(s,'/api/v1/energia/records')).toEqual({items:[],next_cursor:null,has_more:false})
}))
it('status exige state; latest ordena por fecha de medicion y no por llegada',()=>withStore(s=>{
 const r=fixture();s.ingest(r);expect(centralAPI(s,'/v1/volcanico/status').status).toBe(404)
 const state={...r,record_id:randomUUID(),record_type:'state',timestamp:new Date(Date.now()-120000).toISOString()};s.ingest(state)
 expect(value(s,'/v1/volcanico/status')).toEqual(state);expect(value(s,'/v1/volcanico/latest')).toEqual(r)
 const unsynced={...r,record_id:randomUUID(),timestamp:new Date(Date.now()+1000).toISOString(),metadata:{...r.metadata,clock_synced:false}};s.ingest(unsynced)
 expect(value(s,'/v1/volcanico/latest')).toEqual(r)
 expect(centralAPI(s,'/v1/volcanico/status').headers['X-Termio-Stale']).toBe('true')
 expect(value(s,'/v1/volcanico/records').items).toHaveLength(3)
}))
it('paginacion estable, cursores aislados por grupo/tipo/entorno y sin duplicados',()=>withStore(s=>{
 const records=[fixture(),fixture(),fixture()];records.forEach(r=>s.ingest(r));s.ingest(fixture('energy'))
 const a=value(s,'/v1/volcanico/records?limit=2');expect(a.items).toEqual(records.slice(0,2));expect(a.has_more).toBe(true)
 const b=value(s,`/v1/volcanico/records?limit=2&cursor=${a.next_cursor}`);expect(b.items).toEqual(records.slice(2));expect(b.has_more).toBe(false)
 expect(value(s,`/v1/volcanico/records?cursor=${b.next_cursor}`).items).toHaveLength(0)
 for(const route of ['energia/records','volcanico/alerts','volcanico/records?environment=operational'])expect(centralAPI(s,`/v1/${route}${route.includes('?')?'&':'?'}cursor=${a.next_cursor}`).status).toBe(400)
 expect(value(s,'/v1/records').items).toHaveLength(4)
}))
it('API publica no expone configuracion y rechaza consultas/metodos invalidos',()=>withStore(s=>{
 for(const path of ['/api/v1/bridge/config','/api/v1/dashboard','/api/v1/central/diagnostics'])expect(centralAPI(s,path).status).toBe(404)
 expect(centralAPI(s,'/v1/energia/latest','POST').status).toBe(405)
 for(const path of ['/v1/energia/records?limit=0','/v1/energia/records?limit=101','/v1/energia/records?limit=1&limit=2','/v1/energia/latest?token=secret','//external/v1/health','/v1/health%0d%0a'])expect(centralAPI(s,path).status).toBe(400)
 const catalog=JSON.stringify(value(s,'/v1/nodes'));expect(catalog).not.toContain('mac');expect(value(s,'/v1/nodes').items).toHaveLength(5)
}))
it('limite de respuesta reduce paginas sin perder registros y rechaza individuales enormes',()=>withStore(s=>{
 for(let i=0;i<5;i++){const r=fixture();r.metadata.extensions={note:'x'.repeat(9000)};s.ingest(r)}
 const a=value(s,'/v1/volcanico/records');expect(a.items.length).toBeGreaterThan(0);expect(a.items.length).toBeLessThan(5);expect(a.has_more).toBe(true);expect(Buffer.byteLength(JSON.stringify(a))).toBeLessThanOrEqual(MAX_PUBLIC_BYTES)
 const huge=fixture('energy');huge.metadata.extensions={note:'x'.repeat(40000)};s.ingest(huge);expect(centralAPI(s,'/v1/energia/latest').status).toBe(413)
}))
it('USB envia fragmentos confirmados, UTF8 intacto, e ignora ACK fuera de secuencia',()=>withStore(s=>{
 const r=fixture();s.ingest(r);const commands:any[]=[];const gateway=new GatewayController(s,line=>{commands.push(JSON.parse(line.slice(11)));return true})
 try{
 gateway.packet({event:'api_request',request_id:'api-test',path:'/v1/volcanico/latest',method:'GET'})
 const begin=commands.shift();expect(begin.op).toBe('api_begin');expect(begin.status).toBe(200);expect(s.centralStatus.busy).toBe(true)
 gateway.packet({event:'api_ack',request_id:'wrong',seq:-1});gateway.packet({event:'api_ack',request_id:'api-test',seq:10});expect(commands).toHaveLength(0)
 gateway.packet({event:'api_ack',request_id:'api-test',seq:-1});const chunks:Buffer[]=[]
 while(commands.length){const c=commands.shift();if(c.op==='api_end'){gateway.packet({event:'api_done',request_id:'api-test',ok:true});break}expect(c.op).toBe('api_chunk');const bytes=Buffer.from(c.data,'base64');expect(bytes.length).toBeLessThanOrEqual(512);chunks.push(bytes);gateway.packet({event:'api_ack',request_id:'api-test',seq:c.seq})}
 expect(Buffer.concat(chunks).length).toBe(begin.length);expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual(r);expect(s.centralStatus.completed).toBe(1);expect(s.centralStatus.busy).toBe(false)
 }finally{gateway.stop()}
}))
it('abort o desconexion liberan el USB sin alterar datos',()=>withStore(s=>{
 const gateway=new GatewayController(s,()=>true)
 gateway.packet({event:'api_request',request_id:'abort',path:'/v1/health',method:'GET'});gateway.packet({event:'api_abort',request_id:'abort'})
 expect(s.centralStatus.failed).toBe(1);expect(s.centralStatus.busy).toBe(false)
 gateway.packet({event:'api_request',request_id:'disconnect',path:'/v1/health',method:'GET'});gateway.stop();expect(s.centralStatus.failed).toBe(2);expect(s.rows('test')).toHaveLength(0)
}))
it('rutas centrales disponibles por HTTP local y configuracion permanece local',()=>withStore(async s=>{
 const r=fixture('energy');s.ingest(r);const server=createLocalServer(s,config)
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as {port:number}).port
 try{const response=await fetch(`http://127.0.0.1:${port}/api/v1/energia/latest`);expect(response.status).toBe(200);expect(await response.json()).toEqual(r);expect((await fetch(`http://127.0.0.1:${port}/v1/health`)).status).toBe(200)}finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
}))

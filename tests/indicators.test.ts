import { it,expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { Store } from '../backend/src/store.ts'
import { Indicators } from '../backend/src/indicators.ts'
import { BridgeController } from '../backend/src/bridge.ts'
import { acceptSerialPayload } from '../backend/src/serial.ts'
import { configSchema,nodeSchema } from '../backend/src/config.ts'
const nodes=JSON.parse(readFileSync('backend/config/nodes.json','utf8')).map((n:unknown)=>nodeSchema.parse(n))
const cfg=configSchema.parse(JSON.parse(readFileSync('backend/config/groups.json','utf8')))
function setup(){const s=new Store(':memory:',nodes,cfg.group5_delivery);const c=s.getBridgeConfig();c.devices=c.devices.slice(0,1);c.devices[0].environment='operational';s.setBridgeConfig(c);return s}
const reading=()=>({schema_version:'1.0.0',record_id:randomUUID(),record_type:'reading',node_id:'fire_node_01',group:1,subsystem:nodes[0].subsystem,timestamp:new Date().toISOString(),status:'active',alert_level:'low',data:{temperature:23.8},metadata:{environment:'operational',source_type:'real',alert_evaluated:true,clock_synced:true,units:{temperature:'degC'},quality:{temperature:'valid'}}})
it('LED solo con respuesta correcta real operativa; no por simulacion, fallos o historial anterior',()=>{
 const s=setup(),i=new Indicators(s),d=s.getBridgeConfig().devices[0];try{
 expect(i.values()).toEqual([false,false,false,false,false]);i.result(d,reading(),true);expect(i.values()).toEqual([true,false,false,false,false]);i.result(d,reading(),false);expect(i.values()[0]).toBe(false)
 for(const patch of [{source_type:'simulated'},{source_type:'mixed'},{environment:'test'},{clock_synced:false}]){const r=reading();Object.assign(r.metadata,patch);i.result(d,r,true);expect(i.values()[0]).toBe(false)}
 const old=reading();old.timestamp=new Date(Date.now()-3600000).toISOString();i.result(d,old,true);expect(i.values()[0]).toBe(false)
 const error={...reading(),status:'error'};i.result(d,error,true);expect(i.values()[0]).toBe(false)
 }finally{s.close()}
})
it('expira la comunicacion y cambiar/desactivar equipo invalida el indicador',()=>{
 const s=setup(),i=new Indicators(s),d=s.getBridgeConfig().devices[0];try{
 const now=Date.now();i.result(d,reading(),true,now);expect(i.values(now)[0]).toBe(true);expect(i.values(now+3600000)[0]).toBe(false)
 const c=s.getBridgeConfig();c.devices[0].port=8082;s.setBridgeConfig(c);expect(i.values()[0]).toBe(false)
 i.result(c.devices[0],reading(),true);expect(i.values()[0]).toBe(true);c.devices[0].enabled=false;s.setBridgeConfig(c);expect(i.values()[0]).toBe(false);i.clear();expect(i.values().some(Boolean)).toBe(false)
 }finally{s.close()}
})
it('USB enciende solo despues de persistir y recibir done exitoso, falla siguiente apaga',async()=>{
 const s=setup(),sent:any[]=[];const c=s.getBridgeConfig();c.paused=true;s.setBridgeConfig(c)
 const bridge=new BridgeController(s,line=>{sent.push(JSON.parse(line.slice(11)));return true})
 try{
 bridge.packet(JSON.stringify({event:'ready',protocol:1,led_protocol:1}));const conf=sent.find(c=>c.op==='configure');bridge.packet(JSON.stringify({event:'configured',request_id:conf.request_id,ok:true}));bridge.request()
 const get=sent.find(c=>c.op==='get');const r=reading();acceptSerialPayload(s,r,bridge.context().source);bridge.ingested(r);expect(s.ledStatus.requested[0]).toBe(false)
 bridge.packet(JSON.stringify({event:'done',request_id:get.request_id,ok:true}));expect(sent.at(-1)).toEqual({op:'leds',groups:[true,false,false,false,false]});expect(s.rows('operational')).toHaveLength(1)
 bridge.packet(JSON.stringify({event:'leds',groups:[true,false,false,false,false]}));expect(s.ledStatus.acknowledged?.[0]).toBe(true)
 await Promise.resolve();bridge.request();const next=sent.filter(c=>c.op==='get').at(-1);bridge.packet(JSON.stringify({event:'done',request_id:next.request_id,ok:false,error:'HTTP_CONNECTION_FAILED'}));expect(s.ledStatus.requested[0]).toBe(false)
 }finally{bridge.stop();await Promise.resolve();s.close()}
})

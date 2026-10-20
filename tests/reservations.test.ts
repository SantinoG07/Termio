import { it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { Store } from '../backend/src/store.ts'
import { BridgeController } from '../backend/src/bridge.ts'
import { configSchema,nodeSchema } from '../backend/src/config.ts'
const nodes=JSON.parse(readFileSync('backend/config/nodes.json','utf8')).map((n:unknown)=>nodeSchema.parse(n))
const config=configSchema.parse(JSON.parse(readFileSync('backend/config/groups.json','utf8')))
const store=()=>new Store(':memory:',nodes,config.group5_delivery)
it('valida reservas .2-.99, IP repetida y una sola IP por MAC',()=>{
 const s=store();try{
 const c=s.getBridgeConfig();c.devices[0].ip='192.168.4.12';s.setBridgeConfig(c);expect(s.getBridgeConfig().devices[0].ip).toBe('192.168.4.12')
 for(const ip of ['192.168.4.1','192.168.4.0','192.168.4.100','192.168.4.255','192.168.5.12','999.168.4.12'])expect(()=>s.setBridgeConfig({...c,devices:[{...c.devices[0],ip}]})).toThrow()
 expect(()=>s.setBridgeConfig({...c,devices:[c.devices[0],{...c.devices[1],ip:'192.168.4.12'}]})).toThrow()
 expect(()=>s.setBridgeConfig({...c,devices:[c.devices[0],{...c.devices[1],mac:c.devices[0].mac,ip:'192.168.4.13'}]})).toThrow()
 }finally{s.close()}
})
it('no ejecuta GET antes de confirmar reservas, aplica pausa y permite consulta manual',async()=>{
 const s=store();const c=s.getBridgeConfig();c.paused=true;c.devices=[c.devices[0]];c.devices[0].ip='192.168.4.12';s.setBridgeConfig(c)
 const sent:Record<string,any>[]=[];const bridge=new BridgeController(s,line=>{sent.push(JSON.parse(line.slice(11)));return true})
 try{
 bridge.packet(JSON.stringify({event:'ready',protocol:1}));expect(sent).toHaveLength(1);expect(sent[0].op).toBe('configure');expect(sent[0].reservations).toEqual([{mac:c.devices[0].mac,ip:'192.168.4.12'}]);expect(s.bridgeStatus.configured).toBe(false)
 bridge.packet(JSON.stringify({event:'configured',request_id:'wrong',ok:true}));expect(s.bridgeStatus.configured).toBe(false)
 bridge.packet(JSON.stringify({event:'configured',request_id:sent[0].request_id,ok:true}));expect(s.bridgeStatus.configured).toBe(true);expect(sent).toHaveLength(1)
 bridge.request();expect(sent[1].op).toBe('get')
 }finally{bridge.stop();await Promise.resolve();s.close()}
})
it('no declara aplicadas reservas que rechaza el firmware',()=>{
 const s=store();const sent:Record<string,any>[]=[];const b=new BridgeController(s,line=>{sent.push(JSON.parse(line.slice(11)));return true})
 try{b.packet(JSON.stringify({event:'ready',protocol:1}));b.packet(JSON.stringify({event:'configured',request_id:sent[0].request_id,ok:false}));expect(s.bridgeStatus.configured).toBe(false);expect(s.bridgeStatus.last_error).toBe('NETWORK_CONFIG_FAILED');expect(sent).toHaveLength(1)}finally{b.stop();s.close()}
})

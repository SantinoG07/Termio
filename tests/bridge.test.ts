import { it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { Store } from '../backend/src/store.ts'
import { BridgeController } from '../backend/src/bridge.ts'
import { acceptSerialPayload } from '../backend/src/serial.ts'
import { configSchema, nodeSchema } from '../backend/src/config.ts'
const nodes = JSON.parse(readFileSync('backend/config/nodes.json', 'utf8')).map((n: unknown) => nodeSchema.parse(n))
const cfg = configSchema.parse(JSON.parse(readFileSync('backend/config/groups.json', 'utf8')))
const setup = () => new Store(':memory:', nodes, cfg.group5_delivery)
const reading = () => ({ schema_version: '1.0.0', record_id: randomUUID(), record_type: 'reading', node_id: nodes[0].node_id, group: 1, subsystem: nodes[0].subsystem, timestamp: new Date().toISOString(), status: 'active', alert_level: 'low', data: { temperature: 29.7 }, metadata: { environment: 'test', source_type: 'simulated', alert_evaluated: true, clock_synced: true, units: { temperature: 'degC' }, quality: { temperature: 'valid' } } })
it('valida y persiste configuración, rechaza MAC, URL e identidad inválidas', () => {
 const s = setup()
 try { const c = s.getBridgeConfig(); c.devices[0].port = 8082; s.setBridgeConfig(c); expect(s.getBridgeConfig().devices[0].port).toBe(8082)
 for (const change of [{mac:'bad'}, {node_id:'unknown'}, {endpoints:{status:'http://evil/',records:'',alerts:''}}]) expect(() => s.setBridgeConfig({...c,devices:[{...c.devices[0],...change}]})).toThrow()
 } finally { s.close() }
})
it('solicita GET por USB y sólo avanza cursor después de persistir la página', async () => {
 const s = setup(); const sent: {op:string; request_id:string; path:string}[] = []
 const c = s.getBridgeConfig(); c.devices = [c.devices[0]]; c.devices[0].endpoints = {status:'',records:'/api/v1/records',alerts:''}; s.setBridgeConfig(c)
 const bridge = new BridgeController(s, line => { sent.push(JSON.parse(line.slice(11))); return true })
 try {
 bridge.hello(); expect(sent[0].op).toBe('hello'); bridge.packet(JSON.stringify({event:'ready',protocol:1})); expect(sent[1].op).toBe('configure'); bridge.packet(JSON.stringify({event:'configured',request_id:sent[1].request_id,ok:true})); sent.splice(1,1); expect(sent[1].path).toBe('/api/v1/records?limit=100')
 const context = bridge.context(); const page = {items:[reading()],next_cursor:'page2',has_more:true}
 acceptSerialPayload(s,page,context.source,context.checkpointKey); bridge.ingested(page); expect(s.cursor(context.checkpointKey!)).toBe('page2')
 bridge.packet(JSON.stringify({event:'done',request_id:sent[1].request_id,ok:true})); await Promise.resolve(); expect(sent[2].path).toContain('cursor=page2')
 expect(() => acceptSerialPayload(s,{items:[{bad:true}],next_cursor:'badcursor',has_more:false},context.source,context.checkpointKey)).toThrow(); expect(s.cursor(context.checkpointKey!)).toBe('page2'); expect(s.rows('test')).toHaveLength(1)
 } finally { bridge.stop(); await Promise.resolve(); s.close() }
})
it('rechaza un productor diferente al configurado sin escribir en SQLite', () => {
 const s=setup(); const c=s.getBridgeConfig();c.devices=[c.devices[1]];s.setBridgeConfig(c)
 const sent: {op:string;request_id:string}[]=[]; const b=new BridgeController(s,line=>{sent.push(JSON.parse(line.slice(11)));return true})
 try { b.packet(JSON.stringify({event:'ready',protocol:1}));b.packet(JSON.stringify({event:'configured',request_id:sent[0].request_id,ok:true}));expect(() => acceptSerialPayload(s,reading(),b.context().source)).toThrow();expect(s.rows('test')).toHaveLength(0) } finally { b.stop();s.close() }
})

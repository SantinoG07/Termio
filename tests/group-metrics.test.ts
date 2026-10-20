import { it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { Store } from '../backend/src/store.ts'
import { nodeSchema,configSchema } from '../backend/src/config.ts'
import { recordSchema } from '../shared/record-schema.ts'
const nodes=JSON.parse(readFileSync('backend/config/nodes.json','utf8')).map((n:unknown)=>nodeSchema.parse(n))
const cfg=configSchema.parse(JSON.parse(readFileSync('backend/config/groups.json','utf8')))
const fixture=(name:string)=>JSON.parse(readFileSync(`tests/fixtures/${name}-api.json`,'utf8'))
const current=(name:string)=>({...fixture(name),timestamp:new Date().toISOString(),record_id:randomUUID()})
it('acepta ambas precisiones ISO con zona, conserva registros y los ubica por identidad de grupo',()=>{
 const s=new Store(':memory:',nodes,cfg.group5_delivery)
 try{
 for(const name of ['volcanic','energy']){expect(recordSchema.safeParse(fixture(name)).success).toBe(true);const r=current(name);expect(s.ingest(r).duplicate).toBe(false)}
 const dashboard=s.dashboard('test',cfg.sources)
 const v=dashboard.snapshots.find(r=>r.node_id==='volcanic_node_01')!;expect(v.group_number).toBe(2);expect(v.data.gas_concentration).toBe(411.94954260491);expect(v.data.pressure).toBe(1012.7852333204484);expect(v.metadata.units.gas_concentration).toBe('ADC')
 const e=dashboard.snapshots.find(r=>r.node_id==='energy_node_01')!;expect(e.group_number).toBe(3);expect(e.data.lumens).toBe(5000);expect(e.data.operation_mode).toBe('active');expect(e.data.generation_power).toBe(1800)
 expect(dashboard.records).toHaveLength(2)
 }finally{s.close()}
})
it('sigue rechazando unidad distinta, variable desconocida y grupo incorrecto',()=>{
 const s=new Store(':memory:',nodes,cfg.group5_delivery)
 try{
 const r=current('volcanic');r.metadata.units.gas_concentration='ppm';expect(()=>s.ingest(r)).toThrow('UNIT_MISMATCH')
 const u=current('volcanic');u.data.unregistered=10;u.metadata.units.unregistered='V';u.metadata.quality.unregistered='valid';expect(()=>s.ingest(u)).toThrow('UNKNOWN_VARIABLE')
 expect(()=>s.ingest({...current('volcanic'),group:3})).toThrow('NODE_MISMATCH');expect(s.rows('test')).toHaveLength(0)
 }finally{s.close()}
})
it('no acepta status como tipo, fechas sin zona ni números enviados como texto',()=>{
 for(const patch of [{record_type:'status'},{timestamp:'2026-10-20T11:35:34.712752'},{data:{...fixture('volcanic').data,pressure:'1012.7'}}])expect(recordSchema.safeParse({...fixture('volcanic'),...patch}).success).toBe(false)
})

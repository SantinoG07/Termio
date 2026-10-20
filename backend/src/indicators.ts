import { recordSchema } from '../../shared/record-schema.ts'
import type { Store } from './store.ts'
import type { BridgeDevice } from './bridge-config.ts'
interface Receipt { signature:string; node:string; observed:number; received:number; eligible:boolean }
const signature=(d:BridgeDevice)=>JSON.stringify(d)
// Only a completed, validated and persisted producer GET can change these receipts.
export class Indicators {
 private receipts=new Map<string,Receipt>()
 private store:Store
 constructor(store:Store){this.store=store}
 clear(){this.receipts.clear()}
 result(device:BridgeDevice,payload:unknown,ok:boolean,now=Date.now()){
  if(!ok){this.receipts.delete(device.id);return}
  const entries=payload && typeof payload==='object' && 'items' in payload && Array.isArray(payload.items)?payload.items:[payload]
  const records=entries.map(r=>recordSchema.safeParse(r)).filter(r=>r.success).map(r=>r.data!)
   .filter(r=>r.node_id===device.node_id).sort((a,b)=>Date.parse(b.timestamp)-Date.parse(a.timestamp))
  const latest=records[0]
  if(!latest){this.receipts.delete(device.id);return}
  this.receipts.set(device.id,{signature:signature(device),node:device.node_id,observed:Date.parse(latest.timestamp),received:now,eligible:latest.metadata.environment==='operational' && latest.metadata.source_type==='real' && latest.metadata.clock_synced===true && latest.status==='active'})
 }
 values(now=Date.now()):boolean[]{
  const config=this.store.getBridgeConfig()
  return [1,2,3,4,5].map(group=>config.devices.some(d=>{
   const node=this.store.nodes.find(n=>n.node_id===d.node_id),r=this.receipts.get(d.id)
   return !!(d.enabled && d.environment==='operational' && node?.group_number===group && r?.eligible && r.signature===signature(d) && now-r.received<=Math.max(30000,config.interval_ms*3) && now-r.observed<=Math.max(30000,node.expected_interval_seconds*3000) && now-r.observed>=-300000)
  }))
 }
}

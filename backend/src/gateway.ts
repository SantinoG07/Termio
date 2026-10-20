import type { Store } from './store.ts'
import { centralAPI } from './central-api.ts'
interface Transfer { id:string; bytes:Buffer; offset:number; seq:number; phase:'begin'|'chunk'|'end'; timer?:ReturnType<typeof setTimeout> }
export class GatewayController {
 private active:Transfer|undefined
 private store:Store
 private send:(line:string)=>boolean
 private recent:number[]=[]
 constructor(store:Store,send:(line:string)=>boolean){this.store=store;this.send=send}
 private command(value:Record<string,unknown>){return this.send('TERMIO_CMD '+JSON.stringify(value)+'\n')}
 private arm(){const t=this.active;if(!t)return;if(t.timer)clearTimeout(t.timer);t.timer=setTimeout(()=>this.finish(false,'GATEWAY_USB_TIMEOUT'),15000)}
 private finish(ok:boolean,error:string|null=null){const t=this.active;if(!t)return;if(t.timer)clearTimeout(t.timer);if(!ok)this.command({op:'api_cancel',request_id:t.id});this.active=undefined;const status=this.store.centralStatus;status.busy=false;if(ok)status.completed++;else status.failed++;status.last_error=error}
 packet(p:Record<string,unknown>){
  if(p.event==='api_request'){
   if(typeof p.request_id!=='string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(p.request_id) || typeof p.path!=='string' || p.path.length>1200 || typeof p.method!=='string')return
   if(this.active){this.command({op:'api_cancel',request_id:p.request_id});return}
   const now=Date.now();this.recent=this.recent.filter(t=>now-t<1000)
   const throttled=this.recent.length>=4;this.recent.push(now)
   let reply
   try{reply=throttled?{status:429,body:{error:'RATE_LIMITED'},headers:{'Content-Type':'application/json','Cache-Control':'no-store'}}:centralAPI(this.store,p.path,p.method)}catch{reply={status:503,body:{error:'STORAGE_UNAVAILABLE'},headers:{'Content-Type':'application/json','Cache-Control':'no-store'}}}
   const status=this.store.centralStatus;status.requests++;status.busy=true;status.last_request_at=new Date().toISOString();status.last_path=p.path.split('?')[0].slice(0,200);status.last_status=reply.status
   const bytes=Buffer.from(JSON.stringify(reply.body))
   this.active={id:p.request_id,bytes,offset:0,seq:-1,phase:'begin'};this.arm()
   if(!this.command({op:'api_begin',request_id:p.request_id,status:reply.status,length:bytes.length,headers:reply.headers}))this.finish(false,'SERIAL_WRITE_FAILED')
   return
  }
  const t=this.active;if(!t || p.request_id!==t.id)return
  if(p.event==='api_abort'){this.finish(false,'GATEWAY_CLIENT_ABORT');return}
  if(p.event==='api_done' && t.phase==='end'){this.finish(p.ok===true,p.ok===true?null:'GATEWAY_LENGTH_MISMATCH');return}
  if(p.event!=='api_ack' || p.seq!==t.seq || t.phase==='end')return
  if(t.offset>=t.bytes.length){t.phase='end';this.arm();if(!this.command({op:'api_end',request_id:t.id}))this.finish(false,'SERIAL_WRITE_FAILED');return}
  const chunk=t.bytes.subarray(t.offset,t.offset+512);t.offset+=chunk.length;t.seq++;t.phase='chunk';this.arm()
  if(!this.command({op:'api_chunk',request_id:t.id,seq:t.seq,data:chunk.toString('base64')}))this.finish(false,'SERIAL_WRITE_FAILED')
 }
 stop(){this.finish(false,'GATEWAY_DISCONNECTED')}
}

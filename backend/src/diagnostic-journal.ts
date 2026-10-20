import { appendFileSync,chmodSync,existsSync,mkdirSync,renameSync,statSync } from 'node:fs'
import { dirname } from 'node:path'
// Bounded private diagnostic transcript. Producer bodies/standalone records are omitted.
export class DiagnosticJournal {
 private pending=''
 private body=false
 private discard=false
 readonly path:string
 error:string|null=null
 constructor(path:string){this.path=path;this.record('CAPTURE_STARTED')}
 private record(text:string){
  try{
   mkdirSync(dirname(this.path),{recursive:true,mode:0o700})
   if(existsSync(this.path) && statSync(this.path).size>=1048576){
    if(existsSync(this.path+'.1'))renameSync(this.path+'.1',this.path+'.2')
    renameSync(this.path,this.path+'.1')
   }
   appendFileSync(this.path,new Date().toISOString()+' '+text+'\n',{mode:0o600});chmodSync(this.path,0o600);this.error=null
  }catch{this.error='DIAGNOSTIC_LOG_WRITE_FAILED'}
 }
 push(chunk:string){for(const c of chunk){if(c==='\n'){this.line(this.pending);this.pending='';this.discard=false}else if(!this.discard){this.pending+=c;if(this.pending.length>=4096){this.pending+=' [TRUNCATED]';this.discard=true}}}}
 private line(line:string){
  const text=line.replace(/[\x00-\x08\x0b-\x1f\x7f]/g,'').trim();if(!text)return
  if(text==='--- INICIO DE RESPUESTA ---' || text==='--- RESPUESTA ---'){this.body=true;return}
  if(text==='--- FIN DE RESPUESTA ---' || text==='--- FIN ---'){this.body=false;return}
  const crash=/Guru Meditation|Backtrace:|panic|watchdog|Brownout|CORRUPT HEAP|assert failed|rst:0x|Rebooting|Stack smashing/i.test(text)
  if(this.body && !crash && !text.startsWith('TERMIO_BRIDGE '))return
  if(text.startsWith('TERMIO_BRIDGE ') && /"event"\s*:\s*"boot"/.test(text))this.body=false
  if(text.startsWith('{'))return
  if(!crash && /password|authorization|secret|token/i.test(text)){this.record('[SENSITIVE_LINE_OMITTED]');return}
  const safe=text.replace(/https?:\/\/[^\s]+/g,value=>{try{const u=new URL(value);return u.origin+u.pathname+(u.search?'?[REDACTED]':'')}catch{return '[URL]'}})
  this.record(safe)
 }
 close(){if(this.pending)this.line(this.pending);this.pending='';this.record('CAPTURE_STOPPED')}
}

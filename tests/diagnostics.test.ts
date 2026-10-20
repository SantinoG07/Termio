import { it,expect,vi } from 'vitest'
import { mkdtempSync,readFileSync,rmSync,statSync,writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../backend/src/store.ts'
import { configSchema,nodeSchema } from '../backend/src/config.ts'
import { BridgeController } from '../backend/src/bridge.ts'
import { SerialDecoder } from '../backend/src/serial.ts'
import { DiagnosticJournal } from '../backend/src/diagnostic-journal.ts'
const nodes=JSON.parse(readFileSync('backend/config/nodes.json','utf8')).map((n:unknown)=>nodeSchema.parse(n))
const cfg=configSchema.parse(JSON.parse(readFileSync('backend/config/groups.json','utf8')))
it('diario guarda arranque y panic, omite cuerpos/secretos, conserva permisos privados y rota',()=>{
 const tmp=mkdtempSync(join(tmpdir(),'termio-diag-test-')),file=join(tmp,'serial.log')
 try{
 const journal=new DiagnosticJournal(file)
 journal.push('rst:0x3\nGET http://user:password@192.168.4.2/api?token=secret\n--- INICIO DE RESPUESTA ---\n{"private":"producer-body"}\nGuru Meditation Error\nBacktrace: 0x4000:0x3ff0\n--- FIN DE RESPUESTA ---\nAuthorization: secret\nTERMIO_BRIDGE {"event":"boot","boot_id":1}\n')
 journal.close();const text=readFileSync(file,'utf8');expect(text).toContain('rst:0x3');expect(text).toContain('Guru Meditation');expect(text).toContain('Backtrace');expect(text).not.toContain('producer-body');expect(text).not.toContain('password');expect(text).not.toContain('secret');expect(text).toContain('"event":"boot"');expect(statSync(file).mode&0o777).toBe(0o600)
 writeFileSync(file,'x'.repeat(1048576));journal.push('next\n');expect(statSync(file+'.1').size).toBe(1048576);expect(statSync(file).size).toBeLessThan(4096)
 }finally{rmSync(tmp,{recursive:true,force:true})}
})
it('boot durante un cuerpo interrumpido reinicia decoder sin ingerir JSON parcial',()=>{
 const values:unknown[]=[],errors:string[]=[],diagnostics:string[]=[]
 const decoder=new SerialDecoder(p=>values.push(p),e=>errors.push(e),d=>diagnostics.push(d))
 decoder.push('HTTP: 200\n--- INICIO DE RESPUESTA ---\n{"partial":\nTERMIO_BRIDGE {"event":"boot","boot_id":10}\n')
 expect(values).toHaveLength(0);expect(errors).toEqual(['SERIAL_INTERRUPTED_BY_REBOOT']);expect(diagnostics.at(-1)).toContain('"boot_id":10')
})
it('boot invalida configuracion/trabajo pendiente y guarda breadcrumbs, sin reiniciar desde PC',async()=>{
 const s=new Store(':memory:',nodes,cfg.group5_delivery),sent:any[]=[];const b=new BridgeController(s,line=>{sent.push(JSON.parse(line.slice(11)));return true})
 try{
 s.bridgeStatus.ready=true;s.bridgeStatus.configured=true
 b.packet(JSON.stringify({event:'boot',boot_id:10,reset_reason:6,previous_stage:31,firmware:'test'}))
 expect(s.bridgeStatus.ready).toBe(false);expect(s.bridgeStatus.configured).toBe(false);expect(s.diagnosticStatus.last_boot?.previous_stage).toBe(31);expect(sent.at(-1).op).toBe('hello');expect(sent.some(c=>c.op==='restart')).toBe(false)
 const count=sent.length;b.packet(JSON.stringify({event:'boot',boot_id:10,reset_reason:6,previous_stage:31}));expect(sent).toHaveLength(count)
 b.packet(JSON.stringify({event:'diagnostic',name:'ap_stop',detail:11}));expect(s.diagnosticStatus.events.at(-1)?.name).toBe('ap_stop')
 }finally{b.stop();await Promise.resolve();s.close()}
})
it('silencio sin trabajo activo invalida ready/configured y telemetria actual registra su fecha',()=>{
 vi.useFakeTimers();const s=new Store(':memory:',nodes,cfg.group5_delivery),sent:any[]=[];const b=new BridgeController(s,line=>{sent.push(JSON.parse(line.slice(11)));return true})
 try{
 s.bridgeStatus.ready=true;s.bridgeStatus.configured=true
 b.packet(JSON.stringify({event:'network',uptime_s:20,heap:100,min_heap:90,clients:1,channel:6,dhcp_offers:1,dhcp_acks:1,dhcp_naks:0,dhcp_errors:0,reset_reason:1}))
 expect(s.diagnosticStatus.telemetry_at).not.toBeNull();vi.advanceTimersByTime(24000);expect(s.bridgeStatus.ready).toBe(false);expect(s.bridgeStatus.configured).toBe(false);expect(s.bridgeStatus.last_error).toBe('ESP32_SILENT')
 }finally{b.stop();s.close();vi.useRealTimers()}
})

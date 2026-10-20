#!/usr/bin/env python3
"""Prueba aislada: API de configuración -> USB bidireccional -> SQLite -> React. No usa la LAN."""
import os,pty,tty,socket,tempfile,subprocess,json,time,threading,select,uuid,datetime,urllib.request

def main():
 with tempfile.TemporaryDirectory(prefix='termio-bridge-test-') as tmp:
  master,slave=pty.openpty();tty.setraw(slave)
  with socket.socket() as sock: sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
  base=f'http://127.0.0.1:{port}'
  cfg=json.load(open('backend/config/groups.json'))
  for source in cfg['sources']: source['enabled']=False
  cfg['group5_delivery']['enabled']=False
  with open(tmp+'/groups.json','w') as f:json.dump(cfg,f)
  env={**os.environ,'LOCAL_API_PORT':str(port),'LOCAL_DB_PATH':tmp+'/db.sqlite','SERIAL_DIAGNOSTIC_LOG':tmp+'/serial.log','LOCAL_GROUPS_FILE':tmp+'/groups.json','SERIAL_PORT':os.ttyname(slave)}
  log=open(tmp+'/log','w+')
  child=subprocess.Popen(['node','--experimental-strip-types','backend/src/main.ts'],env=env,stdout=log,stderr=log)
  commands=[];stop=threading.Event()
  def api(path,method='GET',body=None):
   req=urllib.request.Request(base+'/api/v1/'+path,data=json.dumps(body or {}).encode() if method!='GET' else None,method=method,headers={'Content-Type':'application/json'})
   with urllib.request.urlopen(req,timeout=3) as r:return json.load(r)
  def wait(predicate):
   end=time.monotonic()+20
   while time.monotonic()<end:
    try:
     result=api('dashboard?environment=test')
     if predicate(result):return result
    except OSError:pass
    time.sleep(.1)
   raise AssertionError('Timeout')
  def firmware():
   pending=b''
   while not stop.is_set():
    if not select.select([master],[],[],.1)[0]:continue
    pending+=os.read(master,4096)
    while b'\n' in pending:
     line,pending=pending.split(b'\n',1)
     if not line.startswith(b'TERMIO_CMD '):continue
     cmd=json.loads(line[11:]);commands.append(cmd)
     if cmd['op']=='hello':os.write(master,b'TERMIO_BRIDGE {"event":"ready","protocol":1}\n');continue
     if cmd['op']=='configure':
      os.write(master,('TERMIO_BRIDGE '+json.dumps({'event':'configured','request_id':cmd['request_id'],'ok':True})+'\n').encode());continue
     n=len([c for c in commands if c['op']=='get'])
     record={'schema_version':'1.0.0','record_id':str(uuid.uuid4()),'record_type':'reading','node_id':'fire_node_01','group':1,'subsystem':'Monitoreo de incendios forestales','timestamp':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'active','alert_level':'low','data':{'temperature':28+n/10},'metadata':{'environment':'test','source_type':'simulated','alert_evaluated':True,'clock_synced':True,'units':{'temperature':'degC'},'quality':{'temperature':'valid'}}}
     text=f'Equipo: {cmd["name"]}\nMAC: {cmd["mac"]}\nIP detectada: 192.168.4.2\nGET http://192.168.4.2:{cmd["port"]}{cmd["path"]}\nHTTP: 200\n--- INICIO DE RESPUESTA ---\n'+json.dumps(record)+'\n--- FIN DE RESPUESTA ---\nTERMIO_BRIDGE '+json.dumps({'event':'done','request_id':cmd['request_id'],'ok':True})+'\n'
     os.write(master,text.encode())
  thread=None
  try:
   wait(lambda d:d['serial']['connected'])
   conf=api('bridge/config')['config'];conf['devices']=[conf['devices'][0]];conf['interval_ms']=3600000
   api('bridge/config','PUT',conf)
   thread=threading.Thread(target=firmware);thread.start()
   wait(lambda d:len(d['records'])==1 and not d['bridge']['busy'])
   assert commands[-1]['path']=='/api/incendios'
   subprocess.run(['node','scripts/verify-bridge-ui.mjs',base],check=True,timeout=60)
   result=wait(lambda d:len(d['records'])>=2)
   assert result['snapshots'][0]['data']['temperature']>28.1
   assert any(c.get('path')=='/api/prueba-ui' and c.get('port')==8082 for c in commands)
   assert api('bridge/config')['config']['devices'][0]['endpoints']['status']=='/api/prueba-ui'
   print('PASS: UI edita MAC/puerto/endpoint -> SQLite configuración -> comando USB GET -> respuesta -> SQLite registros -> frontend; sin consultas LAN.')
  except Exception:
   log.flush();log.seek(0);print(log.read()[-3000:]);raise
  finally:
   stop.set()
   if thread:thread.join(2)
   child.terminate();child.wait(timeout=5);os.close(master);os.close(slave);log.close()
if __name__=='__main__':main()

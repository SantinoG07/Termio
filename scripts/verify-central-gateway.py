#!/usr/bin/env python3
"""Real backend/Python serial reader/SQLite with an emulated ESP32 PTY. No LAN access."""
import os,pty,tty,socket,tempfile,subprocess,json,time,select,uuid,datetime,urllib.request,base64

def main():
 with tempfile.TemporaryDirectory(prefix='termio-central-test-') as tmp:
  master,slave=pty.openpty();tty.setraw(slave)
  with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
  cfg=json.load(open('backend/config/groups.json'))
  for source in cfg['sources']:source['enabled']=False
  cfg['group5_delivery']['enabled']=False
  with open(tmp+'/groups.json','w') as f:json.dump(cfg,f)
  env={**os.environ,'LOCAL_API_PORT':str(port),'LOCAL_DB_PATH':tmp+'/db.sqlite','SERIAL_DIAGNOSTIC_LOG':tmp+'/serial.log','LOCAL_GROUPS_FILE':tmp+'/groups.json','SERIAL_PORT':os.ttyname(slave)}
  log=open(tmp+'/log','w+');child=subprocess.Popen(['node','--experimental-strip-types','backend/src/main.ts'],env=env,stdout=log,stderr=log)
  pending=b''
  def api(path,body=None):
   req=urllib.request.Request(f'http://127.0.0.1:{port}/api/v1/'+path,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json'},method='GET' if body is None else 'PUT')
   with urllib.request.urlopen(req,timeout=3) as r:return json.load(r)
  def wait(fn):
   end=time.monotonic()+15
   while time.monotonic()<end:
    try:
     value=fn()
     if value:return value
    except OSError:pass
    time.sleep(.05)
   raise AssertionError('Timeout')
  def emit(value):os.write(master,('TERMIO_BRIDGE '+json.dumps(value)+'\n').encode())
  def command():
   nonlocal pending
   end=time.monotonic()+15
   while time.monotonic()<end:
    if b'\n' not in pending:
     if not select.select([master],[],[],.1)[0]:continue
     pending+=os.read(master,4096)
    while b'\n' in pending:
     line,pending=pending.split(b'\n',1)
     if not line.startswith(b'TERMIO_CMD '):continue
     c=json.loads(line[11:])
     if c['op']=='hello':emit({'event':'ready','protocol':1});continue
     if c['op']=='configure':emit({'event':'configured','request_id':c['request_id'],'ok':True});continue
     return c
   raise AssertionError('USB command timeout')
  def request(path):
   ident='api-'+uuid.uuid4().hex;emit({'event':'api_request','request_id':ident,'method':'GET','path':path})
   begin=command();assert begin['op']=='api_begin',begin
   emit({'event':'api_ack','request_id':ident,'seq':-1});chunks=[]
   while True:
    c=command();assert c['request_id']==ident
    if c['op']=='api_end':emit({'event':'api_done','request_id':ident,'ok':True});break
    assert c['op']=='api_chunk';part=base64.b64decode(c['data'],validate=True);assert len(part)<=512;chunks.append(part)
    emit({'event':'api_ack','request_id':ident,'seq':c['seq']})
   raw=b''.join(chunks);assert len(raw)==begin['length'];return begin,json.loads(raw)
  try:
   conf=wait(lambda:api('bridge/config'))['config'];conf['paused']=True;api('bridge/config',conf)
   record=json.load(open('tests/fixtures/volcanic-api.json'));record['record_id']=str(uuid.uuid4());record['timestamp']=datetime.datetime.now(datetime.timezone.utc).isoformat()
   os.write(master,('HTTP: 200\n--- INICIO DE RESPUESTA ---\n'+json.dumps(record)+'\n--- FIN DE RESPUESTA ---\n').encode())
   wait(lambda:len(api('dashboard')['records'])==1)
   begin,body=request('/api/v1/volcanico/latest');assert begin['status']==200;assert body==record;assert begin['headers']['X-Termio-Source']=='sqlite'
   begin,body=request('/api/v1/volcanico/records?limit=1');assert begin['status']==200;assert body['items']==[record];assert not body['has_more']
   begin,body=request('/api/v1/volcanico/status');assert begin['status']==404;assert body['error']=='NO_SYNCHRONIZED_STATE'
   time.sleep(1.05)
   begin,body=request('/api/v1/bridge/config');assert begin['status']==404;assert body=={'error':'NOT_FOUND'}
   stats=wait(lambda:api('central/diagnostics')['completed']==4 and api('central/diagnostics'))
   assert not stats['busy'];assert stats['failed']==0
   assert len(api('dashboard')['records'])==1
   print('PASS: ESP emulado -> USB bidireccional real -> SQLite -> JSON original; fragmentos UTF8, historial, status 404 y bloqueo de administracion. Sin LAN ni datos de prueba en la base de trabajo.')
  except Exception:
   log.flush();log.seek(0);print(log.read()[-2500:]);raise
  finally:
   child.terminate();child.wait(timeout=5);os.close(master);os.close(slave);log.close()
if __name__=='__main__':main()

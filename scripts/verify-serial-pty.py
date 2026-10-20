#!/usr/bin/env python3
"""Prueba real del transporte serie Linux usando un pseudoterminal, sin ESP32."""
import datetime
import json
import os
import pty
import signal
import socket
import sqlite3
import subprocess
import tempfile
import time
import tty
import urllib.request
import uuid


def main():
    with tempfile.TemporaryDirectory(prefix='termio-serial-') as directory:
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        master, slave = pty.openpty()
        tty.setraw(slave)
        serial_port = os.ttyname(slave)
        config = json.load(open('backend/config/groups.json'))
        for source in config['sources']:
            source['enabled'] = False
        config['group5_delivery']['enabled'] = False
        config_path = directory + '/groups.json'
        with open(config_path, 'w') as output:
            json.dump(config, output)
        db_path = directory + '/termio.db'
        env = {**os.environ, 'LOCAL_API_PORT': str(port), 'LOCAL_DB_PATH': db_path, 'SERIAL_DIAGNOSTIC_LOG': db_path+'.serial.log',
               'LOCAL_GROUPS_FILE': config_path, 'SERIAL_PORT': serial_port, 'SERIAL_BAUD': '115200'}
        with open(directory + '/backend.log', 'w+') as log:
            child = subprocess.Popen(['node', '--experimental-strip-types', 'backend/src/main.ts'], env=env, stdout=log, stderr=log)
            try:
                def dashboard():
                    with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/v1/dashboard?environment=test', timeout=2) as response:
                        return json.load(response)
                def wait_for(predicate, label):
                    deadline = time.monotonic() + 15
                    while time.monotonic() < deadline:
                        if child.poll() is not None:
                            raise AssertionError('backend exited')
                        try:
                            value = dashboard()
                            if predicate(value):
                                return value
                        except (OSError, ValueError):
                            pass
                        time.sleep(0.1)
                    raise AssertionError(label)
                wait_for(lambda d: d['serial']['connected'], 'serial not ready')
                record = {'schema_version': '1.0.0', 'record_id': str(uuid.uuid4()), 'record_type': 'reading',
                          'node_id': 'fire_node_01', 'group': 1, 'subsystem': 'Monitoreo de incendios forestales',
                          'timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
                          'status': 'active', 'alert_level': 'low', 'data': {'temperature': 28.5, 'humidity': 35.0, 'wind_speed': None},
                          'metadata': {'environment': 'test', 'source_type': 'simulated', 'alert_evaluated': True,
                                       'clock_synced': True, 'units': {'temperature': 'degC', 'humidity': '%', 'wind_speed': 'm/s'},
                                       'quality': {'temperature': 'valid', 'humidity': 'valid', 'wind_speed': 'missing'}}}
                def send(payload, status=200):
                    text = f'Equipo: Grupo 1\r\nMAC: EC:8E:77:10:D4:E8\r\nIP detectada: 192.168.4.2\r\nGET http://192.168.4.2:8081/api/incendios\r\nHTTP: {status}\r\n--- INICIO DE RESPUESTA ---\r\n{json.dumps(payload, ensure_ascii=False, indent=2)}\r\n--- FIN DE RESPUESTA ---\r\n'
                    data = text.encode()
                    for i in range(0, len(data), 31):
                        os.write(master, data[i:i+31])
                        time.sleep(0.001)
                send(record)
                result = wait_for(lambda d: d['serial']['accepted'] == 1, 'record missing')
                assert result['snapshots'][0]['data']['temperature'] == 28.5
                assert result['nodes'][0]['observed_connection'] == 'online'
                send(record)
                wait_for(lambda d: d['serial']['duplicates'] == 1, 'duplicate not detected')
                changed = {**record, 'data': {**record['data'], 'temperature': 30}}
                send(changed)
                wait_for(lambda d: d['serial']['last_error'] == 'RECORD_CONFLICT', 'conflict missing')
                invalid = {**record, 'record_id': str(uuid.uuid4()), 'group': 2}
                send(invalid)
                wait_for(lambda d: d['serial']['last_error'] == 'NODE_MISMATCH', 'identity validation missing')
                # Una medicion realmente nueva debe actualizar el snapshot y la tarjeta.
                newer = {**record, 'record_id': str(uuid.uuid4()), 'data': {**record['data'], 'temperature': 29.7}}
                send(newer)
                updated = wait_for(lambda d: d['serial']['accepted'] == 2, 'new measurement not ingested')
                assert updated['snapshots'][0]['data']['temperature'] == 29.7
                assert len(updated['records']) == 2
                send(newer)
                wait_for(lambda d: d['serial']['duplicates'] == 2, 'new measurement retry not deduplicated')
                with urllib.request.urlopen(f'http://127.0.0.1:{port}/', timeout=2) as response:
                    assert b'/assets/' in response.read()
                with sqlite3.connect(db_path) as db:
                    assert db.execute('SELECT count(*) FROM records').fetchone()[0] == 2
                    assert db.execute('SELECT count(*) FROM rejections').fetchone()[0] == 2
                if '--ui' in __import__('sys').argv:
                    subprocess.run(['node', 'scripts/verify-serial-ui.mjs', f'http://127.0.0.1:{port}'], check=True, timeout=60)
                if '--group-metrics' in __import__('sys').argv:
                    for name in ['volcanic', 'energy']:
                        payload = json.load(open(f'tests/fixtures/{name}-api.json'))
                        payload['timestamp'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
                        send(payload)
                    wait_for(lambda d: len(d['records']) == 4, 'group metrics missing')
                    subprocess.run(['node', 'scripts/verify-group-metrics-ui.mjs', f'http://127.0.0.1:{port}'], check=True, timeout=60)
                print('PASS: pseudoterminal -> Python -> backend -> SQLite en disco -> API y frontend servido; deduplicacion y rechazos.')
            except Exception:
                log.flush()
                log.seek(0)
                print(log.read()[-4000:])
                raise
            finally:
                child.send_signal(signal.SIGTERM)
                try:
                    child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()
                os.close(master)
                os.close(slave)


if __name__ == '__main__':
    main()

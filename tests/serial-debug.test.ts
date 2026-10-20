import { describe, it, expect } from 'vitest'
import { createSerialDebug, observeSerialDiagnostic } from '../shared/serial-debug.ts'
import { SerialDecoder } from '../backend/src/serial.ts'

const at = '2026-10-20T13:00:00Z'
describe('Diagnostico serie seguro', () => {
  it('muestra clientes y relacion MAC/IP del AP', () => {
    const d = createSerialDebug()
    observeSerialDiagnostic(d, 'Cantidad: 2', at)
    observeSerialDiagnostic(d, 'MAC: 74:97:79:51:DD:C1 | IP: 192.168.4.3', at)
    expect(d.ap_clients).toBe(2)
    expect(d.clients).toEqual([{ mac: '74:97:79:51:DD:C1', ip: '192.168.4.3' }])
    observeSerialDiagnostic(d, 'Cantidad: 0', at)
    expect(d.clients).toEqual([])
  })
  it('distingue HTTP de conectividad y no conserva credenciales de URL', () => {
    const d = createSerialDebug()
    for (const line of ['Equipo: Grupo 3 - Energia', 'MAC: 74:97:79:51:DD:C1', 'IP detectada: 192.168.4.3', 'GET http://user:secret@192.168.4.3:80/api/v1/status?token=secret#secret', 'HTTP: 404']) observeSerialDiagnostic(d, line, at)
    expect(d.requests[0]).toMatchObject({ stage: 'http_error', http_status: 404, mac: '74:97:79:51:DD:C1', ip: '192.168.4.3', url: 'http://192.168.4.3/api/v1/status' })
    expect(JSON.stringify(d)).not.toContain('secret')
    observeSerialDiagnostic(d, 'ERROR de conexion HTTP: connection refused', at)
    expect(d.requests[0]).toMatchObject({ stage: 'connection_error', error: 'connection refused' })
  })
  it('distingue MAC ausente y no atribuye IP vieja al nuevo intento', () => {
    const d = createSerialDebug()
    for (const line of ['Equipo: Grupo 3 - Energia', 'IP detectada: 192.168.4.3', 'GET http://192.168.4.3/api/v1/status', 'HTTP: 200', 'Grupo 3 - Energia: no conectado o sin IP DHCP disponible.', 'MAC buscada: 74:97:79:51:DD:C1']) observeSerialDiagnostic(d, line, at)
    expect(d.requests[0]).toMatchObject({ stage: 'not_found', ip: null, url: null, mac: '74:97:79:51:DD:C1' })
  })
  it('no guarda cuerpos JSON ni lineas arbitrarias o contraseñas', () => {
    const d = createSerialDebug()
    for (const line of ['Password: hidden', 'Authorization: Bearer hidden', '{"token":"hidden"}', 'ERROR de conexion HTTP: hidden']) observeSerialDiagnostic(d, line, at)
    expect(d.events).toEqual([])
    expect(JSON.stringify(d)).not.toContain('hidden')
  })
  it('el parser solo entrega diagnosticos fuera del cuerpo HTTP', () => {
    const lines: string[] = []; const records: unknown[] = []
    const parser = new SerialDecoder(p => records.push(p), () => {}, l => lines.push(l))
    parser.push('Equipo: Grupo 3\nHTTP: 200\n--- RESPUESTA ---\n{"data":{"message":"Equipo: inyectado"}}\n--- FIN ---\n')
    expect(records).toHaveLength(1)
    expect(lines).not.toContain('{"data":{"message":"Equipo: inyectado"}}')
  })
  it('conserva el ultimo resultado completo mientras comienza otro GET', () => {
    const d = createSerialDebug()
    for (const line of ['Equipo: Grupo 1', 'HTTP: 200']) observeSerialDiagnostic(d, line, at)
    d.requests[0].ingest = 'duplicate'
    observeSerialDiagnostic(d, 'Equipo: Grupo 1', '2026-10-20T13:00:10Z')
    observeSerialDiagnostic(d, 'GET http://192.168.4.2:8081/api/incendios', '2026-10-20T13:00:10Z')
    expect(d.requests[0].stage).toBe('requesting')
    expect(d.requests[0].last_result).toMatchObject({ http_status: 200, ingest: 'duplicate', at })
  })
  it('limita eventos y equipos en memoria', () => {
    const d = createSerialDebug()
    for (let i = 0; i < 200; i++) {
      observeSerialDiagnostic(d, `Equipo: Grupo ${i}`, at)
      observeSerialDiagnostic(d, 'HTTP: 200', at)
    }
    expect(d.events).toHaveLength(60); expect(d.requests).toHaveLength(32)
  })
})

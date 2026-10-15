import { handleRequest } from './handler.ts'

const privateTestToken = 'a'.repeat(64) // Solo fixture; no existe en ninguna base real.
const request = (body: string, auth = true, contentType = 'application/json') => new Request('http://localhost/ingest-record', { method: 'POST', headers: { 'Content-Type': contentType, ...(auth ? { Authorization: `Bearer ${privateTestToken}` } : {}) }, body })
const check = async (response: Response, expected: number) => {
  if (response.status !== expected) throw new Error(`Esperado ${expected}; obtenido ${response.status}: ${await response.text()}`)
}
Deno.test('Solo POST', async () => check(await handleRequest(new Request('http://localhost')), 405))
Deno.test('Sin credencial: 401', async () => check(await handleRequest(request('{}', false)), 401))
Deno.test('Content-Type incorrecto: 415', async () => check(await handleRequest(request('{}', true, 'text/plain')), 415))
Deno.test('JSON inválido: 400', async () => check(await handleRequest(request('{')), 400))
Deno.test('Contrato incompleto: 422', async () => check(await handleRequest(request('{}')), 422))
Deno.test('Payload mayor de 64 KiB: 413', async () => check(await handleRequest(request(JSON.stringify({ huge: 'x'.repeat(70000) }))), 413))

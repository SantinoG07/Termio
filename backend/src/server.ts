import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { existsSync, statSync, readFileSync } from 'node:fs'
import { resolve, extname, sep } from 'node:path'
import { z } from 'zod'
import { Store, LocalError } from './store.ts'
import type { LocalConfig } from './config.ts'

const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json' }
function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value))
}
function tokenMatches(actual: string | undefined, expected: string | undefined) {
  if (!actual || !expected || expected.length < 24) return false
  const a = Buffer.from(actual); const b = Buffer.from(`Bearer ${expected}`)
  return a.length === b.length && timingSafeEqual(a, b)
}
async function body(req: IncomingMessage) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new LocalError(415, 'EXPECTED_JSON')
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk); size += bytes.length
    if (size > 65536) throw new LocalError(413, 'BODY_TOO_LARGE')
    chunks.push(bytes)
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) as unknown }
  catch { throw new LocalError(400, 'INVALID_JSON') }
}
function environment(url: URL) {
  const result = z.enum(['test', 'operational']).safeParse(url.searchParams.get('environment') || 'test')
  if (!result.success) throw new LocalError(400, 'INVALID_ENVIRONMENT')
  return result.data
}
export function createLocalServer(store: Store, config: LocalConfig, env: Record<string, string | undefined> = process.env, dist = resolve('dist')) {
  const server = createServer(async (req, res) => {
    let rejectionSource = 'local_api'
    try {
      // Solo loopback. Sin CORS abierto; evita tambien acceso por DNS rebinding.
      const port = (server.address() as { port: number } | null)?.port
      const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`])
      if (!hosts.has(req.headers.host || '')) throw new LocalError(403, 'UNTRUSTED_HOST')
      const origin = req.headers.origin
      if (origin && !hosts.has(new URL(origin).host) && !['http://localhost:5173', 'http://127.0.0.1:5173'].includes(origin)) throw new LocalError(403, 'UNTRUSTED_ORIGIN')
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      const path = url.pathname
      if (req.method === 'GET' && path === '/api/health') return json(res, 200, { status: 'ok', storage: 'sqlite', mode: 'local', enabled_sources: config.sources.filter(s => s.enabled).length })
      if (req.method === 'GET' && path === '/api/v1/dashboard') return json(res, 200, store.dashboard(environment(url), config.sources))
      if (req.method === 'GET' && path === '/api/v1/records') {
        const e = environment(url)
        const limit = Number(url.searchParams.get('limit') || 100)
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new LocalError(400, 'INVALID_LIMIT')
        let after = 0
        const cursor = url.searchParams.get('cursor')
        if (cursor) {
          const decoded = Buffer.from(cursor, 'base64url').toString('utf8')
          const match = /^(test|operational):(\d+)$/.exec(decoded)
          if (!match || match[1] !== e || !Number.isSafeInteger(Number(match[2]))) throw new LocalError(400, 'INVALID_CURSOR')
          after = Number(match[2])
        }
        return json(res, 200, store.collection(e, after, limit))
      }
      if (req.method === 'POST' && path === '/api/v1/records') {
        // Recepcion opcional para herramientas locales. No hereda claves de Supabase.
        const source = config.sources.find(s => s.enabled && tokenMatches(req.headers.authorization, env[s.ingest_token_env]))
        if (!source) throw new LocalError(401, 'UNAUTHORIZED')
        rejectionSource = source.node_id
        const payload = await body(req)
        const result = store.ingest(payload, source)
        return json(res, result.duplicate ? 200 : 201, result)
      }
      if (path.startsWith('/api/')) throw new LocalError(404, 'NOT_FOUND')
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new LocalError(405, 'METHOD_NOT_ALLOWED')
      const relative = decodeURIComponent(path).replace(/^\/+/, '')
      let file = resolve(dist, relative || 'index.html')
      if (!file.startsWith(dist + sep)) throw new LocalError(403, 'FORBIDDEN_PATH')
      if (!existsSync(file) || !statSync(file).isFile()) {
        if (extname(relative)) throw new LocalError(404, 'NOT_FOUND')
        file = resolve(dist, 'index.html')
      }
      if (!existsSync(file)) return json(res, 503, { error: 'FRONTEND_NOT_BUILT', action: 'Ejecutar npm.cmd run build' })
      res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' })
      res.end(req.method === 'HEAD' ? undefined : readFileSync(file))
    } catch (error) {
      const e = error instanceof LocalError ? error : new LocalError(500, 'INTERNAL_ERROR')
      try { if (req.method === 'POST') store.reject(rejectionSource, e) } catch { /* No enmascarar un error de disco con datos sensibles. */ }
      if (!res.headersSent) json(res, e.status, { error: e.code, details: e.details })
      else res.end()
    }
  })
  server.requestTimeout = 10000; server.headersTimeout = 10000
  return server
}

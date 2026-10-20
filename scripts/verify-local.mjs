// Prueba local integrada. No conecta ESP32, Supabase ni servicios externos.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { chromium } from '@playwright/test'
import { Store } from '../backend/src/store.ts'
import { pollSource, deliverPending } from '../backend/src/poller.ts'
import { createLocalServer } from '../backend/src/server.ts'

const raw = JSON.parse(readFileSync('backend/config/groups.json', 'utf8'))
const nodes = JSON.parse(readFileSync('backend/config/nodes.json', 'utf8'))
const sample = JSON.parse(readFileSync('examples/reading.json', 'utf8'))
const state = { ...sample, record_id: randomUUID(), record_type: 'state', timestamp: new Date().toISOString() }
const event = { ...state, record_id: randomUUID(), record_type: 'event', alert_level: 'critical', data: { event_code: 'LOCAL_TEST', message: 'Prueba automatizada simulada', related_record_ids: [state.record_id] }, metadata: { ...state.metadata, units: {}, quality: {} } }
let delivered = 0
const group = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json')
  if (req.method === 'POST') {
    let text = ''; for await (const c of req) text += c
    const body = JSON.parse(text); assert.equal(body.record_id, event.record_id); delivered++
    res.statusCode = 201; res.end(JSON.stringify({ record_id: body.record_id, duplicate: false })); return
  }
  if (req.url.startsWith('/api/v1/status')) res.end(JSON.stringify(state))
  else res.end(JSON.stringify({ items: req.url.startsWith('/api/v1/records') ? [event] : [], next_cursor: 'test-final', has_more: false }))
})
const listen = s => new Promise(resolve => s.listen(0, '127.0.0.1', resolve))
const close = s => new Promise(resolve => { s.close(resolve); s.closeAllConnections() })
await listen(group)
const base = `http://127.0.0.1:${group.address().port}`
const source = { ...raw.sources[0], enabled: true, base_url: base }
const config = { ...raw, sources: [source], group5_delivery: { ...raw.group5_delivery, enabled: true, allow_simulated: true, base_url: base } }
const store = new Store(':memory:', nodes, config.group5_delivery)
let ui; let browser
try {
  assert.equal(await pollSource(store, source, {}), true)
  await deliverPending(store, config, {})
  assert.equal(delivered, 1)
  assert.equal(store.rows('test').length, 2)
  assert.equal(store.db.prepare('SELECT state FROM outbox').get().state, 'technical_receipt')
  ui = createLocalServer(store, config); await listen(ui)
  const url = `http://127.0.0.1:${ui.address().port}`
  assert.equal((await fetch(url)).status, 200)
  let launchError
  for (const options of [{ headless: true }, { headless: true, channel: 'chrome' }]) {
    try { browser = await chromium.launch(options); break } catch (error) { launchError = error }
  }
  if (!browser) throw launchError
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []; const external = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (!request.url().startsWith(url)) external.push(request.url()) })
  await page.goto(url)
  await page.getByText('SQLite local conectado', { exact: true }).waitFor()
  assert.match(await page.locator('body').innerText(), /31,5/)
  assert.equal(await page.getByText('Modo demostración · Datos simulados', { exact: true }).count(), 0)
  mkdirSync('qa', { recursive: true })
  await page.screenshot({ path: 'qa/local-desktop.png', fullPage: true })
  await page.getByRole('link', { name: 'Registros', exact: true }).click()
  await page.getByRole('heading', { name: 'Historial de registros', exact: true }).waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'qa/local-mobile.png', fullPage: true })
  const overflow = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth, elements: [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(e).position !== 'fixed').slice(0, 12).map(e => ({ tag: e.tagName, class: e.className, width: e.getBoundingClientRect().width })) }))
  if (overflow.width > overflow.viewport) console.log('OVERFLOW', JSON.stringify(overflow))
  assert.equal(overflow.width <= overflow.viewport, true)
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  console.log('PASS: HTTP local real -> validacion -> SQLite -> POST Grupo 5 simulado -> UI desktop/mobile; cero peticiones externas.')
  await page.close()
} finally {
  await browser?.close(); if (ui) await close(ui); await close(group); store.close()
}

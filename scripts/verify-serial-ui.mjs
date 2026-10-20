import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'

const url = process.argv[2]
if (!url || new URL(url).hostname !== '127.0.0.1') throw new Error('Solo se permiten pruebas locales')
const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  const errors = []
  const external = []
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(url).origin) external.push(request.url())
  })
  await page.goto(url)
  await page.getByText('SQLite local conectado', { exact: true }).waitFor()
  await page.getByText('ESP32 por USB · Puerto abierto', { exact: true }).waitFor()
  const card = page.locator('.node-card').filter({ hasText: 'fire_node_01' })
  assert.match(await card.innerText(), /29,7/)
  assert.match(await card.innerText(), /Origen del dato: Simulado/)
  assert.match(await card.innerText(), /Recibido por USB:/)
  assert.match(await card.innerText(), /35/)
  await page.locator('nav a[href="/records"]').click()
  const recordsTable = page.locator('table').filter({ hasText: 'fire_node_01' })
  await recordsTable.waitFor()
  assert.match(await recordsTable.innerText(), /fire_node_01/)
  assert.match(await page.getByRole('table', { name: 'Diagnóstico por equipo' }).innerText(), /HTTP correcto \(200\)/)
  assert.match(await page.locator('.serial-debug-record').innerText(), /repitiendo el mismo registro/)
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  assert.deepEqual(errors, [])
  assert.deepEqual(external, [])
  console.log('PASS UI: datos serie visibles en tarjetas y registros, banner USB, movil sin overflow y sin solicitudes externas.')
  await context.close()
} finally {
  await browser.close()
}

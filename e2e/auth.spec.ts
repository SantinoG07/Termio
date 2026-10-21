import { test, expect } from '@playwright/test'

// Stub solo de UI: no prueba un login real contra Supabase.
test('acceso: formulario, error y entrada a demo', async ({ page }) => {
  await page.route('**/src/lib/supabase.ts', route => route.fulfill({
    contentType: 'application/javascript',
    body: `export const configurationError = null;
      export const supabase = { auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signInWithPassword: async () => ({ error: { message: 'fixture invalid login' } })
      } };`,
  }))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Acceder al centro' })).toBeVisible()
  await page.screenshot({ path: 'qa/login-desktop.png', fullPage: true })
  await page.getByLabel('Correo electrónico').fill('test@example.invalid')
  await page.getByLabel('Contraseña', { exact: true }).fill('fixture-not-a-real-password')
  await page.getByRole('button', { name: 'Iniciar sesión' }).click()
  await expect(page.getByRole('alert')).toHaveText(/No se pudo iniciar sesión/)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'qa/login-mobile-error.png', fullPage: true })
  await page.getByRole('button', { name: 'Entrar al panel' }).click()
  await expect(page.getByRole('heading', { name: 'Vista general' })).toBeVisible()
})

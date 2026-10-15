import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const result = {}
  for (const name of process.argv.slice(2)) {
    if (!/^[a-z-]+$/.test(name)) throw new Error('Nombre de captura inválido')
    const source = 'data:image/png;base64,' + (await readFile('qa/' + name + '.png')).toString('base64')
    result[name] = await page.evaluate(async source => {
      const image = new Image(); image.src = source; await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = Math.min(image.width, 900)
      canvas.height = image.height * canvas.width / image.width
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
      return canvas.toDataURL('image/jpeg', 0.5).split(',')[1]
    }, source)
  }
  console.log(JSON.stringify(result))
} finally { await browser.close() }

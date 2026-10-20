import { chromium,expect } from '@playwright/test'
const base=process.argv[2];if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(base))throw Error('Sólo localhost')
const browser=await chromium.launch({headless:true})
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base)
 const volcanic=page.locator('.node-card').filter({has:page.locator('.node-id',{hasText:'volcanic_node_01'})})
 const energy=page.locator('.node-card').filter({has:page.locator('.node-id',{hasText:'energy_node_01'})})
 await expect(volcanic).toContainText('GRUPO 2');await expect(volcanic.locator('.metric-row')).toHaveCount(5)
 for(const text of ['Gas · lectura cruda','411,95','ADC','Presión atmosférica','1.012,79','hPa','PM 2.5'])await expect(volcanic).toContainText(text)
 await expect(volcanic.locator('.raw-gas-note')).toContainText('no representa una concentración calibrada')
 await expect(energy).toContainText('GRUPO 3');await expect(energy.locator('.metric-row')).toHaveCount(10)
 for(const text of ['Batería','Potencia generada','Potencia consumida','Energía almacenada','Tensión','Corriente','Modo de operación','Velocidad del viento','Flujo luminoso','5.000','lm'])await expect(energy).toContainText(text)
 await expect(energy).not.toContainText('Presión atmosférica');await expect(volcanic).not.toContainText('Flujo luminoso')
 for(const colorScheme of ['light','dark']){await page.emulateMedia({colorScheme});await page.setViewportSize({width:390,height:844});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Overflow móvil')}
 await page.getByRole('link',{name:'Registros',exact:true}).click();const history=page.getByRole('table').filter({has:page.getByRole('columnheader',{name:'Tipo',exact:true})});await expect(history).toContainText('volcanic_node_01');await expect(history).toContainText('energy_node_01')
 if(errors.length)throw Error(errors.join('\n'))
 console.log('PASS: todos los datos de Grupos 2 y 3 en sus tarjetas/historial, gas ADC sin conversión, 390px oscuro/claro sin overflow.')
}finally{await browser.close()}

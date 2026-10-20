import { chromium } from '@playwright/test'
const base=process.argv[2]
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw Error('Sólo localhost')
const browser=await chromium.launch({headless:true})
try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto(base);await page.getByText('Configurar equipos y endpoints · ESP32',{exact:true}).click()
 await page.getByLabel('MAC Wi-Fi del equipo').fill('EC:8E:77:10:D4:E8')
 await page.getByLabel('Puerto HTTP',{exact:true}).fill('8082')
 await page.getByLabel('IP fija reservada por DHCP',{exact:false}).fill('192.168.4.12')
 await page.getByLabel('GET estado / medición',{exact:true}).fill('/api/prueba-ui')
 await page.getByRole('button',{name:'Guardar configuración',exact:true}).click()
 await page.getByText('Configuración guardada en SQLite.',{exact:false}).waitFor()
 await page.getByRole('button',{name:'Consultar APIs ahora',exact:true}).click()
 await page.reload();await page.getByText('Configurar equipos y endpoints · ESP32',{exact:true}).click()
 if(await page.getByLabel('GET estado / medición',{exact:true}).inputValue()!='/api/prueba-ui')throw Error('No persiste configuración')
 if(await page.getByLabel('IP fija reservada por DHCP',{exact:false}).inputValue()!=='192.168.4.12')throw Error('No persiste reserva IP')
 for(const colorScheme of ['dark','light']){
  await page.emulateMedia({colorScheme})
  const colors=await page.locator('.bridge-settings').evaluate(el=>{const s=getComputedStyle(el),i=getComputedStyle(el.querySelector('input'));return {bg:s.backgroundColor,fg:s.color,inputbg:i.backgroundColor,inputfg:i.color}})
  const lum=c=>{const a=c.match(/\d+/g).slice(0,3).map(Number).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});return .2126*a[0]+.7152*a[1]+.0722*a[2]}
  for(const [a,b] of [[colors.bg,colors.fg],[colors.inputbg,colors.inputfg]])if((Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05)<4.5)throw Error('Contraste insuficiente '+colorScheme)
 }
 await page.setViewportSize({width:390,height:844})
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Overflow móvil')
 if(errors.length)throw Error(errors.join('\n'))
 console.log('PASS: MAC/IP/endpoint persistentes, consulta manual, contraste oscuro/claro >=4.5 y móvil390px')
}finally{await browser.close()}

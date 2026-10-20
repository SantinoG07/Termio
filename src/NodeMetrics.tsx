import type { RecordRow } from './lib/domain'
import './NodeMetrics.css'
const labels: Record<string,string> = { temperature:'Temperatura',humidity:'Humedad relativa',wind_speed:'Velocidad del viento',smoke_level:'Humo · lectura cruda',pm2_5:'PM 2.5',pm10:'PM 10',pressure:'Presión atmosférica',gas_raw:'Gas · lectura cruda',so2_concentration:'Concentración de SO₂',co2_concentration:'Concentración de CO₂',voltage:'Tensión',current:'Corriente',generation_power:'Potencia generada',consumption_power:'Potencia consumida',stored_energy:'Energía almacenada',battery_level:'Batería',operation_mode:'Modo de operación',lumens:'Flujo luminoso',water_level:'Reserva de agua',water_volume:'Volumen de agua',flow_rate:'Caudal',water_temperature:'Temperatura del agua',pump_state:'Estado de la bomba',valve_state:'Estado de la válvula',device_state:'Dispositivo',connected_nodes:'Nodos reportados',total_nodes:'Nodos totales' }
const units: Record<string,string> = { degC:'°C','ug/m3':'µg/m³',count:'',adc_count:'cuentas ADC',string:'' }
const priority: Record<number,string[]> = { 1:['temperature','humidity','wind_speed','smoke_level'],2:['temperature','humidity','pm2_5','pm10','gas_concentration','gas_raw','so2_concentration','co2_concentration','pressure'],3:['battery_level','generation_power','consumption_power','stored_energy','voltage','current','operation_mode','temperature','wind_speed','lumens'],4:['water_level','water_volume','flow_rate','water_temperature','pump_state','valve_state'] }
const qualityLabels:Record<string,string> = { missing:'Dato faltante',invalid:'Lectura inválida',uncalibrated:'Sin calibrar' }
export function NodeMetrics({row}:{row:RecordRow}) {
 const order=priority[row.group_number]??[]
 const entries=Object.entries(row.data).sort(([a],[b])=>{const ai=order.indexOf(a),bi=order.indexOf(b);return (ai<0?999:ai)-(bi<0?999:bi)})
 const rawGas='gas_raw' in row.data || ('gas_concentration' in row.data && ['ADC','adc_count'].includes(row.metadata.units.gas_concentration))
 return <><div className="metrics node-metrics">{entries.map(([key,value])=>{
  const unit=row.metadata.units[key], quality=row.metadata.quality[key]
  const label=key==='gas_concentration' && ['ADC','adc_count'].includes(unit)?'Gas · lectura cruda':labels[key]??key
  const formatted=value===null?'Sin dato':typeof value==='number'?new Intl.NumberFormat('es-AR',{maximumFractionDigits:2}).format(value):typeof value==='object'?JSON.stringify(value):String(value)
  return <div key={key} className="metric-row"><span>{label}{qualityLabels[quality] && <small className="metric-quality">{qualityLabels[quality]}</small>}</span><strong>{formatted} <small>{value!==null?(units[unit]??unit??''):''}</small></strong></div>
 })}</div>{rawGas && <p className="raw-gas-note">Gas: lectura cruda del ADC; no representa una concentración calibrada ni se convierte a ppm.</p>}</>
}

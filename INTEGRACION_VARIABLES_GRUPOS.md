# Variables adicionales de los Grupos 2 y 3 (modo SQLite)

Se amplió el registro local de variables por solicitud del Grupo 6, sin desactivar la validación general ni alterar silenciosamente las mediciones.

## Grupo 2 — volcanic_node_01

Además del catálogo inicial, se acepta:

| Campo | Unidad recibida | Presentación |
| --- | --- | --- |
| gas_concentration | ADC | Gas · lectura cruda |
| gas_raw | adc_count | Gas · lectura cruda (alternativa explícita de nombre) |
| pressure | hPa | Presión atmosférica |

El nombre `gas_concentration` se conserva exactamente en SQLite y en el detalle JSON por trazabilidad, pero con unidad ADC se presenta explícitamente como dato crudo. NO se convierte a ppm ni se interpreta como concentración calibrada, identidad de gas o criterio de alarma. No se inventa una escala de ADC ni se redondea el registro persistido. Pendiente documentar con el productor sensor, escala y tratamiento/promediado de la lectura.

El frontend muestra hasta dos decimales; SQLite conserva el valor recibido completo. `source_type: simulated` sigue mostrándose como Simulado.

## Grupo 3 — energy_node_01

Se agregan `temperature: degC`, `wind_speed: m/s` y `lumens: lm`. Lumens se muestra como **Flujo luminoso**, no como lux. Se muestran también batería, potencias generada/consumida, energía almacenada, tensión, corriente y modo de operación si están presentes. No se exige producir variables inexistentes.

Continúa siendo necesario que el productor corrija `record_type: status` a `state`/`reading` según el caso y envíe timestamp con zona explícita. No se adivina una zona horaria ni se convierte automáticamente un tipo fuera del contrato.

## Interfaz y errores

Las tarjetas ya no descartan todas las variables después de las primeras dos. Se muestran los campos presentes del último registro válido de cada nodo, con prioridades por grupo, etiquetas legibles, unidad y avisos de calidad. No se mezclan datos entre grupos ni se completan campos faltantes con valores inventados. El historial y detalle JSON siguen disponibles.

Una variable numérica aún no registrada produce `UNKNOWN_VARIABLE`, con el campo en `data`. Una unidad diferente produce `UNIT_MISMATCH`, con unidad esperada/recibida. Identidad del nodo/grupo/subsistema, fechas, tipos, deduplicación y separación de entornos siguen validadas.

Archivos principales: `backend/config/nodes.json`, `backend/src/store.ts`, `shared/record-schema.ts`, `src/NodeMetrics.tsx` y `src/App.tsx`.

No es necesario flashear ESP32 ni migrar SQLite: reconstruir el frontend y reiniciar el backend carga el nuevo catálogo. No se modificó el esquema ni el catálogo remoto de Supabase.

Pruebas: `npm test`, `npm run local:build`, `python3 scripts/verify-serial-pty.py --ui --group-metrics`. Los ejemplos están sólo en `tests/fixtures`; no se cargan como demo ni se insertan en la base de trabajo.

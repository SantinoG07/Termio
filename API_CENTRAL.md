# API central local — Grupo 6

## Recorrido real

1. El backend decide qué consultar a los otros grupos, según MAC, IP reservada, puerto y endpoints editables en la dashboard.
2. Envía la orden por USB. El ESP32 hace el GET en su red Wi-Fi y devuelve el JSON por USB.
3. El backend valida el contrato, evita duplicados y persiste en SQLite. La dashboard lee esa misma base.
4. Un equipo conectado al AP puede consultar `http://192.168.4.1/api/v1/...`. El ESP32 recibe la petición, pide la respuesta al backend por USB, y devuelve los registros de SQLite al cliente Wi-Fi.

No se hace un nuevo GET al productor por cada petición a la API central. No depende de Internet, Supabase ni Vercel. **La PC debe estar encendida, con el backend ejecutándose y el ESP32 conectado por USB.** La PC puede estar en otra red: el enlace entre backend y placa es USB.

## Rutas públicas de solo lectura

Base: `http://192.168.4.1/api/v1`. También se acepta `/v1` como alias.

| Grupo | Prefijo |
|---|---|
| 1 — Incendios | `/incendios` |
| 2 — Volcánico y calidad ambiental | `/volcanico` |
| 3 — Sistema energético | `/energia` |
| 4 — Agua / inundaciones | `/inundaciones` |
| 5 — Comunicaciones | `/comunicaciones` |

Para cada prefijo:

- `GET /latest`: última medición o estado (`reading` o `state`) con reloj sincronizado, ordenado por fecha de observación.
- `GET /status`: último registro **de tipo `state`** con reloj sincronizado. No cambia un `reading` a `state`. Si el grupo solo publicó mediciones devuelve 404 `NO_SYNCHRONIZED_STATE`; usar `/latest`.
- `GET /records?limit=100&cursor=...`: historial de cualquier tipo.
- `GET /alerts?limit=100&cursor=...`: historial de registros de tipo `alert`. Puede estar vacío; el contrato actual reserva su producción al Grupo 5. No transforma automáticamente un nivel alto de una medición en un registro de alerta.

Además:
- `GET /health`: disponibilidad del backend/SQLite a través del puente. No implica que todos los productores estén conectados.
- `GET /nodes`: identidad, catálogo de variables y rutas públicas, sin MAC ni credenciales.
- `GET /records`: historial conjunto de todos los grupos.

`environment=test` por defecto; se puede pedir `environment=operational`. Los entornos no se mezclan. `limit` debe estar entre 1 y 100.

### Contrato y procedencia

Se devuelve el objeto original aceptado y persistido: `record_id`, `group`, `node_id`, `subsystem`, `timestamp`, `record_type`, `data` y `metadata` permanecen iguales. La identidad del productor no cambia al Grupo 6. `source_type: simulated` sigue identificando datos simulados por el productor.

Las fechas antiguas no se reemplazan por la hora de consulta. Los registros sin reloj sincronizado se conservan en historial, pero no se seleccionan como último estado temporal confiable.

Las colecciones tienen forma:

```json
{"items": [], "next_cursor": null, "has_more": false}
```

El cursor es opaco y específico de ruta/grupo/tipo/entorno. Conservarlo después de guardar los registros recibidos. Cuando `has_more` es true, consultar de nuevo con `next_cursor`. Al terminar, puede conservarse el último cursor no nulo para próximas consultas. No reutilizar un cursor de `/records` en `/alerts`, ni de un grupo en otro.

### Antigüedad y conectividad

Las respuestas individuales incluyen cabeceras:
- `X-Termio-Source: sqlite`
- `X-Termio-Received-At`: hora de recepción local del registro.
- `X-Termio-Data-Age-Seconds`: antigüedad según el timestamp original.
- `X-Termio-Stale`: true cuando supera tres intervalos esperados.
- `X-Termio-Clock-Synced: true`
- `X-Termio-Connection`: online/offline/unknown según la última recepción USB válida, no una nueva prueba de red.

HTTP 200 significa lectura correcta de SQLite, no dato necesariamente reciente ni ausencia de peligro. Revisar las cabeceras y la procedencia.

## Prueba desde un equipo conectado al AP

```bash
curl --max-time 60 -i http://192.168.4.1/api/v1/health
curl --max-time 60 -i http://192.168.4.1/api/v1/incendios/latest
curl --max-time 60 'http://192.168.4.1/api/v1/energia/records?environment=test&limit=10'
curl --max-time 60 http://192.168.4.1/api/v1/comunicaciones/alerts
```

No probar estas direcciones desde una PC conectada exclusivamente a otra red. Las verificaciones automatizadas usan localhost y terminales USB emuladas, sin intentar alcanzar la LAN del ESP32.

## Límites y seguridad

- Solo GET público. No hay recepción pública POST en esta versión; el mecanismo activo sigue siendo consultas a los grupos.
- No se publican `/bridge/config`, `/dashboard`, credenciales ni administración. La configuración continúa disponible únicamente en la dashboard local.
- Acceso HTTP sin TLS ni autenticación adicional: cualquier cliente autorizado a entrar al AP puede leer la API. Apto para la red del prototipo, no para información sensible ni un despliegue público.
- Una petición activa por vez; otra simultánea puede recibir 503. Máximo cuatro peticiones nuevas por segundo en el backend.
- Respuestas limitadas a 32 KiB: el historial reduce automáticamente la cantidad por página y conserva `has_more`; un registro individual mayor devuelve 413.
- Fragmentos USB de 512 bytes confirmados uno a uno; no se carga el historial completo en RAM del ESP32.
- Tiempo máximo de espera del puente: 45 segundos. Backend ausente: 503; transferencia interrumpida: se cierra la conexión, nunca se presenta JSON parcial como registro válido.
- Un GET saliente ya en curso puede demorar la atención de la API central. Durante una transferencia central no se inician nuevos GET a productores. DHCP sigue en su tarea independiente.

## Archivos

- `backend/src/central-api.ts`: rutas permitidas, consultas SQLite, cursores y cabeceras.
- `backend/src/gateway.ts`: transporte de respuestas PC -> ESP32 por USB.
- `backend/src/serial.ts`: integración del protocolo entrante y saliente.
- `firmware/termio_access_point/termio_access_point/central_http.h`: servidor HTTP del AP.
- `tests/central-api.test.ts` y `scripts/verify-central-gateway.py`: pruebas con bases aisladas.

Para inspección en la PC, las rutas por grupo y `/v1/...` también funcionan en `http://127.0.0.1:3001`. El endpoint local administrativo `GET /api/v1/central/diagnostics` muestra contadores de peticiones del gateway, último estado y error; no se publica en el AP. La antigua ruta local `/api/v1/records` conserva su paginación previa por compatibilidad: usar `/v1/records` para ensayar los mismos cursores de la API pública.

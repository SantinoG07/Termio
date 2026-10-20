# Consultar una URL pública ahora y un ESP32 después

## Qué cambió

La API original `supabase/functions/ingest-record/handler.ts` solo recibe registros (POST). No contenía una URL pública para sustituir. Se agregó un colector que hace GET a una fuente configurable y reenvía la misma muestra a esa API. No se modificó el dashboard ni la recepción existente.

```text
URL pública o ESP32 -- GET desde PC --> colector -- POST HTTPS --> Supabase --> dashboard
```

El colector necesita permanecer ejecutándose. Cuando la fuente es un ESP32 privado, la PC debe estar en su misma red y tener Internet para reenviar a Supabase. No se ejecuta dentro de React ni en Vercel. No se agregó todavía programación de consultas desde Edge Functions.

## Dónde reemplazar la URL

Copiá `.env.collector.example` a `.env.collector` en la raíz del proyecto. La línea es `SOURCE_URL`.

Para la fuente pública:

```dotenv
SOURCE_URL=https://TU_SERVIDOR_PUBLICO/api/status
ALLOW_SOURCE_HTTP=false
SOURCE_TOKEN=
```

Para el ESP32, usando la IP que informa su monitor serie:

```dotenv
SOURCE_URL=http://192.168.1.50/api/status
ALLOW_SOURCE_HTTP=true
SOURCE_TOKEN=EL_MISMO_READ_TOKEN_CONFIGURADO_EN_EL_ESP32
```

La IP es solo un ejemplo. Usá la real o una reserva DHCP. HTTP transporta el token sin cifrar: usar solo en una LAN de confianza durante el prototipo, sin abrir puertos del router ni exponer el ESP32 a Internet. Un despliegue real requiere un transporte protegido.

No reemplaces `VITE_SUPABASE_URL`: esa variable conecta el navegador a Supabase. El destino `INGEST_URL` tampoco cambia al sustituir una fuente.

## Otras variables

`INGEST_URL` es el endpoint ya desplegado de recepción. `INGEST_KEY` es la credencial privada del grupo productor, no la publishable key ni una service_role. `SOURCE_TOKEN` es otra credencial distinta: permite leer la fuente y nunca se reutiliza para escribir en Supabase. Ninguna se llama VITE_.

`EXPECTED_NODE_ID`, `EXPECTED_GROUP` y `EXPECTED_ENVIRONMENT` deben coincidir con el registro JSON que entrega la fuente. El ejemplo de firmware corresponde al módulo físico del Grupo 6: `monitoring_center`, grupo 6, entorno test. Si la fuente pertenece a otro grupo, cambiá las tres variables y usá una credencial de ingesta de ese grupo; no reasignes a grupo 6 los datos recibidos de otro equipo.

El registro `nodes` y la credencial deben estar habilitados en Supabase, siguiendo README.md. No se ejecutaron cambios en una cuenta remota.

## Ejecutar en esta PC Windows

Node 24 está disponible. PowerShell bloquea `npm.ps1` en esta PC: usá `npm.cmd`, sin cambiar las políticas de seguridad.

```powershell
npm.cmd ci
Copy-Item .env.collector.example .env.collector
# Completar .env.collector con las URLs y credenciales correctas antes de continuar.
npm.cmd run collector:once
npm.cmd run collector
```

`collector:once` hace una consulta y un envío. `collector` repite sin superponer solicitudes, por defecto cada diez segundos después de terminar el ciclo anterior. Cambiar el archivo de entorno requiere reiniciar el proceso. Ctrl+C detiene el colector; una espera o request en curso puede demorar brevemente la salida.

## Archivos que conviene entender

`scripts/poll-source.ts`: bucle, reintentos y registro pendiente en memoria. `scripts/collector-lib.ts`: configuración, `fetchRecord` para GET y `sendRecord` para POST. `adaptSource` es el lugar para convertir otra estructura de JSON al contrato. `shared/record-schema.ts`: campos y validación. `supabase/functions/ingest-record/handler.ts`: recepción, autenticación e invocación de PostgreSQL.

La fuente debe devolver UN objeto JSON del contrato 1.0.0. No se aceptan arrays, HTML ni estructuras arbitrarias como `{ items: [...] }`. Sin conocer la URL pública no se puede garantizar que tenga ese formato. No se cambia la fecha original por la fecha de consulta ni se fabrica un UUID nuevo al reenviar la misma observación.

El colector conserva un solo pendiente en memoria y reintenta ese mismo registro si falla temporalmente el envío. No es una cola persistente: un cierre pierde el pendiente y muestras intermedias pueden no recuperarse. El historial offline requiere almacenamiento adicional en el productor/gateway.

## Firmware ESP32

Abrí `firmware/termio_node/termio_node.ino` en Arduino IDE. Instalá el soporte oficial Arduino-ESP32 y ArduinoJson 7.x. Elegí el modelo real y su puerto. Copiá `config.example.h` a `config.h` en la misma carpeta y completá SSID, contraseña y un READ_TOKEN privado de al menos 24 caracteres. Esos valores no deben pegarse en chat ni subirse a Git. El archivo `config.h` está ignorado.

El token del colector `SOURCE_TOKEN` debe ser exactamente el mismo que `READ_TOKEN`. El firmware falla cerrado mientras conserve el token de ejemplo. No contiene claves de Supabase.

Conectá el ESP32, cargá el sketch y abrí el monitor serie a 115200 baudios. La placa imprime su IP, pero no sus credenciales. Expone GET `/api/status`, protegido por Authorization Bearer. No ofrece controles remotos, cambios de configuración ni CORS para navegadores.

La hora se sincroniza por NTP. Si no hay una fecha confiable, devuelve 503 CLOCK_NOT_SYNCHRONIZED en lugar de inventarla. Tras un arranque sin Internet, hace falta un NTP accesible en la LAN u otra fuente de tiempo. La PC necesita Internet para almacenar en Supabase.

Cada muestra tiene UUID v4 y fecha UTC. Consultas dentro del intervalo conservan el mismo registro para que la API deduplique. Una nueva muestra crea un UUID nuevo. El JSON informa `device_state: ready`, origen real y `alert_evaluated: false`: es estado de funcionamiento, no evaluación ambiental ni medición de un sensor.

Para agregar sensores, adaptar `makeSnapshot()`: usar `record_type: reading`, valores medidos, unidades y calidad, y registrar las unidades numéricas en `nodes.variable_units`. Definir umbrales requiere acuerdo con el grupo responsable y el Grupo 5. No se suministró un modelo de placa ni sensores concretos, por lo que no se inventaron conexiones ni lecturas ambientales.

Este sketch es un ejemplo para Arduino-ESP32; no se comprobó sobre una placa física. Debe compilarse y probarse seleccionando el hardware real antes de considerarlo validado.

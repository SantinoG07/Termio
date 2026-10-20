# Termio · Navathon III / Grupo 6

Centro de monitoreo e integración para el caso Caviahue–Copahue. React + Vite + TypeScript en Vercel; PostgreSQL, Auth y Edge Functions en Supabase. Es un prototipo educativo, no un sistema oficial de emergencias.

## Modo local sin Internet: SQLite

Variables adicionales por grupo y presentación de gas ADC/presión/energía: `INTEGRACION_VARIABLES_GRUPOS.md`.

La API local guarda en SQLite y sirve el dashboard sin Supabase. **Flujo actual: dashboard/backend → USB → ESP32 → GET a los grupos → USB → SQLite → frontend.** Las MAC, puertos y endpoints se editan desde **Configurar equipos y endpoints · ESP32**, sin reflashear. Guía actual: `CONFIGURAR_EQUIPOS_USB.md`. **Reservas reales MAC → IP, contraste del editor y diagnóstico de pérdida Wi-Fi:** `DIAGNOSTICO_WIFI_Y_RESERVAS.md`. El polling HTTP directo desde la PC es una alternativa diferente documentada en `docs/BACKEND_LOCAL_SQLITE.md`, deshabilitada por defecto.

- Arranque Linux: `npm run local:start` (Windows: `npm.cmd run local:start`); abrir `http://127.0.0.1:3001`.
- USB Linux: `SERIAL_PORT=auto`, `SERIAL_BAUD=115200` en `.env.backend`; cerrar el monitor serie de Arduino.
- Puente USB: MAC/puerto/endpoints desde el dashboard; configuración persistida en SQLite. `backend/config/groups.json` sólo corresponde a la alternativa HTTP directa desde la PC.
- Identidades y unidades: `backend/config/nodes.json`.
- Secretos: copiar `.env.backend.example` como `.env.backend`.
- `local:start` compila el frontend con el perfil `.env.offline` (`VITE_DATA_SOURCE=local`). Para desarrollo con Vite, seleccionar tambien `VITE_DATA_SOURCE=local` en `.env.local`.
- Base creada automáticamente: `data/termio.db`. No ejecutar el colector cloud para este modo.
- Servidor limitado a esta PC; no se expone recepción LAN. GET a los nodos y POST al Grupo 5 son conexiones salientes. Supabase se conserva como alternativa; no hay sincronización automática.

Las secciones siguientes describen la alternativa original Supabase/demo. Para volver a ella, quitar `VITE_DATA_SOURCE=local` y reconstruir el frontend.

## Consultar URL pública o ESP32

El colector y el firmware de ejemplo están documentados en `docs/COLECTOR_Y_ESP32.md`. La URL a consultar se configura con `SOURCE_URL` en `.env.collector`; no reemplaza `VITE_SUPABASE_URL`. La fuente debe devolver el contrato JSON 1.0.0 o requiere un adaptador. El firmware informa estado real del módulo del Grupo 6, no mediciones ambientales sin sensores.

## Inicio rápido sin servicios externos

Requiere Node.js >= 22.12 y npm. Las dependencias están fijadas en `package-lock.json`.

```bash
npm ci
npm run dev
```

Abrí la dirección indicada por Vite. Sin variables de Supabase, se habilita una demostración local con datos explícitamente simulados. Los fixtures no se envían a la nube ni activan dispositivos. La antigüedad avanza realmente: los ejemplos dejan de considerarse vigentes con el paso del tiempo.

## Qué incluye

Dashboard adaptable, vista de seis nodos, búsqueda y filtro por grupo, historial reciente, detalle JSON, exportación de la vista filtrada, alertas abiertas, eventos y confirmaciones, entorno test/operational separado y tema según preferencias del sistema. Supabase Auth usa email/contraseña y membresía explícita; no hay autorregistro en la interfaz.

El frontend consulta cada diez segundos; no implementa WebSockets ni Realtime. Muestra hasta 200 registros recientes. Los snapshots de nodos y el estado actual de alertas se consultan en vistas SQL independientes, por lo que no dependen de esa ventana de 200 filas.

## Conectar Supabase

Creá un proyecto en Supabase. Copiá `.env.example` a `.env.local` y completá solo los datos públicos:

```dotenv
VITE_SUPABASE_URL=https://TU_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=TU_PUBLISHABLE_KEY
```

Reiniciá Vite después de cambiar las variables. Las variables `VITE_` se incluyen en el bundle público: jamás usar secret keys, service_role, contraseñas ni credenciales de nodos ahí.

Autenticá tu CLI desde tu propia terminal:

```bash
npx supabase login
npx supabase link --project-ref TU_PROJECT_REF
npx supabase db push
npx supabase functions deploy ingest-record
```

Revisá las migraciones antes de aplicarlas, especialmente si el proyecto de Supabase ya contiene tablas. No se ejecutaron migraciones sobre un proyecto remoto durante la creación de este starter.

En Supabase Auth creá un usuario de email/contraseña y agregá su UUID a la tabla de miembros desde SQL Editor, con una sesión administrativa:

```sql
insert into public.workspace_members(user_id, display_name)
values ('REEMPLAZAR_POR_UUID_DE_AUTH', 'Integrante del Grupo 6');
```

Un usuario autenticado sin membresía no puede leer los datos. Deshabilitá el autorregistro también en la configuración del proyecto alojado; `config.toml` configura el entorno local, no todos los ajustes del proyecto remoto. Configurá Site URL y Redirect URLs para localhost y el dominio final de Vercel. Desactivá la persistencia automática de sesión en equipos compartidos si corresponde a la política del evento.

## Backend y persistencia

`supabase/migrations/202610140001_initial.sql` crea `nodes`, `records`, `workspace_members` e `integration_credentials`. `202610140002_read_models.sql` agrega `node_latest_records` y `latest_alert_records` con `security_invoker`, respetando RLS del consultante.

Los usuarios habilitados solo tienen SELECT. Las credenciales no son legibles por el navegador. La RPC `ingest_record` solo puede ejecutarse con service_role, comprueba nodo/grupo/entorno, valida unidades contra el registro y resuelve la inserción y deduplicación dentro de una transacción. La función Edge valida primero el contrato completo con Zod.

El esquema compartido en `shared/record-schema.ts` define un perfil implementable del contrato 1.0.0: data es un objeto de valores escalares, null o arrays de strings. Variables numéricas conocidas no aceptan strings; requiere unidades, procedencia y calidad cuando corresponde. Los grupos deben acordar cualquier ampliación. Este starter no fija umbrales de riesgo ni interpreta lecturas ADC como concentraciones calibradas.

## Habilitar un productor

Generá una credencial privada para el Grupo 1 desde tu terminal:

```bash
npm run key:create -- 1
```

El comando muestra una credencial privada una sola vez y el SQL con su hash SHA-256. Guardá el token en el backend del grupo, fuera de Git y del frontend. Ejecutá únicamente el SQL del hash en Supabase. La credencial habilita solo `test` y vence a los 30 días. Para revocarla, actualizá `revoked_at`. Autorizar `operational` requiere una decisión explícita y revisar previamente las pruebas.

Endpoint de recepción:

```text
POST https://TU_PROJECT_REF.supabase.co/functions/v1/ingest-record
Content-Type: application/json
Authorization: Bearer <CREDENCIAL_PRIVADA_DEL_GRUPO>
```

Body: el contenido de `examples/reading.json`. Conservá `record_id` en un reintento y asigná un UUID nuevo a cada observación distinta. El ejemplo tiene fecha fija y se verá como histórico; el script de smoke genera una fecha actual y UUID nuevo.

Respuestas: 201 persistido, 200 duplicado idéntico, 400 JSON inválido, 401 credencial ausente/inválida, 403 grupo/nodo/entorno no autorizado, 409 mismo ID con otro contenido, 413 más de 64 KiB, 415 Content-Type incorrecto, 422 contrato/unidades/fecha inválidos, 503 fallo de almacenamiento. Nunca se devuelve éxito antes de persistir.

`verify_jwt=false` es intencional: los productores usan credenciales propias, verificadas por hash en la transacción. No significa acceso sin autenticación. La función usa `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` disponibles en el runtime de Supabase y nunca los devuelve al cliente. No ofrece CORS para el navegador: la integración es backend-a-backend.

## Prueba de integración remota

Una vez desplegada la función y registrada una credencial de prueba del Grupo 1, definí `INGEST_URL` y `GROUP_1_INGEST_KEY` en tu terminal, sin pegarlos en el chat, y ejecutá:

```bash
npm run test:ingest
```

Comprueba autenticación, validación, autorización, unidades, persistencia, duplicados y conflictos. Inserta un registro simulado en `test`. No se ejecuta automáticamente contra servicios remotos.

## Vercel

Importá este repositorio en Vercel con preset Vite, build `npm run build`, output `dist` y Node 22 o 24. Agregá las dos variables públicas de Supabase para el entorno correspondiente y hacé un nuevo despliegue cuando cambien. `vercel.json` incluye el fallback SPA para rutas como `/nodes`, `/records` y `/alerts`.

Vercel aloja solamente el frontend. Las Edge Functions se despliegan en Supabase. No se creó un repositorio remoto ni se desplegó a ninguna cuenta durante la construcción del starter.

## Comandos de verificación

```bash
npm run typecheck
npm test
npm run build
npm audit
npx playwright install chromium
npm run test:e2e
```

Las pruebas SQL usan PostgreSQL embebido (PGlite), con roles y auth mínimos para comprobar migraciones, RLS, snapshots y transacciones. No sustituyen probar Supabase Auth y la Edge Function en un proyecto real. Las pruebas de navegador arrancan un servidor local sin variables de Supabase y validan el modo demo. El formulario de acceso se verifica con un stub de autenticación: no constituye una prueba de login real.

Para verificar los tipos del runtime Edge con Deno instalado:

```bash
deno check --config supabase/functions/deno.json supabase/functions/ingest-record/index.ts
deno test --config supabase/functions/deno.json supabase/functions/ingest-record/index.test.ts
```

Para levantar todo Supabase localmente hace falta Docker. Usá `npx supabase start` y luego `npx supabase functions serve ingest-record`. Los tests PGlite no requieren Docker.

## Límites importantes

Los backends de cada grupo envían información hacia la nube (push). Supabase no consulta IP privadas de la LAN. Si no hay Internet, cada subsistema debe conservar registros localmente y reenviarlos cuando vuelva la conexión. Este starter no implementa un gateway offline ni una cola persistente en los dispositivos.

El indicador de vigencia se calcula con la fecha de observación y el intervalo esperado. No demuestra conectividad física ni tres fallos de polling de una API, porque no se consultan APIs de nodos. Se ignoran relojes no sincronizados para construir snapshots y se conservan sus registros en el historial. Un dato atrasado no reemplaza un estado nuevo.

Solo el Grupo 5 publica alertas y confirmaciones en este perfil. Los demás producen eventos. No están implementados todavía el reenvío automático al Grupo 5, la activación de sirenas, un panel de administración ni el control de actuadores. Se conservan IDs relacionados para incorporar esos flujos sin ciclos.

Antes de uso fuera del prototipo: agregar limitación de tasa en gateway, límites de almacenamiento/retención, monitoreo de fallas, auditoría persistente de rechazos (sin secretos), recuperación de cuenta, paginación del historial completo y pruebas de integración reales. La función limita tamaño y credenciales, pero no incluye un rate limiter distribuido.
# Termio
# Termio
# Termio

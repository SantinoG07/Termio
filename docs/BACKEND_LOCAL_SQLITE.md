# Termio local: SQLite + consultas a los grupos

## Arquitectura implementada

PC y ESP32 de los grupos se conectan a la red Wi-Fi creada por el access point del Grupo 6. NO requiere Internet. El AP da conectividad; no necesita transportar JSON en codigo propio ni consultar endpoints. Node.js en la PC hace los GET/POST directamente a las IP de los nodos. React consulta la API local. SQLite queda en la PC.

Este documento describe el modo local. Supabase y el colector anterior se conservan como alternativa separada; no hay sincronizacion automatica SQLite/Supabase.

## Arranque en Windows

Se recomienda Node.js 24 (la PC usada tiene 24.11). SQLite usa node:sqlite, incluido en Node: no hay que instalar un servidor SQLite ni descargar un driver nativo. Node puede mostrar ExperimentalWarning; no es un error de guardado.

Con dependencias ya instaladas:

```powershell
npm.cmd run local:start
```

Este comando compila React y arranca el servidor. Abrir http://127.0.0.1:3001. Se crea data/termio.db automaticamente, con las tablas de backend/migrations/001_initial.sql. La PC debe seguir encendida con el proceso ejecutandose. Ctrl+C cierra servidor, workers y base.

Antes de quedarse sin Internet, instalar dependencias con npm.cmd ci si faltan. El funcionamiento normal no descarga paquetes, fuentes ni servicios de la nube.

Para desarrollo, dos terminales:

```powershell
npm.cmd run local:server
```

```powershell
npm.cmd run dev
```

Vite reenvia /api a 127.0.0.1:3001. Si cambia el puerto del backend, cambiar tambien vite.config.ts para desarrollo. El servidor de produccion sirve dist y API con el mismo origen.

La seleccion de frontend esta en .env.local:

```dotenv
VITE_DATA_SOURCE=local
```

El modo local no usa Supabase Auth. Por seguridad, servidor y dashboard escuchan SOLAMENTE en 127.0.0.1. No se exponen a los otros grupos ni a Internet. Esto no impide los GET/POST salientes de la PC hacia los ESP32. No abrir puertos del firewall para este flujo pull.

## Donde poner las IP y los endpoints

Editar backend/config/groups.json. Hay una entrada por grupo, inicialmente enabled=false y base_url vacia: NO se inventaron direcciones ni se contactan dispositivos al arrancar.

Ejemplo de fuente (la IP es solo ilustrativa):

```json
{
  "node_id": "fire_node_01",
  "enabled": true,
  "base_url": "http://192.168.4.11",
  "environment": "test",
  "token_env": "GROUP_1_READ_TOKEN",
  "ingest_token_env": "GROUP_1_INGEST_TOKEN",
  "poll_interval_ms": 10000,
  "timeout_ms": 5000,
  "paths": {
    "status": "/api/v1/status",
    "records": "/api/v1/records",
    "alerts": "/api/v1/alerts"
  }
}
```

base_url es SOLO origen (esquema, IP y puerto), sin ruta ni credenciales. Las rutas se editan en paths. HTTP se permite para LAN de confianza; los tokens no van cifrados, no exponer esta red a terceros. No se siguen redirecciones para evitar enviar tokens a otro host. Reiniciar backend despues de cambiar configuracion.

El catalogo de identidad, unidades e intervalo esta en backend/config/nodes.json. El Grupo 6 esta deshabilitado por defecto: no se inventa un sensor ni una presencia fisica para producir una sexta tarjeta activa. Hay cinco nodos productores registrados.

Los secretos van en .env.backend (copiar de .env.backend.example), nunca en variables VITE_ ni en groups.json:

```dotenv
GROUP_1_READ_TOKEN=valor_privado_del_grupo
GROUP_5_EVENTS_TOKEN=valor_privado_para_enviar_eventos
```

Si el grupo acordo lectura sin autenticacion, dejar su READ_TOKEN vacio. Los INGEST_TOKEN son otros tokens distintos, opcionales para POST desde herramientas en ESTA PC. No se necesitan para el polling.

Se puede seleccionar un archivo privado de configuracion con LOCAL_GROUPS_FILE en .env.backend. No imprimir ni compartir los tokens.

## GET realmente implementados

backend/src/poller.ts -> pollSource():

1. GET status: exige UN registro comun de tipo state y hasta 64 KiB.
2. GET records?limit=100&cursor=...: recupera historial.
3. GET alerts?limit=100&cursor=...: recupera registros de tipo alert.

Las colecciones deben tener exactamente items, next_cursor (string o null), has_more (boolean). Limite 100 registros/pagina y 1 MiB/respuesta. Hasta diez paginas por endpoint/ciclo; los siguientes ciclos continuan desde el checkpoint. Si un grupo no tiene alertas debe devolver coleccion vacia, no 404. Los intervalos se cuentan despues de terminar el ciclo, evitando solapamientos y saturacion. La primera consulta se hace tras el intervalo configurado.

Cada endpoint tiene su cursor independiente por nodo, entorno y URL. Pagina y cursor se persisten en la MISMA transaccion. Si un registro es invalido, se revierte la pagina completa y no se adelanta el cursor; queda un rechazo tecnico. Hace falta corregir la fuente, no saltar silenciosamente los datos invalidos.

Cuando next_cursor es null al final, se conserva el ultimo cursor util: una repeticion de la ultima pagina se deduplica. No se puede fabricar un cursor de la API productora. Para reanudacion incremental eficiente, coordinar que la fuente entregue un checkpoint reutilizable tambien al final.

Cada fuente tiene un worker independiente; una fuente caida no bloquea a las otras. Tres ciclos fallidos marcan observed_connection=offline. No se cambia el status historico del nodo. Los datos superando tres intervalos se muestran desactualizados. Un ciclo incluye sus tres endpoints; una falla en cualquiera marca ese ciclo incompleto.

## Validacion y SQLite

backend/src/store.ts valida con shared/record-schema.ts, identidad registrada, entorno de la fuente, unidades del catalogo y fecha (no mas de cinco minutos futura). Esta implementacion requiere record_id UUID y metadata.clock_synced explicito, decisiones concretas sobre las recomendaciones del contrato. No convierte unidades o formatos arbitrarios; la fuente debe cumplir el contrato. Agregar un adaptador solo si se acuerda y documenta.

Tablas: nodes, records, cursors, connection_state, rejections y outbox.

Se conserva el payload original canonico para comparar duplicados y reenviar eventos sin cambiar ID, productor o timestamp. Tambien se conserva la forma validada, received_at y una secuencia de ingestion. La comparacion ignora el orden de claves de objetos, no cambios de contenido. Mismo ID + mismo contenido: no duplica. Mismo ID + otro contenido: 409. Un rechazo no se guarda como medicion valida.

Los snapshots y ultimas alertas se consultan por fecha de observacion en consultas SQL independientes del historial reciente de 200 filas. Los registros atrasados o sin reloj sincronizado quedan en historial pero no sustituyen un estado temporalmente confiable mas reciente. Entornos test/operational separados en consultas y validacion.

Los archivos data/ y .env.backend estan ignorados por Git. Como el proyecto esta dentro de OneDrive, para una demostracion estable se recomienda poner LOCAL_DB_PATH en una carpeta local no sincronizada. Ejemplo: C:/TermioData/termio.db. Para un backup simple, detener el backend y copiar el archivo; no copiar solo el .db mientras hay escrituras WAL activas.

No hay sincronizacion cloud, gestion multiusuario ni cifrado del archivo. Proteger acceso a la PC y al directorio.

## Grupo 5: eventos, no mediciones convertidas en alarmas

Configurar group5_delivery en groups.json. Viene enabled=false. Antes de habilitarlo, acordar el protocolo con Grupo 5 y usar un entorno de prueba separado.

Solo se encolan NUEVOS registros event con critical, alert_evaluated=true, clock_synced=true, entorno igual al destino y edad menor que max_event_age_seconds. No se inventan umbrales ni se generan eventos a partir de un reading critical. El productor debe publicar el evento o se debe implementar otra regla explicita acordada.

Nunca se reenvian alert ni confirmation; tampoco eventos originados por Grupo 5. Evita ciclos. Simulated/mixed solo se pueden enviar si destino=test y allow_simulated=true. Nunca hacia operational. La antiguedad se vuelve a comprobar antes de enviar; los pendientes vencidos se marcan expired, no activan alertas historicas al reconectar.

La outbox se persiste junto con el evento. Reintentos de red/5xx usan el mismo ID y contenido, con espera progresiva. Grupo 5 DEBE deduplicar: si su respuesta se pierde puede recibir otra vez el mismo evento. Errores permanentes 400/401/403/404/409/413/415/422 se marcan failed; tras corregir la causa, revisar y reencolar manualmente con criterio, no se reintentan indefinidamente.

POST a events_path. Respuesta acordada requerida, HTTP 200 o 201:

```json
{"record_id":"UUID_ORIGINAL_DEL_EVENTO","duplicate":false}
```

Se marca SOLO technical_receipt. No significa sirena ejecutada ni reconocimiento humano. Alertas y confirmaciones de ejecucion se obtienen de los registros de Grupo 5 mediante GET /records y se muestran en el dashboard. Este cuerpo de acuse es un acuerdo de implementacion que deben confirmar con Grupo 5; el contrato no fija su forma exacta.

Habilitar entrega NO reencola retroactivamente todo el historial. Solo nuevos eventos elegibles; evita disparos accidentales. outbox y diagnostico se ven en GET /api/v1/dashboard?environment=test en esta PC. La pantalla sigue mostrando alertas reales del Grupo 5, no inventa alertas por un acuse HTTP.

## API propia y archivos clave

- GET /api/health: estado de proceso/SQLite y cantidad de fuentes habilitadas.
- GET /api/v1/dashboard?environment=test: nodos, historial reciente, snapshots, alertas, conexiones y outbox. Es un read model interno para React.
- GET /api/v1/records?environment=test&limit=100&cursor=...: coleccion del contrato. Cursor opaco y separado por entorno.
- POST /api/v1/records: recepcion opcional, autenticada por token INGEST_TOKEN de una fuente habilitada; 201 nuevo, 200 duplicado, 409 conflicto, 422 invalido. Solo loopback en esta version.

No se implementa aqui un servidor accesible desde otras PC/ESP32: el mecanismo inicial es pull. Para habilitar push LAN hay que agregar escucha LAN y controles de acceso adecuados; no basta con cambiar 127.0.0.1 por 0.0.0.0 sin revisar seguridad. No se expone un endpoint central /status normalizado ni /alerts porque los requerimientos de consulta del contrato corresponden a las APIs productoras; el centro ofrece los endpoints anteriores.

- backend/src/config.ts: carga y validacion de configuracion.
- backend/src/poller.ts: GET, cursores, workers y POST al Grupo 5.
- backend/src/store.ts: SQL, transacciones, duplicados y modelos de lectura.
- backend/src/server.ts: API local y archivos del frontend.
- backend/src/main.ts: arranque y cierre.
- src/lib/local.ts: cliente de la API local.

## Verificacion

npm.cmd test ejecuta pruebas existentes y nuevas de SQLite, persistencia al reabrir, duplicados/conflictos, rollback del cursor, unidades, historial atrasado, separacion de entornos, tres fallos, paginacion, envio Grupo 5 y autenticacion de escritura. npm.cmd run build comprueba TypeScript y genera el frontend.

Las pruebas usan datos simulados/servidores locales. NO verifican hardware, IP reales, cobertura del access point, capacidad para seis clientes ni protocolos reales de los demas grupos. La prueba fisica final debe realizarse con todas las placas conectadas y sus endpoints acordados.

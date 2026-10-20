# Configurar las consultas desde el dashboard (modo offline)

**Actualización:** el firmware ahora admite reservas DHCP MAC → IP desde el editor. Ver `DIAGNOSTICO_WIFI_Y_RESERVAS.md` para rangos, reconexión de clientes, persistencia en ESP32 y prueba de pérdida Wi-Fi.

## Flujo implementado

Dashboard React → backend Node local → comando por USB → ESP32 Access Point → GET HTTP a la API del grupo → respuesta por USB → validación del contrato → SQLite → tarjetas / historial.

La PC puede estar en una Wi-Fi distinta. El ESP32 es quien tiene acceso a los clientes de ESP32_AP_MAIN. No se diagnostican APIs de esa red con curl desde una PC desconectada de ella. Los productores NO necesitan enviar POST para este flujo. El navegador consulta únicamente el backend local, sin CORS ni acceso directo a IPs de los grupos.

## Uso

1. ESP32 conectado por USB, firmware de puente cargado. Cerrar el monitor serie de Arduino: el backend necesita el puerto exclusivo.
2. Ejecutar `npm run local:start` en la carpeta del proyecto y abrir http://127.0.0.1:3001.
3. Abrir **Configurar equipos y endpoints · ESP32**.
4. Elegir identidad del productor, MAC Wi-Fi, puerto HTTP, entorno y rutas GET. Se admiten equipos adicionales. El campo IP fija permite reservar 192.168.4.2–99 para esa MAC. Vacío mantiene asignación dinámica (.100–199). Las reservas no son autenticación.
5. **Guardar configuración** persiste el catálogo en `local_settings` dentro de SQLite y envía las reservas al firmware. Esperar «Puente USB listo» para confirmar aplicación. Cambiar reservas puede desconectar clientes para renovar DHCP; cambiar canal puede interrumpir Wi-Fi. No requiere reflashear una vez instalada la versión de reservas. Una petición en curso finaliza antes de aplicar el catálogo nuevo. Con pausa activada se aplica la configuración, pero no se inicia otro GET automático.
6. **Consultar APIs ahora** o **Actualizar** solicita GETs nuevos. El backend también consulta automáticamente con el intervalo configurado. El dashboard vuelve a leer SQLite cada 10 segundos.

## Endpoints

Se configura cada finalidad por separado:

- Estado / medición: normalmente `/api/v1/status`. Incendios usa actualmente `/api/incendios`, puerto 8081. Esta ruta adaptada puede devolver el registro reading que ya expone ese equipo; el contrato propone state para status.
- Historial: `/api/v1/records`.
- Alertas: `/api/v1/alerts`.

**Usar rutas del contrato** completa las tres rutas, pero sólo deben habilitarse las que el productor realmente implemente. Una ruta vacía no se consulta. Se ingresa sólo `/ruta`, sin URL completa, sin query ni credenciales. El backend añade `limit=100` y cursor en colecciones. Cada colección debe devolver `{items:[],next_cursor:null,has_more:false}`. Se procesan hasta cinco páginas por finalidad en cada ronda y se continúa desde el cursor persistido en la siguiente. Un cursor sólo se guarda en la misma transacción que los registros aceptados; un error no lo adelanta.

Los puertos 80 sugeridos para equipos nuevos son provisionales: confirmarlos con el grupo. Configuración inicial: Incendios EC:8E:77:10:D4:E8; Energía 74:97:79:51:DD:C1; Volcánico 3C:58:C2:A4:54:BB. Inundaciones 38:87:D5:BC:7C:67 queda desactivado hasta confirmar identidad: el contrato identifica al Grupo 2 como volcánico y al Grupo 4 como agua. Seleccionar el nodo que corresponda al JSON real, sin cambiar silenciosamente su group/subsystem.

## Datos simulados y duplicados

En modo local NO se cargan fixtures del frontend. “Origen del dato: Simulado” refleja `metadata.source_type` recibido de la API, que puede estar sirviendo sensores simulados. No se debe cambiar a real sólo porque el transporte HTTP funcione.

El ejemplo de Incendios compartido conserva fecha 2026-10-16T11:00:00Z y UUID 5d9f1e9b-5215-4f78-90b3-5cad42a7a390. Repetirlo confirma comunicación pero no constituye una medición nueva. El mismo UUID con contenido idéntico no duplica filas; con contenido distinto se rechaza. Cada medición nueva necesita nuevo UUID y fecha de medición; un reintento conserva ambos.

## Componentes y límites

- `src/BridgeSettings.tsx`: editor en el dashboard.
- `backend/src/bridge-config.ts`: configuración y validación.
- `backend/src/bridge.ts`: planificador de GETs y comandos USB.
- `backend/src/serial.ts`, `scripts/serial-reader.py`: USB bidireccional / JSON.
- `firmware/termio_access_point/termio_access_point/bridge_runtime.h`: Access Point y ejecución HTTP de los comandos; las funciones legacy de .ino ya no se ejecutan.
- `backend/src/store.ts`: validación, deduplicación, registros, configuración y cursores SQLite.
- API local: GET/PUT `/api/v1/bridge/config`, POST `/api/v1/bridge/poll`, GET `/api/v1/dashboard`.

El backend sólo escucha loopback y comprueba Host/Origin. El editor no configura tokens de autenticación remota: las APIs de estas pruebas son HTTP local sin token. No se agregaron POST automáticos ni activación de sirenas. La integración de eventos hacia Grupo 5 es una función separada, no se presume resuelta por recibir HTTP 200.

Límites USB: cuerpo 64 KiB, colección hasta 100 registros. Hasta 16 entradas de catálogo, pero la cantidad de estaciones Wi-Fi simultáneas depende de los límites de la placa y del Access Point (se solicita máximo 8). Si cambia la MAC privada de un cliente hay que actualizar su entrada.

## Verificación sin depender de la LAN

- `npm test`: incluye configuración, identidad esperada y cursores transaccionales.
- `npm run local:build`: TypeScript + Vite offline.
- `python3 scripts/verify-serial-pty.py --ui`: compatibilidad con tramas seriales, deduplicación, rechazos y tarjetas.
- `python3 scripts/verify-bridge-pty.py`: ESP simulado en pseudoterminal; edición real en Playwright, persistencia de catálogo, comando GET USB, respuesta, SQLite y frontend. Usa una base temporal, nunca inserta datos de prueba en la base de trabajo.

Estas pruebas no reemplazan la verificación con las APIs reales de los grupos conectados al Access Point.

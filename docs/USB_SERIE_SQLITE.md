# ESP32 por USB -> SQLite -> frontend

Implementado en Linux (CachyOS/Arch) usando Python 3 y bibliotecas estandar, sin pyserial ni servicios en Internet.

## Arranque

```bash
cd "$HOME/Downloads/~"
npm run local:start
```

Abrir http://127.0.0.1:3001. El perfil `offline` compila React con `VITE_DATA_SOURCE=local`, incluso si quedaron variables de Supabase en `.env.local`. No cambia ni utiliza esas credenciales. SQLite se crea en `data/termio.db`.

En `.env.backend` se configuro:

```dotenv
SERIAL_PORT=auto
SERIAL_BAUD=115200
```

- `auto`: abre el unico dispositivo `/dev/ttyUSB*` o `/dev/ttyACM*`, prefiriendo su enlace `/dev/serial/by-id/`. Si hay varios, NO adivina.
- Para elegir: `ls -l /dev/serial/by-id/` y configurar `SERIAL_PORT=/dev/serial/by-id/NOMBRE_REAL`.
- `SERIAL_PORT=off`: deshabilita USB y conserva el polling HTTP configurado.
- Cerrar el monitor serie y el plotter de Arduino antes de iniciar. Detener el backend con Ctrl+C antes de flashear.
- Reconexion automatica cada 3 segundos; usar un enlace by-id para evitar abrir otro dispositivo al reconectar.

## Flujo y compatibilidad

El ESP32 hace los GET de su firmware y transmite el cuerpo por USB. El backend separa logs del JSON, valida el mismo contrato de SQLite y persiste antes de presentarlo en la API. El frontend consulta cada 10 segundos, o al pulsar Actualizar.

No hace falta reflashear el sketch actual si imprime:

```text
HTTP: 200
--- INICIO DE RESPUESTA ---
{ JSON normalizado completo, en una o varias lineas }
--- FIN DE RESPUESTA ---
```

Tambien admite `--- RESPUESTA ---`/`--- FIN ---` y registros JSON de una sola linea sin logs mezclados. Solo ingiere frames HTTP 200. Limite: 64 KiB por cuerpo; colecciones de hasta 100 registros, transaccion atomica. Una coleccion se ingiere pero esta implementacion no controla cursores del ESP32 ni solicita automaticamente paginas faltantes.

Solo se captura lo emitido DESPUES de abrir el puerto: el contenido historico del monitor de Arduino no se recupera. El USB no implementa confirmacion de persistencia al ESP32, cola durable ni recuperacion de bytes perdidos; repetir registros con el mismo record_id permite deduplicar, pero para recuperacion completa el productor debe exponer historial. No afirmar entrega garantizada.

La tabla `serial_receipts` conserva la ultima recepcion valida por nodo y entorno, incluso para duplicados. La comunicacion reciente no vuelve actual una medicion antigua: timestamp y clock_synced mantienen sus reglas. Los datos sin reloj sincronizado quedan en Registros, no en los snapshots vigentes.

## Identidad, fechas y duplicados

`backend/config/nodes.json` es el registro de identidades y unidades admitidas. No se reescribe el productor segun la etiqueta que imprime el firmware. En los archivos traidos el Grupo 2 sigue registrado como nodo volcanico y el agua es Grupo 4 segun el contrato original. Si acordaron inundaciones como Grupo 2, hay que acordar y registrar node_id, subsystem y unidades REALES de ese JSON; no se inventan ni convierten silenciosamente.

Un JSON con el mismo record_id y contenido identico no agrega otra fila. Una medicion nueva necesita UUID nuevo; mismo ID con contenido diferente se rechaza con RECORD_CONFLICT. Los datos simulados siguen marcados como tales. Las fechas antiguas no se sustituyen por la fecha de recepcion.

Los rechazos dejan codigo y campos en `rejections`, sin persistir el cuerpo rechazado completo. El frontend muestra estado USB, ultimo JSON aceptado y contadores desde el arranque. Un puerto abierto no prueba que un productor este enviando mediciones.

## Permisos Arch/CachyOS

Si aparece SERIAL_PERMISSION_DENIED, identificar primero el grupo del dispositivo:

```bash
ls -l /dev/ttyUSB* /dev/ttyACM*
```

Si el dispositivo pertenece al grupo `uucp`, el usuario puede ejecutar:

```bash
sudo usermod -aG uucp "$USER"
```

Cerrar sesion de escritorio y volver a entrar. No usar chmod 777 ni ejecutar el backend como root. El agente no realizo cambios de grupos ni de permisos del sistema.

## Pruebas

```bash
npm test
npm run local:build
python3 scripts/verify-serial-pty.py
# Opcional, con Chromium de Playwright instalado:
python3 scripts/verify-serial-pty.py --ui
```

La prueba PTY utiliza un puerto virtual, SQLite temporal en disco, el lector real y la API real; no inserta datos simulados en la base de trabajo. No equivale a probar el ESP32 fisico.

## Archivos

- `backend/src/serial.ts`: parser, ingesta y reconexion.
- `scripts/serial-reader.py`: transporte USB Linux a 115200.
- `backend/src/store.ts`: transacciones, recibos y read model.
- `src/App.tsx`: banner de diagnostico y vistas existentes.

La recepcion serie confia en el dispositivo USB elegido y aplica validacion de contrato; no autentica criptograficamente al productor remoto. La configuracion de envio de eventos al Grupo 5 sigue independiente y deshabilitada por defecto.

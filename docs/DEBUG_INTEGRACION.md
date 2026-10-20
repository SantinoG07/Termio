# Diagnostico ESP32 -> SQLite -> web

Abrir http://127.0.0.1:3001 y recargar la pagina para cargar el frontend nuevo. Panel: **Diagnostico ESP32 -> SQLite -> web**, debajo del estado USB. Se actualiza cada 10 segundos; Actualizar fuerza otra consulta al backend, no una peticion adicional del ESP32.

No hace falta reflashear para el debug: aprovecha las lineas que ya imprime el firmware. No abrir simultaneamente el monitor serie de Arduino.

## Etapas

1. **AP:** cantidad de estaciones asociadas y MAC/IP que conoce DHCP. Un cliente con IP estatica puede aparecer sin IP en esta tabla. La asociacion Wi-Fi no demuestra que tenga una API.
2. **Busqueda por MAC:** si dice MAC no encontrada / sin IP DHCP, comprobar MAC permanente, IP automatica y pertenencia a nuestra red. Las MAC aleatorias no coinciden con el array.
3. **GET:** URL realmente consultada. El puerto es parte de la configuracion del firmware, no lo fija el contrato. Se eliminan credenciales/query/fragmentos del diagnostico de URLs.
4. **HTTP:** HTTP 200 permite procesar el cuerpo. 404 indica ruta incorrecta; 401/403 autenticacion; 5xx servidor. connection refused es el error de conexion que informa HTTPClient: revisar servidor apagado, puerto incorrecto, binding local o firewall; esa etiqueta no distingue de forma definitiva todas las causas de fallo TCP.
5. **SQLite:** nuevo guardado, duplicado ya existente, o rechazo de validacion. Los rechazos conservan campos/causas y se muestran sin cuerpos completos ni tokens.
6. **Frontend:** usa el entorno seleccionado, refresca cada 10 segundos y mantiene la antiguedad REAL del dato, no la fecha de recepcion.

Los eventos tecnicos se limitan a 60 entradas en memoria. Los contadores y el debug se reinician con el backend; SQLite no pierde registros. Cada fila muestra la hora de su ultimo intento, no una garantia de conectividad actual. El numero de clientes tambien es la ultima observacion del firmware.

## Repeticion de registros

Si el productor devuelve siempre el mismo record_id y contenido, se almacena una sola fila. Una nueva medicion necesita record_id nuevo y timestamp real. Reintentos del mismo registro conservan ambos. Nunca inventar UUID o sustituir el timestamp en el centro para disimular una fuente congelada.

## Comprobacion en el equipo productor

Ejemplo Grupo 1, puerto 8081:

```bash
curl --connect-timeout 5 http://127.0.0.1:8081/api/incendios
curl --connect-timeout 5 http://192.168.4.2:8081/api/incendios
```

Ejemplo Grupo 3, puerto provisional 80:

```bash
curl --connect-timeout 5 http://127.0.0.1:80/api/v1/status
curl --connect-timeout 5 http://192.168.4.4:80/api/v1/status
```

Si el servidor usa otro puerto, informar el puerto REAL y cambiar el array EQUIPOS del firmware, luego compilar y cargar. Configurar el servidor para escuchar en 0.0.0.0 o su IP Wi-Fi, no solo en 127.0.0.1. Permitir el puerto necesario en el firewall, sin desactivar toda la proteccion.

## Pruebas de software

```bash
npm test
npm run local:build
python3 scripts/verify-serial-pty.py --ui
```

Cubren parsing, ocultamiento de credenciales, limites, flujo por puerto virtual, persistencia SQLite y frontend. No sustituyen verificar que cada API de los grupos responda en la LAN.

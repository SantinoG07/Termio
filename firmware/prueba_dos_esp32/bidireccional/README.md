# Dos ESP32: ambos clientes y servidores

Esta es la variante bidireccional. Usar bidireccional.ino en AMBAS placas, no los sketches emisor/receptor anteriores. No se han compilado ni probado en hardware estos archivos desde el entorno del agente.

Requiere Arduino-ESP32, ArduinoJson 7.x y particion con sistema de archivos. LittleFS viene con el core. Ambas placas deben compartir LAN con trafico entre clientes permitido. HTTP con token en claro solo para red de confianza; no exponer a Internet.

## Configurar

Copiar config.example.h como config.h. Wi-Fi y TEST_TOKEN (minimo 24 caracteres) iguales en ambas placas.

- A: NODE_ID="esp32_a", PEER_NODE_ID="esp32_b", PEER_BASE_URL="http://IP_DE_B".
- B: NODE_ID="esp32_b", PEER_NODE_ID="esp32_a", PEER_BASE_URL="http://IP_DE_A".

Primero cargar cada placa con Wi-Fi y token para descubrir su IP en Monitor Serie 115200. La URL provisional del otro puede fallar: el servidor sigue disponible. Despues colocar las IP correctas y volver a cargar cada placa con SU configuracion. Si usan una sola carpeta/sketch en Arduino IDE, recordar cambiar las tres constantes al cambiar de placa. No copiar ni publicar config.h con secretos. Reservar direcciones DHCP en el router evita que cambien entre reinicios.

Si LittleFS no monta: revisar particion. Solo sin archivos que conservar, permitir FORMAT_FS_ON_MOUNT_FAILURE=true para inicializar al fallar el montaje; borra el sistema de archivos. Volver a false y cargar nuevamente tras inicializar. No activar borrado completo de flash en cargas normales.

## Comportamiento

Cada placa expone GET /api/status, POST /api/readings y GET /api/log con Authorization: Bearer TEST_TOKEN.
Una tarea FreeRTOS separada hace GET al otro nodo y, si responde ready con la identidad esperada, POST con un contador simulado. El servidor se atiende en loop: una espera del cliente HTTP no bloquea el servidor. Funciona como concurrencia de tareas incluso en chips de un solo nucleo; no es ejecucion literalmente simultanea de cada instruccion.

Cada nodo guarda SOLO los POST recibidos en su propio /registros.txt. Los GET no agregan registros. No reenvia lo recibido: evita bucles A->B->A. Limite 128 KiB por archivo; devuelve 507 cuando se llena. No tiene deduplicacion, cola ni reintentos de mensajes fallidos. Una respuesta perdida puede dejar ambiguo si se guardo. uptime_ms no es una fecha. JSON de prueba, NO contrato normalizado Termio ni sensores ambientales reales.

Monitor de ambos: [SALIDA] GET -> 200, [SALIDA] POST -> 201 y [ENTRADA] POST guardado. La salida Serial de tareas puede intercalarse. Reiniciar conserva el archivo si no se formatea, borra o cambia de particion.

## Descargar un archivo desde PowerShell

Reemplazar IP_REAL por A o B y nombre de salida por registros-a.txt o registros-b.txt:

```powershell
$token = Read-Host 'TEST_TOKEN' -AsSecureString
$headers = @{ Authorization = "Bearer $([System.Net.NetworkCredential]::new('', $token).Password)" }
Invoke-WebRequest -Uri 'http://IP_REAL/api/log' -Headers $headers -OutFile '.\registros-a.txt' -TimeoutSec 10
Remove-Variable token, headers
```

401: token distinto. 503: token sin completar o FS no listo. 422: identidad/formato incorrecto. 507: archivo lleno. Codigos HTTPClient negativos: revisar red/IP. Sin identidad correcta en GET no envia POST.

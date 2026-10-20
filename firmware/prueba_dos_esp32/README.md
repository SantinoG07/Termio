# Prueba HTTP entre dos ESP32

Prueba aislada: no modifica termio_node, no conecta Supabase y NO implementa el contrato normalizado de Termio. test_value es un contador simulado, no una medición ambiental. No se ha compilado ni probado en hardware desde este entorno.

## Flujo

Emisor -- GET /api/status --> receptor responde estado.
Emisor -- POST /api/readings --> receptor agrega una línea JSON a /registros.txt en LittleFS y responde 201.
PC -- GET /api/log con Bearer --> descarga el texto.

Los dos ESP32 deben estar en la misma LAN Wi-Fi con comunicación entre clientes habilitada. No se conectan entre sí por cables GPIO. Alimentar cada placa por USB. HTTP con token en claro: solo LAN de confianza, no abrir puertos a Internet.

## Preparación

Instalar Arduino-ESP32 y ArduinoJson 7.x en Arduino IDE. LittleFS viene con el core ESP32. Elegir el modelo real de placa y una partición con espacio para sistema de archivos.

En cada carpeta (receptor y emisor), copiar config.example.h como config.h. Completar Wi-Fi y TEST_TOKEN privado de al menos 24 caracteres, exactamente igual en ambas placas. Los config.h quedan ignorados por Git. No copiar credenciales al ejemplo público.

1. Cargar receptor/receptor.ino en la placa receptora. Monitor Serie a 115200.
2. Si LittleFS no monta, revisar partición. Solo si NO hay datos que conservar, poner FORMAT_FS_ON_MOUNT_FAILURE=true para permitir formatear si falla el montaje. Cargar, verificar LittleFS listo, volver a false y cargar de nuevo. Formatear elimina los archivos de esa partición.
3. Anotar IP RECEPTOR. En emisor/config.h colocar RECEIVER_BASE_URL=http://IP_REAL sin ruta /api y sin credenciales.
4. Cargar emisor/emisor.ino en la otra placa. Elegir su puerto, que puede ser distinto al del receptor.
5. Esperar GET 200 y POST 201 en su monitor. El receptor imprime POST guardado y el ID.

El archivo reside en la memoria flash del receptor, no en Windows. Persiste al reiniciar, pero no frente a borrado/formateo o cambios de partición. Límite 128 KiB; al llenarse devuelve 507 y no borra registros. Este demo no tiene borrado remoto, deduplicación, cola ni reintentos de POST. Si se pierde una respuesta no se garantiza saber si se guardó. Los uptime_ms no son fechas de calendario. No es una solución de producción.

## Descargar desde PowerShell (reemplazar IP)

```powershell
$token = Read-Host 'TEST_TOKEN del receptor' -AsSecureString
$headers = @{ Authorization = "Bearer $([System.Net.NetworkCredential]::new('', $token).Password)" }
Invoke-WebRequest -Uri 'http://IP_REAL/api/log' -Headers $headers -OutFile '.\registros-esp32.txt' -TimeoutSec 10
Remove-Variable token, headers
```

Errores: 401 token distinto; 503 token sin configurar o almacenamiento no listo; 422 JSON no válido; 507 archivo lleno; códigos negativos HTTPClient: conexión/red. Abrir la URL sin encabezado Authorization devuelve 401, no es un fallo del servidor.

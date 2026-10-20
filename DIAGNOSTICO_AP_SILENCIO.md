# Incidente: AP desaparece con placa alimentada

Inspección sin reinicio, sin abrir otro monitor serie, sin volver a cargar firmware y sin consultas a la LAN 192.168.4.x. Diagnóstico iniciado con el backend existente; el ESP permanece en el estado del fallo.

## Evidencia observada

- Backend Node y lector serie Python siguen ejecutándose, proceso lector 33877. Único proceso con /dev/ttyUSB0 abierto.
- Dispositivo CP2102/ttyUSB0 presente. No hubo coincidencias de desconexión/reconexión USB en la consulta al journal del kernel de los últimos 25 minutos.
- Los contadores /proc del lector aumentan 26 bytes recibidos/escritos entre muestras separadas 3,2s: corresponden al comando hello enviado periódicamente por el backend. El proceso lector no está detenido.
- El contador de datos procedentes del ESP permanece en 149720 bytes; último byte recibido 2026-10-20T18:10:20.398Z (15:10:20 UTC-3).
- Última medición aceptada: fire_node_01, record_id 66fb4f06-af2b-42a1-b97e-2831658b5d58, timestamp 2026-10-20T18:10:08Z, recibida 18:10:09.303Z.
- Antes del incidente se reportaban seis estaciones asociadas.
- Última telemetría de red: uptime_s=0, reset_reason=3 (ESP_RST_SW), clientes=0, heap=193040, min_heap=191532, canal6, contadores DHCP0.
- Aún se procesaron cuatro consultas (MAC_NOT_FOUND) y comandos de LED durante ese arranque. Después cesaron completamente los mensajes, incluidas las telemetrías que debían llegar cada cinco segundos.
- El backend terminó la siguiente espera con ESP32_COMMAND_TIMEOUT; ready=false. configured=true es un valor retenido del último ACK, no evidencia de que el AP siga funcionando.
- Los últimos LED confirmados eran todos apagados.
- No se encontraron llamadas explícitas ESP.restart/esp_restart ni desconexión/parada Wi-Fi en el firmware activo. WiFi.mode(WIFI_AP) se usa al iniciar.

## Interpretación y límites

Hay evidencia de un arranque reciente con motivo registrado como reinicio por software y de pérdida posterior de respuesta del firmware. No es simplemente una API remota rechazada, un filtro test/operational ni un error de SQLite. Que el LED de alimentación esté encendido no verifica ejecución del procesador ni emisión de Wi-Fi.

No se puede determinar todavía quién provocó ese reinicio ni la causa del silencio posterior (bloqueo del firmware/controlador, alimentación u otra causa). reset_reason=3 no es el código de brownout ni el de watchdog; no demuestra por sí solo que se pueda descartar una falla eléctrica en el incidente completo. La memoria reportada corresponde al arranque nuevo, no permite excluir un fallo de memoria anterior.

Limitación encontrada: el lector transporta bytes sin persistir la salida UART completa; el parser conserva diagnóstico estructurado pero no todas las líneas de arranque/pánico ni un historial de telemetría. Por ello no existe una traza de pila guardada para atribuir el fallo a una función concreta. No se debe afirmar una causa exacta sin más evidencia.

## Próxima intervención recomendada (requiere reinicio/carga)

1. Captura UART cruda acotada/rotativa y registro de arranque, errores, telemetría y transiciones de Wi-Fi, sin contraseñas; sin mezclarlo con los registros de mediciones.
2. Registrar última operación y etapas de arranque para diferenciar bloqueo en HTTP, USB, Wi-Fi, DHCP y telemetría.
3. Watchdog explícito del loop con tiempos mayores a los límites HTTP, y recuperación controlada del AP ante errores, sin reinicios por una mera falla de un productor.
4. Corregir estado de backend: invalidar configured al detectar pérdida/reinicio y exponer telemetría vencida.
5. Si reaparece, capturar causa/traza antes de otro cambio. Revisar USB, alimentación y cableado sin atribuirles la causa de antemano.

Este archivo solo preserva el diagnóstico; no modifica ni reinicia la placa.

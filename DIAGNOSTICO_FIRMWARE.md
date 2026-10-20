# Firmware de diagnóstico termio-diag-1

Complementa DIAGNOSTICO_AP_SILENCIO.md. Se conservan AP, DHCP/reservas, consultas USB, API central y los cinco LED. No habilita buzzer ni cambia MAC/IP/endpoints.

## Evidencia que se guardará desde esta versión

- `backend/data/serial-diagnostic.log`: registro de arranque, logs de sistema, backtrace si se emite, eventos Wi-Fi, telemetría y protocolo estructurado. Rotación de 1MiB, hasta tres archivos; permisos0600; ignorado por Git.
- No duplica cuerpos de mediciones ni registros JSON independientes; conserva líneas reconocidas de panic incluso si ocurren durante una respuesta. Omite líneas con indicios de secretos y elimina credenciales/query de URLs. Por eso no es una captura binaria UART íntegra.
- La ruta se puede cambiar con SERIAL_DIAGNOSTIC_LOG. Una falla del registro se expone como log_error y no detiene la recepción de mediciones.
- Solo local: GET http://127.0.0.1:3001/api/v1/diagnostics. Incluye último arranque, últimas100 etapas/eventos, fecha de telemetría, indicador telemetry_stale y error de registro. No se publica mediante la API del AP.

## Firmware

- Informa reset_reason, boot_id y previous_stage (marca RTC del arranque anterior cuando se conserva; un corte de energía puede borrarla).
- Etapas:1inicio;2inicioWiFi;3APconfigurado;4DHCPiniciado;10loop/diagnóstico;11loopcompletado;20configuración;30prepararGET;31esperarHTTP;32leerbody;40APIcentral;50telemetría;90reinicio de recuperación AP.
- Captura AP_START/AP_STOP y conexión/desconexión de estaciones con una cola acotada. El callback Wi-Fi no escribe al puerto serie ni ejecuta consultas.
- Watchdog explícito del loop35s con panic/reinicio. Un bloqueo debe producir diagnóstico y recuperación cuando el watchdog pueda actuar; no sustituye una alimentación correcta ni garantiza recuperación de todo fallo físico.
- Comprueba cada5s modo AP y eventos AP_STOP. Tras tres comprobaciones fallidas reinicia con evento ap_recovery_restart y etapa90. No reinicia por tener cero clientes ni por fallas de APIs productoras. Esto no verifica físicamente que las balizas de radio sean visibles.
- Limita lectura de comandos serie a1024 caracteres por vuelta; mantiene las líneas completas hasta4096 bytes.
- Cuerpo HTTP saliente limitado a64KiB y límite adicional15s comprobado al escribir fragmentos; siguen los timeouts3s conexión/5s lectura. Una lectura bloqueada puede tardar ese timeout adicional; el watchdog35s limita bloqueos del loop más largos.

## Backend

- Al recibir un nuevo boot_id invalida trabajo/configuración/estados LED anteriores, conserva el registro de arranque y renegocia el puente.
- También detecta retroceso de uptime como señal de reinicio para firmware previo.
- Ante timeout de un comando o silencio en periodos ociosos invalida ready y configured; el USB abierto no se confunde con una placa respondiendo.
- Un arranque a mitad de una respuesta incompleta cancela ese cuerpo y no lo acepta como JSON de medición.

## Prueba de uso

Mantener USB y backend activos. Reconectar los equipos al AP y observar al menos15min (el incidente anterior apareció aproximadamente a los9min). Si vuelve a desaparecer, avisar antes de desenchufar; revisar último evento/etapa, motivo de arranque y registro serie. La causa original aún no se considera resuelta solo porque la nueva carga arranque correctamente.

# Hallazgo confirmado tras cargar diagnóstico

La carga de termio-diag-1 terminó con UPLOAD_EXIT0 y hash verificado. No fue necesario desenchufar para programar.

La nueva captura, sin vaciar UART al iniciar el backend, registra repetidamente:

```
E BOD: Brownout detector was triggered
rst:0x3 (SW_RESET),boot:0x13 (SPI_FAST_FLASH_BOOT)
TERMIO_BRIDGE {"event":"boot",...,"reset_reason":9,...}
```

Entre 18:28:52Z y 18:29:42Z del 20/10/2026 se observaron aproximadamente50 arranques por brownout. La última etapa informada antes de cada uno es wifi_initializing (~580ms desde arranque). El watchdog informa activación correcta, pero estos reinicios suceden antes de su plazo35s; no los provoca su vencimiento.

Esto confirma caída de tensión detectada por el ESP32 en el estado actual. No identifica todavía el componente responsable: cable/puerto USB, contacto, regulador, carga o corto externo. El LED rojo de alimentación encendido no descarta una caída breve en la alimentación del procesador. Las resistencias220ohm por LED común son razonables; no se atribuye automáticamente el fallo a ese valor.

El registro ROM SW_RESET no contradice el diagnóstico de brownout reportado por BOD y reset_reason9 del SDK. Por eso el motivo3 observado anteriormente, sin el mensaje bruto BOD, no bastaba para descartar alimentación. No puede afirmarse retrospectivamente que todos los fallos previos tuvieron idéntica causa.

Siguiente prueba física indicada al usuario: desconectar USB, retirar cargas/cables externos (cinco GPIO13/14/25/26/27 y cualquier buzzer conectado), reconectar placa sola por cable USB de datos confiable directo a la PC. No manipular cableado energizado. Si se estabiliza, reconectar circuitos uno por uno apagando antes de cada cambio; si no, probar cable/puerto y revisar placa/regulador. No unir fuentes externas a ciegas.

Se mantiene habilitado el detector de brownout. No se vuelve a flashear durante la inestabilidad de alimentación. El backend queda preparado para capturar el próximo arranque cuando el usuario reconecte.

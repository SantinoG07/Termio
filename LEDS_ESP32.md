# Indicadores físicos del AP

GPIO activos en HIGH; una resistencia de 220 ohm por LED en serie entre GPIO y ánodo; cátodo a GND común.

| Grupo | LED / GPIO |
|---|---|
| 1 Incendios | 13 |
| 2 Volcánico | 14 |
| 3 Energía | 25 |
| 4 Agua / inundaciones | 26 |
| 5 Comunicaciones | 27 |

No se controla el buzzer; GPIO32 no se configura como salida. Falta identificar su tipo, voltaje y consumo antes de conectarlo.

## Significado

Un LED se enciende después de que la consulta configurada como estado/medición finalice correctamente, el backend valide y persista el JSON (también admite un duplicado válido), y el registro cumpla:
- Identidad del nodo esperado.
- `metadata.environment: operational` y equipo configurado para ese entorno.
- `metadata.source_type: real` (no simulated ni mixed).
- `metadata.clock_synced: true`.
- `status: active`.
- Fecha de medición vigente: no más de tres intervalos esperados, con mínimo de 30 segundos. Se mantiene el margen de fechas futuras de hasta cinco minutos usado por el validador.
- Última consulta válida reciente: no más de tres intervalos de consulta, con mínimo de 30 segundos.

No basta con estar conectado al AP ni con devolver HTTP200 si el contrato falla. Una respuesta de historial no enciende por sí sola el LED. Un fallo de la siguiente consulta de estado/medición lo apaga; también lo apagan datos vencidos, un equipo deshabilitado o cambios en su configuración hasta una nueva respuesta correcta.

Los LED indican disponibilidad de datos, **no ausencia de peligro**. No se implementó parpadeo por riesgo ni buzzer en esta etapa.

El backend envía `TERMIO_CMD {"op":"leds","groups":[true,false,false,false,false]}` por USB después de las consultas y durante periodos ociosos. El orden siempre es Grupos1..5, independientemente del orden de equipos en la dashboard. Las MAC/IP/endpoints siguen editándose en la dashboard, sin recompilar.

El ESP confirma los cinco estados aplicados con un evento `leds`. La API local `http://127.0.0.1:3001/api/v1/leds` muestra `requested`, `acknowledged` y `last_ack_at`. La confirmación verifica el comando aplicado por firmware, no detecta eléctricamente que el LED esté correctamente cableado.

Al arrancar quedan apagados. Si el firmware no recibe una actualización de LED durante 15 segundos, apaga todos al volver a atender su loop. Una consulta HTTP saliente bloqueante puede retrasar unos segundos esta atención. Sin backend/USB no quedan encendidos indefinidamente.

## Archivos
- `backend/src/indicators.ts`: elegibilidad y vencimiento.
- `backend/src/bridge.ts`: usa únicamente respuestas validadas y persistidas, y ordena estados físicos.
- `firmware/termio_access_point/termio_access_point/indicators_runtime.h`: GPIO y watchdog.
- `tests/indicators.test.ts`: producción real, simulación, desconexión, vencimiento y confirmación USB.

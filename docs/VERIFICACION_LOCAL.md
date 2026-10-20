# Verificacion de la implementacion local

Entorno: Windows, Node.js 24.11.0. Se conservaron las modificaciones previas del usuario. No se cambio ni flasheo firmware en esta tarea.

Resultados observados:

- TypeScript: npm.cmd run typecheck, correcto.
- Build: npm.cmd run build, BUILD_EXIT=0.
- Vitest completo: 5 archivos, 47 pruebas aprobadas, TEST_EXIT=0. Incluye 17 pruebas nuevas del backend local.
- Playwright existente: 4 pruebas aprobadas, E2E_EXIT=0, usando Chrome instalado en Windows. No estaba instalado el Chromium headless de Playwright; la configuracion usa Chrome en Windows sin descargar navegadores.
- Prueba integrada scripts/verify-local.mjs: LOCAL_SMOKE_EXIT=0. API HTTP de un grupo simulada -> polling real por loopback -> validacion -> SQLite -> POST a Grupo 5 simulado con recepcion tecnica -> React compilado servido por API local. Verificados escritorio y movil, historial y ausencia de peticiones a servicios externos. Capturas locales en qa/local-desktop.png y qa/local-mobile.png (no versionadas).
- Durante la prueba movil se corrigio un desbordamiento de la tabla de registros, manteniendo scroll dentro de su contenedor.

La prueba integrada usa SQLite en memoria y datos simulados. La persistencia de archivo y reapertura se verifican por separado en Vitest usando una base temporal. El archivo de trabajo data/termio.db se crea al iniciar el backend normal, no se precarga con mediciones ficticias.

Limitaciones de la verificacion:

- No se probaron placas ESP32 reales ni la red access point.
- No se configuraron IP, tokens o endpoints reales de otros grupos.
- Todas las fuentes y el envio a Grupo 5 quedan deshabilitados por defecto.
- No se verifico una sirena, canal digital ni reconocimiento humano reales.
- No se implementa sincronizacion con Supabase ni push desde la LAN. La API escucha solo en esta PC; consulta por GET y envia eventos por POST de forma saliente.
- El protocolo de acuse del Grupo 5 ({record_id,duplicate}) debe confirmarse con ese grupo. No se confunde con ejecucion efectiva de una alarma.

Para repetir la prueba integrada: npm.cmd run build y npm.cmd run test:local. Requiere un navegador compatible instalado solo para pruebas; el funcionamiento normal se abre en el navegador que use el operador.

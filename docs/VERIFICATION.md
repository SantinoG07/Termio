# Verificación del starter

Se ejecutaron correctamente `npm run build`, `npm test`, `npm run test:e2e` y `npm audit`. La auditoría de las dependencias instaladas informó cero vulnerabilidades conocidas en esta ejecución.

Vitest: 22 pruebas aprobadas. Incluyen contrato JSON, datos faltantes y mixtos, selección temporal de snapshots, alertas resueltas y nueve pruebas de migraciones/transacciones/RLS sobre PostgreSQL embebido con PGlite. Auth se representa con roles y una función uid mínimos; no se usa un proyecto de Supabase remoto.

Deno: verificación de tipos del entrypoint Edge aprobada y seis pruebas HTTP del handler aprobadas: método, credencial ausente, Content-Type, JSON inválido, contrato incompleto y tamaño máximo. La persistencia se prueba separadamente en PostgreSQL; las pruebas HTTP no conectan la función a una base remota.

Playwright: cuatro pruebas aprobadas. Cubren dashboard demo, navegación y recarga de rutas, filtros, exportación, detalle con cierre por teclado, separación de entornos, ancho móvil de 390 px sin desbordamiento de página, tema oscuro y formulario de acceso con stub de autenticación. No se probó el inicio de sesión real contra Supabase Auth.

Se inspeccionaron visualmente las capturas de escritorio y móvil, dashboard oscuro, alertas, acceso en escritorio, error de acceso móvil y diálogo de registro. Los resultados están en `qa/` (excluido de Git). No se detectaron solapamientos o desbordamientos en las vistas inspeccionadas.

## Pendiente fuera del workspace

Vincular un proyecto de Supabase, aplicar migraciones allí, desplegar la función Edge, crear usuario y membresía, registrar credenciales por grupo y ejecutar `npm run test:ingest` contra el endpoint real. Conectar el repositorio a Vercel, configurar variables públicas y publicar.

No se desplegó infraestructura remota, no se insertaron datos en una cuenta del usuario y no se almacenaron secretos reales. El modo demo usa únicamente fixtures simulados. Las instrucciones y limitaciones operativas están en README.md.

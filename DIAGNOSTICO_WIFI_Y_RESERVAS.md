# Reservas reales por MAC y diagnóstico de Wi-Fi

## Qué cambió

La versión anterior sólo descubría la IP actual mediante MAC. **Eso no era una reserva DHCP.** Ahora el dashboard tiene un campo **IP fija reservada por DHCP**. El firmware implementa un servidor DHCPv4 acotado al prototipo; se detiene el servidor DHCP estándar de esp-netif para que no respondan dos servidores.

- AP: 192.168.4.1 / 255.255.255.0.
- IP reservables: 192.168.4.2 a 192.168.4.99.
- Clientes sin reserva: 192.168.4.100 a 192.168.4.199.
- Una IP no puede reservarse para dos MAC; una MAC no puede reservar dos IP distintas. Varias APIs en la misma MAC pueden compartir su única reserva.
- Las reservas son independientes del checkbox de consultas GET: se puede reservar IP a una PC sin consultarla.
- MAC real unicast, no nula. Desactivar aleatorización de MAC para esa conexión.
- El cliente debe usar DHCP/IPv4 automático. Si tiene IP estática configurada manualmente, DHCP NO puede sobreescribirla.
- Las reservas se guardan en `local_settings` de SQLite y en Preferences/NVS del ESP32. El backend espera confirmación del firmware antes de declarar aplicada la configuración y enviar GETs.
- No es preciso recompilar/reflashear para modificar las reservas después de cargar esta versión.

### Cómo reservar

1. Abrir http://127.0.0.1:3001, desplegar **Configurar equipos y endpoints · ESP32**.
2. Ingresar la MAC y la IP deseada; por ejemplo EC:8E:77:10:D4:E8 → 192.168.4.12.
3. Guardar y esperar **Puente USB listo**. “Guardada en SQLite” por sí solo no confirma que el firmware la haya aplicado.
4. Cambiar reservas puede desconectar todas las estaciones para forzar una nueva negociación; reconectar manualmente si el cliente no lo hace automáticamente. Un cambio de canal también puede interrumpir la conexión.
5. En el cliente comprobar la dirección recibida (`ip -4 addr` en Linux, `ipconfig` en Windows). Verificar que el servidor de la API siga escuchando en 0.0.0.0 y en el puerto correcto.
6. Consultar APIs desde el panel. En el debug se muestra la IP obtenida de una concesión DHCP confirmada por nuestro servidor.

Al flashear esta nueva versión cambió el pool dinámico; reconectar todos los clientes. No mantener IP manual dentro de los rangos administrados. No se hacen pruebas a la LAN desde el MCP si esa PC está en otra Wi-Fi.

## Pérdida y latencia del ping

La muestra del usuario (24 enviados, 13 recibidos, promedio ~1652 ms) confirma un problema de conectividad PC↔AP en ese momento. No identifica por sí sola si la causa es firmware, interferencia, energía, ahorro de la tarjeta cliente o señal. SQLite, Supabase y la validación JSON no intervienen en ICMP.

Cambios conservadores del firmware:

- AP con ancho de canal 20 MHz (`WIFI_BW_HT20`).
- Radio con `WIFI_PS_NONE` explícito. En AP puro esto puede ya ser el comportamiento efectivo; no prueba que el ahorro fuera la causa.
- Servidor DHCP atendido en tarea separada de HTTP/USB para no demorar concesiones cuando un GET espera timeout.
- Canal 1, 6 u 11 seleccionable desde dashboard (no se afirma cuál tiene menos interferencia sin medir).
- Estadísticas por USB: uptime, motivo del último reinicio, RAM libre y mínima, clientes, canal y contadores DHCP. Son diagnóstico, **no un medidor de packet loss**.
- Opción para pausar GET automáticos. Una petición en curso termina antes de detener el siguiente ciclo; los botones de consulta manual siguen permitiendo consultar expresamente.

### Prueba A/B que se debe hacer conectado al ESP32

1. Una sola PC cerca (1–2 m), sin otros grupos conectados. Activar **Pausar GET automáticos**, guardar y esperar a que termine la consulta en curso.
2. Conectarse al AP y ejecutar `ping -c 100 -i 0.2 192.168.4.1`. Conservar la salida completa. Es tráfico moderado, no `ping -f`.
3. Despausar, guardar y repetir. Si sólo empeora con GET, registrar cantidad de clientes, endpoints y tamaños de respuesta.
4. Repetir con canales 1/6/11, de a uno, guardando y reconectándose si es necesario.
5. Si sigue mal aun sin GET, probar otro cable USB corto y de datos, fuente/puerto estable y alejar la antena del ESP32 de metal, hubs y cables USB 3. No cambiar todo a la vez.
6. En la PC Linux verificar ahorro de energía de su interfaz: `iw dev`, luego `iw dev NOMBRE_INTERFAZ get power_save`. Como prueba temporal, con permiso del dueño: `sudo iw dev NOMBRE_INTERFAZ set power_save off`; después restaurar la configuración anterior. Esto afecta a la PC cliente, no al ESP32. No se ejecuta remotamente sobre su Wi-Fi actual.
7. Si cae uptime o cambia el motivo de reinicio, investigar alimentación/reset; si no, seguir con señal/interferencia/tarjeta cliente. El uptime no debe confundirse con una medición directa de calidad de radio.

No se considera corregida la pérdida hasta repetir la prueba real por Wi-Fi. No asignar IP fija como supuesto remedio al packet loss: son problemas distintos.

## Alcance y pruebas

DHCP mínimo para red local educativa: Ethernet MAC, IPv4 /24, sin relay, sin DNS ni puerta de salida a Internet. Implementa Discover/Offer/Request/Ack/Nak, renovación, Release, Decline con cuarentena e Inform. No es un reemplazo general de un router de producción. Clientes deben probar su compatibilidad real; reservas no son autenticación ni impiden que alguien configure una IP manual.

`tests/dhcp-core.cpp` prueba el mismo núcleo C++ usado por el firmware con ASan/UBSan: reservas, renovación, reinstanciación/reinicio, separación del pool, solicitudes inválidas, Release, Decline y fuzz de 20000 paquetes. Compilar con:

```sh
g++ -std=c++17 -fsanitize=address,undefined -fno-omit-frame-pointer -g tests/dhcp-core.cpp -o /tmp/termio-dhcp-test
/tmp/termio-dhcp-test
```

`npm test` incluye confirmación antes de GET, pausa, errores y validación de reservas. `python3 scripts/verify-bridge-pty.py` comprueba el editor MAC/IP/endpoints y persistencia mediante Playwright y USB simulado. La interfaz se comprueba en tema oscuro y claro (contraste >=4.5), y a 390 px sin overflow.

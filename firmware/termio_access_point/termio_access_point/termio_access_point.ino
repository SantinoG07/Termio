#include <WiFi.h>
#include <HTTPClient.h>
#include <esp_wifi.h>
#include <esp_netif.h>
#include <esp_wifi_ap_get_sta_list.h>
#include <cstring>

// =====================================================
// CONFIGURACION DEL ACCESS POINT
// =====================================================

const char* AP_SSID = "ESP32_AP_MAIN";

// Reemplazar por la contraseña actual de nuestra red.
const char* AP_PASSWORD = "copahue-esp32-main";

constexpr uint8_t AP_CHANNEL = 6;
constexpr uint8_t AP_MAX_CLIENTS = 8;

const IPAddress AP_IP(192, 168, 4, 1);
const IPAddress AP_GATEWAY(192, 168, 4, 1);
const IPAddress AP_SUBNET(255, 255, 255, 0);

// =====================================================
// EQUIPOS CONFIGURADOS
//
// Identificamos cada equipo por su MAC.
// Su IP actual se consulta al servidor DHCP del AP.
//
// IMPORTANTE:
// Esto NO configura reservas DHCP.
// Los clientes deben utilizar IP automatica / DHCP.
// =====================================================

struct Equipo {
  const char* nombre;
  uint8_t mac[6];
  uint16_t puerto;
  const char* endpoint;
  bool habilitado;
};

const Equipo EQUIPOS[] = {
  {
    "Grupo 1 - Incendios",
    {0xEC, 0x8E, 0x77, 0x10, 0xD4, 0xE8},
    8081,
    "/api/incendios",
    true
  },
  {
  "Grupo 2 - Inundaciones",
  {0x38, 0x87, 0xD5, 0xBC, 0x7C, 0x67},
  80,                 
  "/api/v1/status",
  true
},
  {
  "Grupo 5 - Alertas",
  {0x38, 0x87, 0xD5, 0xBC, 0x7C, 0x67},
  8081,                  // Completar con el puerto real.
  "/api/v1/status",
  false               // Cambiar a true al completar el puerto.
}

  // Para agregar otro equipo:
  // agregar una coma despues de la entrada anterior
  // y completar su MAC, puerto y endpoint.
};

constexpr size_t CANTIDAD_EQUIPOS =
  sizeof(EQUIPOS) / sizeof(EQUIPOS[0]);

// =====================================================
// TIEMPOS
// =====================================================

constexpr unsigned long INTERVALO_GET_MS = 10000;
constexpr int TIMEOUT_CONEXION_MS = 3000;
constexpr uint16_t TIMEOUT_LECTURA_MS = 5000;

unsigned long ultimaConsulta = 0;
bool primeraConsulta = true;

// =====================================================
// PROTOTIPOS EXPLICITOS
// =====================================================

void detener(const char* mensaje);

void imprimirMAC(const uint8_t* mac);

bool obtenerClientes(wifi_sta_mac_ip_list_t& clientes);

void mostrarClientes(
  const wifi_sta_mac_ip_list_t& clientes
);

bool buscarIP(
  const wifi_sta_mac_ip_list_t& clientes,
  const uint8_t* mac,
  IPAddress& ip
);

void consultarEquipo(
  const Equipo& equipo,
  IPAddress ip
);

void consultarEquipos();

// =====================================================
// UTILIDADES
// =====================================================

void detener(const char* mensaje) {
  Serial.println();
  Serial.println(mensaje);

  while (true) {
    delay(1000);
  }
}

void imprimirMAC(const uint8_t* mac) {
  Serial.printf(
    "%02X:%02X:%02X:%02X:%02X:%02X",
    mac[0],
    mac[1],
    mac[2],
    mac[3],
    mac[4],
    mac[5]
  );
}

// =====================================================
// CLIENTES CONECTADOS AL AP
// =====================================================

bool obtenerClientes(wifi_sta_mac_ip_list_t& clientes) {
  wifi_sta_list_t estaciones = {};
  clientes = {};

  esp_err_t resultado =
    esp_wifi_ap_get_sta_list(&estaciones);

  if (resultado != ESP_OK) {
    Serial.printf(
      "Error obteniendo clientes WiFi: %s\n",
      esp_err_to_name(resultado)
    );

    return false;
  }

  // Si no hay estaciones, no necesitamos consultar sus IP.
  if (estaciones.num == 0) {
    return true;
  }

  resultado = esp_wifi_ap_get_sta_list_with_ip(
    &estaciones,
    &clientes
  );

  if (resultado != ESP_OK) {
    Serial.printf(
      "Error obteniendo IPs de clientes: %s\n",
      esp_err_to_name(resultado)
    );

    return false;
  }

  return true;
}

void mostrarClientes(
  const wifi_sta_mac_ip_list_t& clientes
) {
  Serial.println();
  Serial.println("=== CLIENTES DEL ACCESS POINT ===");
  Serial.printf("Cantidad: %d\n", clientes.num);

  for (int i = 0; i < clientes.num; i++) {
    Serial.print("MAC: ");
    imprimirMAC(clientes.sta[i].mac);

    Serial.print(" | IP: ");

    if (clientes.sta[i].ip.addr == 0) {
      Serial.println("Sin IP DHCP disponible");
    } else {
      Serial.println(
        IPAddress(clientes.sta[i].ip.addr)
      );
    }
  }
}

bool buscarIP(
  const wifi_sta_mac_ip_list_t& clientes,
  const uint8_t* mac,
  IPAddress& ip
) {
  for (int i = 0; i < clientes.num; i++) {
    const bool mismaMAC =
      memcmp(clientes.sta[i].mac, mac, 6) == 0;

    if (!mismaMAC) {
      continue;
    }

    // El cliente puede estar asociado al WiFi,
    // pero todavia no tener una IP registrada por DHCP.
    if (clientes.sta[i].ip.addr == 0) {
      return false;
    }

    ip = IPAddress(clientes.sta[i].ip.addr);

    return true;
  }

  return false;
}

// =====================================================
// PETICION HTTP GET
// =====================================================

void consultarEquipo(
  const Equipo& equipo,
  IPAddress ip
) {
  String url = "http://";
  url += ip.toString();
  url += ":";
  url += String(equipo.puerto);
  url += equipo.endpoint;

  Serial.println();
  Serial.println("========================================");

  Serial.printf("Equipo: %s\n", equipo.nombre);

  Serial.print("MAC: ");
  imprimirMAC(equipo.mac);
  Serial.println();

  Serial.print("IP detectada: ");
  Serial.println(ip);

  Serial.print("GET ");
  Serial.println(url);

  WiFiClient cliente;
  HTTPClient http;

  http.setConnectTimeout(TIMEOUT_CONEXION_MS);
  http.setTimeout(TIMEOUT_LECTURA_MS);

  if (!http.begin(cliente, url)) {
    Serial.println(
      "ERROR: no se pudo preparar la peticion HTTP."
    );

    return;
  }

  http.addHeader("Accept", "application/json");

  const unsigned long inicio = millis();
  const int codigoHTTP = http.GET();

  Serial.printf(
    "Tiempo hasta respuesta: %lu ms\n",
    millis() - inicio
  );

  if (codigoHTTP > 0) {
    Serial.printf("HTTP: %d\n", codigoHTTP);

    Serial.println("--- INICIO DE RESPUESTA ---");

    // Imprime el cuerpo sin cargar todo el JSON
    // en una String grande.
    const int resultado = http.writeToStream(&Serial);

    Serial.println();
    Serial.println("--- FIN DE RESPUESTA ---");

    if (resultado < 0) {
      Serial.print("Error leyendo la respuesta: ");
      Serial.println(
        HTTPClient::errorToString(resultado)
      );
    }

    if (codigoHTTP != HTTP_CODE_OK) {
      Serial.println(
        "El servidor respondio, pero no con HTTP 200."
      );
    }
  } else {
    Serial.print("ERROR de conexion HTTP: ");
    Serial.println(
      HTTPClient::errorToString(codigoHTTP)
    );

    Serial.println("Verificar:");
    Serial.println(
      "1. Que el servidor del otro equipo este iniciado."
    );
    Serial.printf(
      "2. Que escuche en el puerto %u.\n",
      equipo.puerto
    );
    Serial.println(
      "3. Que escuche en 0.0.0.0 o en su IP WiFi."
    );
    Serial.println(
      "4. Que el firewall permita la conexion."
    );
    Serial.println(
      "5. Que el equipo siga conectado a nuestra red."
    );
  }

  http.end();
}

// =====================================================
// CONSULTA DE EQUIPOS REGISTRADOS
// =====================================================

void consultarEquipos() {
  wifi_sta_mac_ip_list_t clientes = {};

  if (!obtenerClientes(clientes)) {
    return;
  }

  mostrarClientes(clientes);

  if (clientes.num == 0) {
    Serial.println(
      "Esperando equipos conectados a nuestra red..."
    );

    return;
  }

  for (size_t i = 0; i < CANTIDAD_EQUIPOS; i++) {
    const Equipo& equipo = EQUIPOS[i];

    if (!equipo.habilitado) {
      continue;
    }

    IPAddress ip;

    if (!buscarIP(clientes, equipo.mac, ip)) {
      Serial.println();

      Serial.printf(
        "%s: no conectado o sin IP DHCP disponible.\n",
        equipo.nombre
      );

      Serial.print("MAC buscada: ");
      imprimirMAC(equipo.mac);
      Serial.println();

      continue;
    }

    consultarEquipo(equipo, ip);
  }
}

// =====================================================
// SETUP
// =====================================================

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("========================================");
  Serial.println("TERMIO - ACCESS POINT + GET POR MAC");
  Serial.println("========================================");

  const size_t longitudClave = strlen(AP_PASSWORD);

  if (
    longitudClave < 8 ||
    longitudClave > 63 ||
    strcmp(
      AP_PASSWORD,
      "REEMPLAZAR_CON_TU_CLAVE"
    ) == 0
  ) {
    detener(
      "ERROR: configurar AP_PASSWORD con la clave de la red."
    );
  }

  WiFi.mode(WIFI_AP);

  if (!WiFi.softAPConfig(
    AP_IP,
    AP_GATEWAY,
    AP_SUBNET
  )) {
    detener(
      "ERROR: no se pudo configurar la IP del AP."
    );
  }

  const bool iniciado = WiFi.softAP(
    AP_SSID,
    AP_PASSWORD,
    AP_CHANNEL,
    false,
    AP_MAX_CLIENTS
  );

  if (!iniciado) {
    detener(
      "ERROR iniciando AP. Revisar configuracion y limite de clientes."
    );
  }

  Serial.print("Red: ");
  Serial.println(AP_SSID);

  Serial.print("IP del AP: ");
  Serial.println(WiFi.softAPIP());

  Serial.print("MAC del AP: ");
  Serial.println(WiFi.softAPmacAddress());

  Serial.printf(
    "Equipos registrados: %u\n",
    static_cast<unsigned int>(CANTIDAD_EQUIPOS)
  );

  Serial.println();
  Serial.println(
    "Clientes: configurar IP automatica / DHCP."
  );
  Serial.println(
    "La IP actual se busca por MAC antes de cada consulta."
  );
  Serial.println(
    "No se crean reservas DHCP."
  );
  Serial.println(
    "Consultas cada 10 segundos, sin solaparse."
  );
}

// =====================================================
// LOOP
// =====================================================

void loop() {
  const unsigned long ahora = millis();

  if (
    primeraConsulta ||
    ahora - ultimaConsulta >= INTERVALO_GET_MS
  ) {
    primeraConsulta = false;
    ultimaConsulta = ahora;

    consultarEquipos();
  }

  delay(10);
}
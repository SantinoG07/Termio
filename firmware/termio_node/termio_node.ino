#include <WiFi.h>
#include <esp_wifi.h>

// ===== CONFIGURACIÓN =====

// Nombre de la red que crearán ustedes.
constexpr const char* AP_SSID = "TERMIO_LOCAL";

// Cambiar antes de cargar. Entre 8 y 63 caracteres.
// No publicar la contraseña real en Git.
constexpr const char* AP_PASSWORD ="123456789";

// Cinco nodos de otros grupos + nuestra computadora = 6 clientes.
// Solicitamos 8 para tener margen.
// El límite real depende del modelo de ESP32 y su SDK.
constexpr int AP_MAX_CLIENTS = 8;

constexpr int AP_CHANNEL = 6;

// Dirección del access point.
// Los demás dispositivos deben pertenecer a esta misma subred.
IPAddress apIP(192, 168, 4, 1);
IPAddress gateway(192, 168, 4, 1);
IPAddress subnet(255, 255, 255, 0);

// ===== FUNCIONAMIENTO =====

int previousClients = -1;
unsigned long lastReport = 0;

void stopWithError(const char* message) {
  Serial.println();
  Serial.print("ERROR: ");
  Serial.println(message);

  while (true) {
    delay(1000);
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("TERMIO - Access point local");
  Serial.println("Esta red NO proporciona Internet.");

  String password = AP_PASSWORD;

  if (
    password.length() < 8 ||
    password.length() > 63 ||
    password.startsWith("REEMPLAZAR")
  ) {
    stopWithError(
      "Configurar AP_PASSWORD: entre 8 y 63 caracteres."
    );
  }

  WiFi.mode(WIFI_AP);

  if (!WiFi.softAPConfig(apIP, gateway, subnet)) {
    stopWithError("No se pudo configurar la red del AP.");
  }

  bool started = WiFi.softAP(
    AP_SSID,
    AP_PASSWORD,
    AP_CHANNEL,
    false,            // Red visible
    AP_MAX_CLIENTS
  );

  if (!started) {
    stopWithError(
      "No se pudo iniciar el AP. Revisar modelo, SDK y limite de clientes."
    );
  }

  wifi_config_t config = {};

  if (esp_wifi_get_config(WIFI_IF_AP, &config) != ESP_OK) {
    WiFi.softAPdisconnect(true);
    stopWithError("No se pudo verificar la configuracion del AP.");
  }

  int configuredLimit = config.ap.max_connection;

  Serial.print("Limite de clientes configurado: ");
  Serial.println(configuredLimit);

  if (configuredLimit < 6) {
    WiFi.softAPdisconnect(true);
    stopWithError(
      "Se necesitan al menos 6 clientes: cinco grupos y la PC."
    );
  }

  Serial.println("Access point iniciado.");
  Serial.print("Nombre de red: ");
  Serial.println(AP_SSID);

  Serial.print("IP del access point: ");
  Serial.println(WiFi.softAPIP());

  Serial.print("Canal: ");
  Serial.println(AP_CHANNEL);

  Serial.println(
    "Conectar la PC y los ESP32 de los grupos a esta red."
  );
  Serial.println(
    "Las IP de los grupos se verifican en sus propios dispositivos."
  );
}


void loop() {
  int clients = WiFi.softAPgetStationNum();

  if (
    clients != previousClients ||
    millis() - lastReport >= 10000
  ) {
    previousClients = clients;
    lastReport = millis();

    Serial.print("Clientes conectados: ");
    Serial.println(clients);
  }

  delay(100);
}
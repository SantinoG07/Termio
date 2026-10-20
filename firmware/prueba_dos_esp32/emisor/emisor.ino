#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <esp_system.h>
#include "config.h"

unsigned long lastCycle = 0;
unsigned long lastReconnect = 0;
bool firstCycle = true;
uint32_t sequence = 0;
String bootId;
String lastIp;

void runCycle() {
  WiFiClient client;
  HTTPClient http;
  String base = RECEIVER_BASE_URL;
  if (base.endsWith("/")) base.remove(base.length() - 1);

  // Primero consulta el estado del otro ESP32.
  if (!http.begin(client, base + "/api/status")) { Serial.println("URL GET invalida"); return; }
  http.setConnectTimeout(3000); http.setTimeout(5000);
  http.addHeader("Authorization", String("Bearer ") + TEST_TOKEN);
  int status = http.GET();
  Serial.printf("GET /api/status -> %d\n", status);
  if (status > 0) Serial.println(http.getString());
  http.end();
  if (status != 200) { Serial.println("No se envia POST: resolver primero el GET"); return; }

  // El contador es simulado, NO temperatura ni lectura ambiental.
  ++sequence;
  JsonDocument doc;
  doc["message_id"] = bootId + "_" + String(sequence);
  doc["node_id"] = "esp32_test_sender";
  doc["uptime_ms"] = millis();
  doc["source_type"] = "simulated";
  doc["test_value"] = sequence % 100;
  String payload; serializeJson(doc, payload);

  if (!http.begin(client, base + "/api/readings")) { Serial.println("URL POST invalida"); return; }
  http.setConnectTimeout(3000); http.setTimeout(5000);
  http.addHeader("Authorization", String("Bearer ") + TEST_TOKEN);
  http.addHeader("Content-Type", "application/json");
  status = http.POST(payload);
  Serial.printf("POST /api/readings -> %d\n", status);
  if (status > 0) Serial.println(http.getString());
  http.end();
  if (status != 201) Serial.println("Sin confirmacion de guardado; esta prueba no reintenta el POST");
}

void setup() {
  Serial.begin(115200);
  uint8_t randomBytes[8]; esp_fill_random(randomBytes, sizeof(randomBytes));
  char buffer[17];
  for (int i = 0; i < 8; ++i) snprintf(buffer + i * 2, 3, "%02x", randomBytes[i]);
  bootId = buffer;
  WiFi.mode(WIFI_STA); WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.println("Emisor iniciado. Esperando Wi-Fi...");
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - lastReconnect >= 15000) {
      lastReconnect = millis(); WiFi.reconnect(); Serial.println("Reconectando Wi-Fi...");
    }
    delay(10); return;
  }
  String ip = WiFi.localIP().toString();
  if (ip != lastIp) { lastIp = ip; Serial.print("IP EMISOR: "); Serial.println(ip); }
  if (strlen(TEST_TOKEN) < 24 || String(TEST_TOKEN).startsWith("REEMPLAZAR")) {
    Serial.println("Completar TEST_TOKEN privado, minimo 24 caracteres"); delay(5000); return;
  }
  if (firstCycle || millis() - lastCycle >= SEND_INTERVAL_MS) {
    firstCycle = false; lastCycle = millis(); runCycle();
  }
  delay(10);
}

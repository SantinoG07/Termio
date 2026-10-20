#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include <ArduinoJson.h>
#include <esp_system.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include "config.h"

// Mismo sketch en las dos placas. Solo cambia config.h.
// Servidor: loop principal. Cliente HTTP: tarea FreeRTOS separada.
// Solo el servidor accede a LittleFS; no se comparte el archivo entre tareas.
WebServer server(80);
const char* LOG_PATH = "/registros.txt";
const size_t MAX_LOG_BYTES = 128 * 1024;
bool storageReady = false;
String lastIp;
unsigned long lastReconnect = 0;

bool tokenConfigured() {
  return strlen(TEST_TOKEN) >= 24 && !String(TEST_TOKEN).startsWith("REEMPLAZAR");
}
bool authorize() {
  if (!tokenConfigured()) {
    server.send(503, "application/json", "{\"error\":\"TOKEN_NOT_CONFIGURED\"}"); return false;
  }
  if (server.header("Authorization") != String("Bearer ") + TEST_TOKEN) {
    server.send(401, "application/json", "{\"error\":\"UNAUTHORIZED\"}"); return false;
  }
  return true;
}
void getStatus() {
  if (!authorize()) return;
  size_t bytes = 0;
  if (storageReady) {
    File file = LittleFS.open(LOG_PATH, "r");
    if (file) { bytes = file.size(); file.close(); }
  }
  JsonDocument doc;
  doc["node_id"] = NODE_ID;
  doc["status"] = storageReady ? "ready" : "storage_error";
  doc["uptime_ms"] = millis();
  doc["log_bytes"] = bytes;
  String output; serializeJson(doc, output);
  server.send(storageReady ? 200 : 503, "application/json", output);
}
void postReading() {
  if (!authorize()) return;
  if (!storageReady) {
    server.send(503, "application/json", "{\"error\":\"STORAGE_UNAVAILABLE\"}"); return;
  }
  if (!server.header("Content-Type").startsWith("application/json")) {
    server.send(415, "application/json", "{\"error\":\"EXPECTED_JSON\"}"); return;
  }
  String body = server.arg("plain");
  if (body.length() == 0 || body.length() > 2048) {
    server.send(413, "application/json", "{\"error\":\"INVALID_BODY_SIZE\"}"); return;
  }
  JsonDocument input;
  if (deserializeJson(input, body) || !input.is<JsonObject>() ||
      !input["message_id"].is<String>() || !input["node_id"].is<String>() ||
      !input["uptime_ms"].is<unsigned long>() || !input["test_value"].is<int>() ||
      String(input["source_type"].as<const char*>()) != "simulated") {
    server.send(422, "application/json", "{\"error\":\"INVALID_TEST_RECORD\"}"); return;
  }
  String id = input["message_id"].as<String>();
  if (id.length() == 0 || id.length() > 100 || input["node_id"].as<String>() != PEER_NODE_ID) {
    server.send(422, "application/json", "{\"error\":\"INVALID_IDENTITY\"}"); return;
  }
  JsonDocument entry;
  entry["receiver_node_id"] = NODE_ID;
  entry["received_uptime_ms"] = millis();
  entry["sender_ip"] = server.client().remoteIP().toString();
  entry["payload"].set(input.as<JsonObject>());
  String line; serializeJson(entry, line); line += '\n';
  File file = LittleFS.open(LOG_PATH, "a");
  if (!file) { server.send(500, "application/json", "{\"error\":\"OPEN_FAILED\"}"); return; }
  if (file.size() + line.length() > MAX_LOG_BYTES) {
    file.close(); server.send(507, "application/json", "{\"error\":\"LOG_FULL\"}"); return;
  }
  size_t written = file.print(line); file.flush(); file.close();
  if (written != line.length()) {
    server.send(500, "application/json", "{\"error\":\"WRITE_FAILED\"}"); return;
  }
  JsonDocument response;
  response["saved"] = true; response["message_id"] = id; response["receiver_node_id"] = NODE_ID;
  String output; serializeJson(response, output);
  server.send(201, "application/json", output);
  Serial.printf("[ENTRADA] POST de %s guardado: %s\n", PEER_NODE_ID, id.c_str());
}
void getLog() {
  if (!authorize()) return;
  if (!storageReady) { server.send(503, "application/json", "{\"error\":\"STORAGE_UNAVAILABLE\"}"); return; }
  File file = LittleFS.open(LOG_PATH, "r");
  if (!file) { server.send(200, "text/plain", ""); return; }
  server.streamFile(file, "text/plain"); file.close();
}

void outgoingTask(void*) {
  uint8_t bytes[8]; esp_fill_random(bytes, sizeof(bytes));
  char boot[17];
  for (int i = 0; i < 8; ++i) snprintf(boot + 2 * i, 3, "%02x", bytes[i]);
  uint32_t sequence = 0;
  // Mensajes nuevos cada ciclo. NO retransmitir mensajes entrantes al otro nodo.
  for (;;) {
    if (WiFi.status() == WL_CONNECTED && tokenConfigured()) {
      String base = PEER_BASE_URL;
      if (base.endsWith("/")) base.remove(base.length() - 1);
      WiFiClient client;
      HTTPClient http;
      bool peerReady = false;
      if (http.begin(client, base + "/api/status")) {
        http.setConnectTimeout(3000); http.setTimeout(5000);
        http.addHeader("Authorization", String("Bearer ") + TEST_TOKEN);
        int code = http.GET();
        Serial.printf("[SALIDA] GET a %s -> %d\n", PEER_NODE_ID, code);
        if (code == 200) {
          JsonDocument response;
          String body = http.getString();
          peerReady = !deserializeJson(response, body) &&
            response["node_id"].as<String>() == PEER_NODE_ID &&
            response["status"].as<String>() == "ready";
          if (!peerReady) Serial.println("[SALIDA] Estado o identidad del otro nodo incorrectos");
        }
        http.end();
      }
      if (peerReady) {
        ++sequence;
        JsonDocument doc;
        doc["message_id"] = String(NODE_ID) + "_" + boot + "_" + String(sequence);
        doc["node_id"] = NODE_ID;
        doc["uptime_ms"] = millis();
        doc["source_type"] = "simulated";
        doc["test_value"] = (int)(sequence % 100);
        String payload; serializeJson(doc, payload);
        if (http.begin(client, base + "/api/readings")) {
          http.setConnectTimeout(3000); http.setTimeout(5000);
          http.addHeader("Authorization", String("Bearer ") + TEST_TOKEN);
          http.addHeader("Content-Type", "application/json");
          int code = http.POST(payload);
          Serial.printf("[SALIDA] POST a %s -> %d\n", PEER_NODE_ID, code);
          if (code > 0) Serial.println(http.getString());
          http.end();
          if (code != 201) Serial.println("[SALIDA] Sin confirmacion de guardado; no se reintenta este mensaje");
        }
      }
    }
    vTaskDelay(pdMS_TO_TICKS(SEND_INTERVAL_MS));
  }
}

void setup() {
  Serial.begin(115200);
  storageReady = LittleFS.begin(FORMAT_FS_ON_MOUNT_FAILURE);
  Serial.println(storageReady ? "LittleFS listo" : "LittleFS no montado: revisar particion/inicializacion");
  WiFi.mode(WIFI_STA); WiFi.setAutoReconnect(true); WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  const char* headers[] = {"Authorization", "Content-Type"};
  server.collectHeaders(headers, 2);
  server.on("/api/status", HTTP_GET, getStatus);
  server.on("/api/readings", HTTP_POST, postReading);
  server.on("/api/log", HTTP_GET, getLog);
  server.onNotFound([] { server.send(404, "application/json", "{\"error\":\"NOT_FOUND\"}"); });
  server.begin();
  if (xTaskCreate(outgoingTask, "http_client", 8192, nullptr, 1, nullptr) != pdPASS) {
    Serial.println("ERROR: no se pudo iniciar la tarea cliente; solo funciona el servidor");
  }
  Serial.printf("Nodo %s iniciado: servidor + cliente HTTP\n", NODE_ID);
  if (!tokenConfigured()) Serial.println("ERROR: completar TEST_TOKEN privado, minimo 24 caracteres");
}
void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    String ip = WiFi.localIP().toString();
    if (ip != lastIp) { lastIp = ip; Serial.printf("IP %s: %s\n", NODE_ID, ip.c_str()); }
    server.handleClient();
  } else if (millis() - lastReconnect >= 15000) {
    lastReconnect = millis(); WiFi.reconnect(); Serial.println("Reconectando Wi-Fi...");
  }
  delay(2);
}

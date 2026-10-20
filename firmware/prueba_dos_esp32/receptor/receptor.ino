#include <WiFi.h>
#include <WebServer.h>
#include <LittleFS.h>
#include <ArduinoJson.h>
#include "config.h"

WebServer server(80);
const char* LOG_PATH = "/registros.txt";
const size_t MAX_LOG_BYTES = 128 * 1024;
bool storageReady = false;
unsigned long lastReconnect = 0;
String lastIp;

bool authorize() {
  if (strlen(TEST_TOKEN) < 24 || String(TEST_TOKEN).startsWith("REEMPLAZAR")) {
    server.send(503, "application/json", "{\"error\":\"TOKEN_NOT_CONFIGURED\"}");
    return false;
  }
  if (server.header("Authorization") != String("Bearer ") + TEST_TOKEN) {
    server.send(401, "application/json", "{\"error\":\"UNAUTHORIZED\"}");
    return false;
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
  doc["device"] = "termio_test_receiver";
  doc["status"] = storageReady ? "ready" : "storage_error";
  doc["uptime_ms"] = millis();
  doc["log_bytes"] = bytes;
  doc["max_log_bytes"] = MAX_LOG_BYTES;
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
  String messageId = input["message_id"].as<String>();
  String nodeId = input["node_id"].as<String>();
  if (messageId.length() == 0 || messageId.length() > 80 || nodeId != "esp32_test_sender") {
    server.send(422, "application/json", "{\"error\":\"INVALID_IDENTITY\"}"); return;
  }
  // JSON de prueba: el valor NO es una medición de un sensor.
  JsonDocument entry;
  entry["received_uptime_ms"] = millis();
  entry["sender_ip"] = server.client().remoteIP().toString();
  entry["payload"].set(input.as<JsonObject>());
  String line; serializeJson(entry, line); line += '\n';
  File file = LittleFS.open(LOG_PATH, "a");
  if (!file) {
    server.send(500, "application/json", "{\"error\":\"OPEN_FAILED\"}"); return;
  }
  if (file.size() + line.length() > MAX_LOG_BYTES) {
    file.close();
    server.send(507, "application/json", "{\"error\":\"LOG_FULL\"}"); return;
  }
  size_t written = file.print(line);
  file.flush(); file.close();
  if (written != line.length()) {
    server.send(500, "application/json", "{\"error\":\"WRITE_FAILED\"}"); return;
  }
  JsonDocument response;
  response["saved"] = true;
  response["message_id"] = messageId;
  String output; serializeJson(response, output);
  server.send(201, "application/json", output);
  Serial.print("POST guardado: "); Serial.println(messageId);
}

void getLog() {
  if (!authorize()) return;
  if (!storageReady) {
    server.send(503, "application/json", "{\"error\":\"STORAGE_UNAVAILABLE\"}"); return;
  }
  File file = LittleFS.open(LOG_PATH, "r");
  if (!file) { server.send(200, "text/plain; charset=utf-8", ""); return; }
  server.streamFile(file, "text/plain"); file.close();
}

void setup() {
  Serial.begin(115200);
  storageReady = LittleFS.begin(FORMAT_FS_ON_MOUNT_FAILURE);
  Serial.println(storageReady ? "LittleFS listo" : "LittleFS no montado: revisar particion/inicializacion");
  WiFi.mode(WIFI_STA); WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  const char* headers[] = {"Authorization", "Content-Type"};
  server.collectHeaders(headers, 2);
  server.on("/api/status", HTTP_GET, getStatus);
  server.on("/api/readings", HTTP_POST, postReading);
  server.on("/api/log", HTTP_GET, getLog);
  server.onNotFound([] { server.send(404, "application/json", "{\"error\":\"NOT_FOUND\"}"); });
  server.begin();
  Serial.println("Receptor iniciado. Esperando Wi-Fi...");
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    String ip = WiFi.localIP().toString();
    if (ip != lastIp) { lastIp = ip; Serial.print("IP RECEPTOR: "); Serial.println(ip); }
    server.handleClient();
  } else if (millis() - lastReconnect >= 15000) {
    lastReconnect = millis(); WiFi.reconnect(); Serial.println("Reconectando Wi-Fi...");
  }
  delay(2);
}

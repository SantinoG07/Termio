#pragma once
#include <WiFi.h>
#include <HTTPClient.h>
#include <esp_wifi.h>
#include <esp_wifi_ap_get_sta_list.h>
#include <cJSON.h>

// Protocolo USB v1: la PC decide MAC, puerto, ruta y frecuencia.
// El ESP32 no consulta nada hasta recibir TERMIO_CMD {op:get,...}.
static bool bridgeUp = false;
static String bridgeInput;
static bool bridgeDropping = false;

static const char* bridgeText(cJSON* object, const char* key) {
  cJSON* value = cJSON_GetObjectItemCaseSensitive(object, key);
  return cJSON_IsString(value) && value->valuestring ? value->valuestring : "";
}
static void bridgeReport(const char* event, const String& id, bool ok, int code, const char* error) {
  cJSON* message = cJSON_CreateObject();
  if (!message) return;
  cJSON_AddStringToObject(message, "event", event);
  cJSON_AddNumberToObject(message, "protocol", 1);
  if(strcmp(event,"ready")==0)cJSON_AddNumberToObject(message,"led_protocol",1);
  cJSON_AddStringToObject(message, "request_id", id.c_str());
  cJSON_AddBoolToObject(message, "ok", ok);
  cJSON_AddNumberToObject(message, "http_status", code);
  cJSON_AddStringToObject(message, "error", error);
  char* json = cJSON_PrintUnformatted(message);
  if (json) { Serial.print("TERMIO_BRIDGE "); Serial.println(json); cJSON_free(json); }
  cJSON_Delete(message);
}
#include "diagnostics_runtime.h"
#include "dhcp_runtime.h"
#include "central_http.h"
#include "indicators_runtime.h"

class BridgeSerialStream : public Stream {
 public:
  size_t total = 0;
  bool exceeded = false;
  unsigned long started=millis();
  int available() override { return 0; }
  int read() override { return -1; }
  int peek() override { return -1; }
  void flush() override { Serial.flush(); }
  size_t write(uint8_t value) override { return write(&value, 1); }
  size_t write(const uint8_t* data, size_t length) override {
    if (millis()-started>15000 || total + length > 65536) { exceeded = true; return 0; }
    size_t sent = Serial.write(data, length); total += sent; return sent;
  }
};
static void bridgeGet(cJSON* command) {
  diagnosticMark(30);
  const String id = bridgeText(command, "request_id");
  const String macString = bridgeText(command, "mac");
  const String path = bridgeText(command, "path");
  String name = bridgeText(command, "name");
  cJSON* portValue = cJSON_GetObjectItemCaseSensitive(command, "port");
  const int port = cJSON_IsNumber(portValue) ? portValue->valueint : 0;
  if (id.length() > 64 || id.length() == 0 || macString.length() != 17 || port < 1 || port > 65535 || path.length() > 700 || !path.startsWith("/") || path.startsWith("//") || path.indexOf('\r') >= 0 || path.indexOf('\n') >= 0) {
    bridgeReport("done", id, false, 0, "INVALID_COMMAND"); return;
  }
  if (name.length() > 80) name = name.substring(0, 80);
  for (size_t i = 0; i < name.length(); i++) if ((uint8_t)name[i] < 32) name.setCharAt(i, ' ');
  unsigned int parsed[6]; uint8_t mac[6];
  if (sscanf(macString.c_str(), "%2x:%2x:%2x:%2x:%2x:%2x", &parsed[0], &parsed[1], &parsed[2], &parsed[3], &parsed[4], &parsed[5]) != 6) {
    bridgeReport("done", id, false, 0, "INVALID_MAC"); return;
  }
  for (int i = 0; i < 6; i++) mac[i] = (uint8_t)parsed[i];
  wifi_sta_list_t wifi = {};
  if (esp_wifi_ap_get_sta_list(&wifi) != ESP_OK) {
    bridgeReport("done", id, false, 0, "CLIENT_LIST_FAILED"); return;
  }
  Serial.printf("Cantidad: %d\n", wifi.num);
  IPAddress ip;
  bool found = false;
  for (int i = 0; i < wifi.num; i++) {
    const auto& client = wifi.sta[i];
    const uint8_t host = dhcpAddress(client.mac);
    Serial.printf("MAC: %02X:%02X:%02X:%02X:%02X:%02X | IP: ", client.mac[0], client.mac[1], client.mac[2], client.mac[3], client.mac[4], client.mac[5]);
    if (host) Serial.println(IPAddress(192,168,4,host)); else Serial.println("Sin IP DHCP disponible");
    if (memcmp(client.mac, mac, 6) == 0 && host) { ip = IPAddress(192,168,4,host); found = true; }
  }
  if (!found) {
    Serial.printf("%s: no conectado o sin IP DHCP disponible.\n", name.c_str());
    Serial.printf("MAC buscada: %s\n", macString.c_str());
    bridgeReport("done", id, false, 0, "MAC_NOT_FOUND"); return;
  }
  Serial.printf("Equipo: %s\n", name.c_str());
  Serial.printf("MAC: %s\n", macString.c_str());
  Serial.print("IP detectada: "); Serial.println(ip);
  const String url = String("http://") + ip.toString() + ":" + String(port) + path;
  // El backend elimina query y credenciales de los eventos visibles del debug.
  Serial.print("GET "); Serial.println(url);
  WiFiClient socket;
  HTTPClient http;
  http.setConnectTimeout(3000);
  http.setTimeout(5000);
  http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  if (!http.begin(socket, url)) { bridgeReport("done", id, false, 0, "HTTP_BEGIN_FAILED"); return; }
  const char* headers[] = {"Content-Type"};
  http.collectHeaders(headers, 1);
  http.addHeader("Accept", "application/json");
  diagnosticMark(31);
  const int code = http.GET();
  if (code <= 0) {
    Serial.print("ERROR de conexion HTTP: "); Serial.println(HTTPClient::errorToString(code));
    http.end(); bridgeReport("done", id, false, code, "HTTP_CONNECTION_FAILED"); return;
  }
  Serial.printf("HTTP: %d\n", code);
  String type = http.header("Content-Type"); type.toLowerCase();
  if (code != 200 || !type.startsWith("application/json")) {
    http.end(); bridgeReport("done", id, false, code, code == 200 ? "EXPECTED_JSON_CONTENT_TYPE" : "HTTP_ERROR"); return;
  }
  if (http.getSize() > 65536) { http.end(); bridgeReport("done", id, false, code, "BODY_TOO_LARGE"); return; }
  Serial.println("--- INICIO DE RESPUESTA ---");
  BridgeSerialStream output;
  diagnosticMark(32);
  const int result = http.writeToStream(&output);
  Serial.println(); Serial.println("--- FIN DE RESPUESTA ---");
  http.end();
  bridgeReport("done", id, result >= 0 && !output.exceeded, code, output.exceeded ? "BODY_TOO_LARGE" : result < 0 ? "HTTP_BODY_READ_FAILED" : "");
}
static void bridgeCommand(const String& line) {
  if (!line.startsWith("TERMIO_CMD ")) return;
  cJSON* command = cJSON_Parse(line.c_str() + 11);
  if (!command) { bridgeReport("error", "", false, 0, "INVALID_COMMAND_JSON"); return; }
  const String op = bridgeText(command, "op");
  if (op == "hello" && bridgeUp) {diagnosticReportBoot();diagnosticEvent("watchdog_status",diagnosticWdt?35000:0);bridgeReport("ready", "", true, 0, "");}
  else if (op == "configure" && bridgeUp) {
    diagnosticMark(20);
    const bool ok=dhcpApply(command,true);
    bridgeReport("configured",bridgeText(command,"request_id"),ok,0,ok?"":"NETWORK_CONFIG_FAILED");
    bridgeTelemetry();
  }
  else if (op == "leds" && bridgeUp) indicatorCommand(command);
  else if (op.startsWith("api_") && bridgeUp) centralCommand(command);
  else if (op == "get" && bridgeUp) bridgeGet(command);
  else bridgeReport("error", "", false, 0, "UNKNOWN_COMMAND");
  cJSON_Delete(command);
}
static void bridgeSetup(const char* ssid, const char* password) {
  indicatorSetup();
  Serial.setRxBufferSize(8192);
  Serial.begin(115200);
  diagnosticSetup();
  delay(500);
  bridgeInput.reserve(4096);
  diagnosticMark(2);diagnosticEvent("wifi_initializing");
  WiFi.mode(WIFI_AP);
  const IPAddress ip(192, 168, 4, 1), mask(255, 255, 255, 0);
  if (strlen(password) < 8 || strlen(password) > 63 || !WiFi.softAPConfig(ip, ip, mask) || !WiFi.softAP(ssid, password, 6, false, 8)) {
    bridgeReport("error", "", false, 0, "AP_START_FAILED"); return;
  }
  diagnosticMark(3);diagnosticEvent("ap_configured");
  // HT20 reduce interferencia de canales adyacentes; AP sin ahorro de radio.
  if (esp_wifi_set_bandwidth(WIFI_IF_AP,WIFI_BW_HT20)!=ESP_OK || esp_wifi_set_ps(WIFI_PS_NONE)!=ESP_OK || !dhcpStart()) {
    bridgeReport("error","",false,0,"NETWORK_START_FAILED"); return;
  }
  diagnosticMark(4);diagnosticEvent("dhcp_ready");
  centralSetup();
  bridgeUp = true;
  Serial.println("TERMIO - AP + PUENTE HTTP CONTROLADO DESDE DASHBOARD");
  bridgeReport("ready", "", true, 0, "");
}
static void bridgeLoop() {
  diagnosticMark(10);diagnosticLoop(bridgeUp);
  int serialBudget=1024;
  while (Serial.available() && serialBudget-- > 0) {
    const char ch = (char)Serial.read();
    if (ch == '\n') {
      if (!bridgeDropping) { bridgeInput.trim(); bridgeCommand(bridgeInput); }
      bridgeInput = ""; bridgeDropping = false;
    } else if (!bridgeDropping && ch != '\r') {
      if (bridgeInput.length() >= 4096) { bridgeInput = ""; bridgeDropping = true; }
      else bridgeInput += ch;
    }
  }
  indicatorLoop();
  diagnosticMark(40);
  if(bridgeUp)centralLoop();
  static unsigned long lastTelemetry=0;
  if(bridgeUp && millis()-lastTelemetry>=5000){diagnosticMark(50);lastTelemetry=millis();bridgeTelemetry();}
  diagnosticMark(11);
  delay(2);
}

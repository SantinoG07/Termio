#pragma once
#include <esp_system.h>
#include <esp_task_wdt.h>
#include <freertos/queue.h>

// RTC breadcrumbs survive many software/watchdog resets, not a power cycle.
RTC_DATA_ATTR static uint32_t diagnosticMagic;
RTC_DATA_ATTR static uint32_t diagnosticPreviousStage;
static uint32_t diagnosticBootId=0, diagnosticBootPreviousStage=0;
static bool diagnosticWdt=false;
static QueueHandle_t diagnosticWifiQueue=nullptr;
static volatile bool diagnosticApStopped=false;
static void diagnosticMark(uint32_t stage){diagnosticPreviousStage=stage;}
static void diagnosticEvent(const char* name,uint32_t detail=0){
 cJSON* p=cJSON_CreateObject();if(!p)return;
 cJSON_AddStringToObject(p,"event","diagnostic");cJSON_AddStringToObject(p,"name",name);
 cJSON_AddNumberToObject(p,"detail",detail);cJSON_AddNumberToObject(p,"boot_id",diagnosticBootId);
 cJSON_AddNumberToObject(p,"uptime_ms",millis());cJSON_AddNumberToObject(p,"heap",ESP.getFreeHeap());
 cJSON_AddNumberToObject(p,"stack_free",uxTaskGetStackHighWaterMark(nullptr));
 char* text=cJSON_PrintUnformatted(p);if(text){Serial.print("TERMIO_BRIDGE ");Serial.println(text);cJSON_free(text);}cJSON_Delete(p);
}
static void diagnosticReportBoot(){
 cJSON* p=cJSON_CreateObject();if(p){
  cJSON_AddStringToObject(p,"event","boot");cJSON_AddNumberToObject(p,"boot_id",diagnosticBootId);
  cJSON_AddNumberToObject(p,"reset_reason",esp_reset_reason());cJSON_AddNumberToObject(p,"previous_stage",diagnosticBootPreviousStage);
  cJSON_AddStringToObject(p,"firmware","termio-diag-1");
  char* text=cJSON_PrintUnformatted(p);if(text){Serial.print("TERMIO_BRIDGE ");Serial.println(text);cJSON_free(text);}cJSON_Delete(p);
 }
}
static void diagnosticSetup(){
 diagnosticBootPreviousStage=diagnosticMagic==0x5445524d?diagnosticPreviousStage:0;
 diagnosticMagic=0x5445524d;diagnosticBootId=esp_random();diagnosticMark(1);diagnosticReportBoot();
 esp_task_wdt_config_t config={};config.timeout_ms=35000;config.idle_core_mask=0;config.trigger_panic=true;
 esp_err_t result=esp_task_wdt_init(&config);
 if(result==ESP_ERR_INVALID_STATE)result=esp_task_wdt_reconfigure(&config);
 if(result==ESP_OK){result=esp_task_wdt_add(nullptr);diagnosticWdt=result==ESP_OK || esp_task_wdt_status(nullptr)==ESP_OK;}
 diagnosticEvent(diagnosticWdt?"watchdog_enabled_35s":"watchdog_setup_failed",(uint32_t)result);
 diagnosticWifiQueue=xQueueCreate(32,sizeof(uint32_t));
 if(diagnosticWifiQueue)WiFi.onEvent([](arduino_event_id_t event){
  if(event==ARDUINO_EVENT_WIFI_AP_STOP)diagnosticApStopped=true;
  if(event==ARDUINO_EVENT_WIFI_AP_START)diagnosticApStopped=false;
  if(event==ARDUINO_EVENT_WIFI_AP_START || event==ARDUINO_EVENT_WIFI_AP_STOP || event==ARDUINO_EVENT_WIFI_AP_STACONNECTED || event==ARDUINO_EVENT_WIFI_AP_STADISCONNECTED){uint32_t code=event;xQueueSend(diagnosticWifiQueue,&code,0);}
 });
}
static void diagnosticLoop(bool up){
 if(diagnosticWdt)esp_task_wdt_reset();
 uint32_t code;int drained=0;
 while(diagnosticWifiQueue && drained++<32 && xQueueReceive(diagnosticWifiQueue,&code,0)==pdTRUE){
  const char* name=code==ARDUINO_EVENT_WIFI_AP_START?"ap_start":code==ARDUINO_EVENT_WIFI_AP_STOP?"ap_stop":code==ARDUINO_EVENT_WIFI_AP_STACONNECTED?"station_connected":"station_disconnected";
  diagnosticEvent(name,code);
 }
 static unsigned long checked=0;static uint8_t failures=0;
 if(up && millis()-checked>=5000){
  checked=millis();wifi_mode_t mode=WIFI_MODE_NULL;
  bool healthy=esp_wifi_get_mode(&mode)==ESP_OK && (mode==WIFI_MODE_AP || mode==WIFI_MODE_APSTA) && !diagnosticApStopped;
  if(healthy)failures=0;else if(++failures>=3){diagnosticMark(90);diagnosticEvent("ap_recovery_restart",failures);Serial.flush();ESP.restart();}
 }
}

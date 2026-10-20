#pragma once
#include <WiFiUdp.h>
#include <Preferences.h>
#include <esp_netif.h>
#include <esp_system.h>
#include "dhcp_core.h"

static TermioDHCP::Server termioDHCP;
static SemaphoreHandle_t dhcpLock = nullptr;
static TaskHandle_t dhcpTaskHandle = nullptr;
static WiFiUDP dhcpUDP;
static bool dhcpRunning = false;
static String dhcpSettings;
static uint8_t dhcpChannel = 6;
static bool dhcpParse(cJSON* settings,TermioDHCP::Reservation* values,size_t& count,uint8_t& channel) {
  cJSON* list=cJSON_GetObjectItemCaseSensitive(settings,"reservations");
  cJSON* ch=cJSON_GetObjectItemCaseSensitive(settings,"channel");
  if(!cJSON_IsArray(list) || cJSON_GetArraySize(list)>16 || !cJSON_IsNumber(ch) || (ch->valuedouble!=1 && ch->valuedouble!=6 && ch->valuedouble!=11))return false;
  channel=ch->valueint;count=0;cJSON* row=nullptr;
  cJSON_ArrayForEach(row,list){
    const String mac=bridgeText(row,"mac"),ip=bridgeText(row,"ip");unsigned int m[6],a,b,c,d;int used=0;
    if(mac.length()!=17 || sscanf(mac.c_str(),"%2x:%2x:%2x:%2x:%2x:%2x%n",&m[0],&m[1],&m[2],&m[3],&m[4],&m[5],&used)!=6 || used!=17 || sscanf(ip.c_str(),"%u.%u.%u.%u%n",&a,&b,&c,&d,&used)!=4 || used!=(int)ip.length() || a!=192 || b!=168 || c!=4 || d<2 || d>99)return false;
    for(int j=0;j<6;j++)values[count].mac[j]=m[j];values[count].host=d;count++;
  }
  TermioDHCP::Server check;return check.configure(values,count);
}
static bool dhcpPersist(const String& text) {
  Preferences prefs;if(!prefs.begin("termio-net",false))return false;
  const bool ok=prefs.putString("settings",text)==text.length();prefs.end();return ok;
}
static bool dhcpApply(cJSON* settings,bool persist) {
  TermioDHCP::Reservation values[16]={};size_t count=0;uint8_t channel;
  if(!dhcpParse(settings,values,count,channel))return false;
  cJSON* plain=cJSON_CreateObject();cJSON_AddNumberToObject(plain,"channel",channel);
  cJSON_AddItemToObject(plain,"reservations",cJSON_Duplicate(cJSON_GetObjectItemCaseSensitive(settings,"reservations"),true));
  char* json=cJSON_PrintUnformatted(plain);String text=json?json:"";cJSON_free(json);cJSON_Delete(plain);
  if(text.isEmpty())return false;if(text==dhcpSettings)return true;
  // No guardar en flash por cada GET: sólo si cambió el catálogo de red.
  if(persist && !dhcpPersist(text))return false;
  xSemaphoreTake(dhcpLock,portMAX_DELAY);
  const bool reservationsChanged=termioDHCP.count!=count || memcmp(termioDHCP.reservations,values,count*sizeof(values[0]));
  if(reservationsChanged)termioDHCP.configure(values,count);
  xSemaphoreGive(dhcpLock);
  if(channel!=dhcpChannel && esp_wifi_set_channel(channel,WIFI_SECOND_CHAN_NONE)!=ESP_OK)return false;
  dhcpChannel=channel;dhcpSettings=text;
  // Las concesiones anteriores no se pueden modificar en el cliente en caliente.
  if(persist && dhcpRunning && reservationsChanged)esp_wifi_deauth_sta(0);
  return true;
}
static uint8_t dhcpAddress(const uint8_t* mac) {
  xSemaphoreTake(dhcpLock,portMAX_DELAY);uint8_t host=termioDHCP.address(mac,millis());xSemaphoreGive(dhcpLock);return host;
}
static void dhcpTask(void*) {
  uint8_t packet[600],response[300];
  for(;;){
    int size=dhcpUDP.parsePacket();
    if(size>0){
      if(size>600 || dhcpUDP.remotePort()!=68){while(dhcpUDP.available())dhcpUDP.read();}
      else{
        int len=dhcpUDP.read(packet,sizeof(packet));
        // Admitir solicitudes sólo de estaciones realmente asociadas a este AP.
        wifi_sta_list_t stations={};bool associated=false;
        if(len>=34 && esp_wifi_ap_get_sta_list(&stations)==ESP_OK)for(int i=0;i<stations.num;i++)if(!memcmp(stations.sta[i].mac,packet+28,6))associated=true;
        size_t bytes=0;
        xSemaphoreTake(dhcpLock,portMAX_DELAY);
        if(associated)bytes=termioDHCP.process(packet,len,response,sizeof(response),millis());
        xSemaphoreGive(dhcpLock);
        if(bytes){
          bool ok=dhcpUDP.beginPacket(IPAddress(255,255,255,255),68)==1;
          if(ok)ok=dhcpUDP.write(response,bytes)==bytes;
          if(ok)ok=dhcpUDP.endPacket()==1;
          if(!ok){xSemaphoreTake(dhcpLock,portMAX_DELAY);termioDHCP.errors++;xSemaphoreGive(dhcpLock);}
        }
      }
    }
    vTaskDelay(pdMS_TO_TICKS(5));
  }
}
static bool dhcpStart() {
  dhcpLock=xSemaphoreCreateMutex();if(!dhcpLock)return false;
  Preferences prefs;
  if(prefs.begin("termio-net",true)){String saved=prefs.getString("settings","");prefs.end();if(saved.length()){cJSON* settings=cJSON_Parse(saved.c_str());if(settings){dhcpApply(settings,false);cJSON_Delete(settings);}}}
  esp_netif_t* ap=esp_netif_get_handle_from_ifkey("WIFI_AP_DEF");if(!ap)return false;
  const esp_err_t stopped=esp_netif_dhcps_stop(ap);
  if(stopped!=ESP_OK && stopped!=ESP_ERR_ESP_NETIF_DHCP_ALREADY_STOPPED)return false;
  if(!dhcpUDP.begin(WiFi.softAPIP(),67))return false;
  if(xTaskCreate(dhcpTask,"termio-dhcp",6144,nullptr,1,&dhcpTaskHandle)!=pdPASS){dhcpUDP.stop();return false;}
  dhcpRunning=true;return true;
}
static void bridgeTelemetry() {
  cJSON* o=cJSON_CreateObject();if(!o)return;
  cJSON_AddStringToObject(o,"event","network");cJSON_AddNumberToObject(o,"protocol",1);
  cJSON_AddNumberToObject(o,"uptime_s",millis()/1000);cJSON_AddNumberToObject(o,"heap",ESP.getFreeHeap());cJSON_AddNumberToObject(o,"min_heap",ESP.getMinFreeHeap());
  cJSON_AddNumberToObject(o,"clients",WiFi.softAPgetStationNum());cJSON_AddNumberToObject(o,"channel",WiFi.channel());cJSON_AddNumberToObject(o,"reset_reason",esp_reset_reason());
  xSemaphoreTake(dhcpLock,portMAX_DELAY);
  cJSON_AddNumberToObject(o,"dhcp_offers",termioDHCP.offers);cJSON_AddNumberToObject(o,"dhcp_acks",termioDHCP.acks);cJSON_AddNumberToObject(o,"dhcp_naks",termioDHCP.naks);cJSON_AddNumberToObject(o,"dhcp_errors",termioDHCP.errors);
  xSemaphoreGive(dhcpLock);
  char* json=cJSON_PrintUnformatted(o);if(json){Serial.print("TERMIO_BRIDGE ");Serial.println(json);cJSON_free(json);}cJSON_Delete(o);
}

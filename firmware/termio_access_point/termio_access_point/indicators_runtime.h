#pragma once
// Active-high LEDs, each GPIO -> 220 ohm -> LED anode; cathode -> GND.
// Group order: fire, volcanic, energy, water, communications. No buzzer output.
static const uint8_t indicatorPins[5]={13,14,25,26,27};
static unsigned long indicatorUpdated=0;
static bool indicatorLive=false;
static void indicatorOff(){for(uint8_t pin:indicatorPins)digitalWrite(pin,LOW);indicatorLive=false;}
static void indicatorSetup(){for(uint8_t pin:indicatorPins){digitalWrite(pin,LOW);pinMode(pin,OUTPUT);}indicatorOff();}
static void indicatorCommand(cJSON* command){
 cJSON* groups=cJSON_GetObjectItemCaseSensitive(command,"groups");
 if(!cJSON_IsArray(groups)||cJSON_GetArraySize(groups)!=5)return;
 for(int i=0;i<5;i++)if(!cJSON_IsBool(cJSON_GetArrayItem(groups,i)))return;
 for(int i=0;i<5;i++)digitalWrite(indicatorPins[i],cJSON_IsTrue(cJSON_GetArrayItem(groups,i))?HIGH:LOW);
 indicatorUpdated=millis();indicatorLive=true;
 cJSON* p=cJSON_CreateObject();if(!p)return;cJSON_AddStringToObject(p,"event","leds");cJSON_AddItemToObject(p,"groups",cJSON_Duplicate(groups,true));
 char* text=cJSON_PrintUnformatted(p);if(text){Serial.print("TERMIO_BRIDGE ");Serial.println(text);cJSON_free(text);}cJSON_Delete(p);
}
static void indicatorLoop(){if(indicatorLive && millis()-indicatorUpdated>15000)indicatorOff();}

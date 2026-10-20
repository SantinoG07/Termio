#pragma once
#include <mbedtls/base64.h>
#include <esp_system.h>

// One bounded, non-blocking HTTP request. SQLite remains on the USB-connected PC.
static WiFiServer centralServer(80);
static WiFiClient centralClient;
static String centralHeader, centralId;
static unsigned long centralStarted=0;
static bool centralWaiting=false, centralBegun=false;
static size_t centralLength=0, centralWritten=0;
static int centralSeq=-1;

static void centralEvent(const char* event,int seq=-2,bool ok=true,const char* path=nullptr) {
  cJSON* p=cJSON_CreateObject(); if(!p)return;
  cJSON_AddStringToObject(p,"event",event);cJSON_AddStringToObject(p,"request_id",centralId.c_str());
  cJSON_AddBoolToObject(p,"ok",ok);
  if(seq>=-1)cJSON_AddNumberToObject(p,"seq",seq);
  if(path){cJSON_AddStringToObject(p,"path",path);cJSON_AddStringToObject(p,"method","GET");}
  char* s=cJSON_PrintUnformatted(p);if(s){Serial.print("TERMIO_BRIDGE ");Serial.println(s);cJSON_free(s);}cJSON_Delete(p);
}
static void centralReset(){centralClient.stop();centralHeader="";centralId="";centralWaiting=false;centralBegun=false;centralWritten=0;centralLength=0;centralSeq=-1;}
static void centralError(WiFiClient& client,int code,const char* reason){
  String body=String("{\"error\":\"")+reason+"\"}";
  client.printf("HTTP/1.1 %d Error\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: %u\r\n\r\n",code,(unsigned)body.length());client.print(body);client.stop();
}
static void centralAbort(const char* reason){if(centralWaiting)centralEvent("api_abort",-2,false);if(!centralBegun && centralClient.connected())centralError(centralClient,503,reason);centralReset();}
static bool centralSafeHeader(const char* text){if(strlen(text)>200)return false;for(const char* p=text;*p;p++)if((uint8_t)*p<32 || (uint8_t)*p==127)return false;return true;}
static void centralCommand(cJSON* command){
  if(!centralWaiting || centralId!=bridgeText(command,"request_id"))return;
  const String op=bridgeText(command,"op");
  if(op=="api_cancel"){centralAbort("BACKEND_UNAVAILABLE");return;}
  if(!centralClient.connected()){centralAbort("CLIENT_DISCONNECTED");return;}
  if(op=="api_begin" && !centralBegun){
    cJSON* status=cJSON_GetObjectItemCaseSensitive(command,"status"),*length=cJSON_GetObjectItemCaseSensitive(command,"length");
    if(!cJSON_IsNumber(status)||!cJSON_IsNumber(length)||status->valueint<200||status->valueint>599||length->valuedouble<1||length->valuedouble>32768||length->valuedouble!=length->valueint){centralAbort("INVALID_RESPONSE");return;}
    centralLength=length->valueint;
    String headers=String("HTTP/1.1 ")+status->valueint+" Response\r\nConnection: close\r\nContent-Length: "+(unsigned)centralLength+"\r\n";
    cJSON* values=cJSON_GetObjectItemCaseSensitive(command,"headers");
    const char* allowed[]={"Content-Type","Cache-Control","X-Content-Type-Options","X-Termio-Source","X-Termio-Received-At","X-Termio-Data-Age-Seconds","X-Termio-Stale","X-Termio-Clock-Synced","X-Termio-Connection","Allow"};
    for(const char* key:allowed){const char* value=bridgeText(values,key);if(*value && centralSafeHeader(value)){headers+=key;headers+=": ";headers+=value;headers+="\r\n";}}
    headers+="\r\n";
    if(centralClient.write((const uint8_t*)headers.c_str(),headers.length())!=headers.length()){centralAbort("TCP_WRITE_FAILED");return;}
    centralBegun=true;centralEvent("api_ack",-1);return;
  }
  if(op=="api_chunk" && centralBegun){
    cJSON* seq=cJSON_GetObjectItemCaseSensitive(command,"seq");const char* data=bridgeText(command,"data");
    uint8_t bytes[512];size_t size=0;
    if(!cJSON_IsNumber(seq)||seq->valuedouble!=centralSeq+1||strlen(data)>684||mbedtls_base64_decode(bytes,sizeof(bytes),&size,(const unsigned char*)data,strlen(data))!=0||!size||centralWritten+size>centralLength){centralAbort("INVALID_CHUNK");return;}
    if(centralClient.write(bytes,size)!=size){centralAbort("TCP_WRITE_FAILED");return;}
    centralWritten+=size;centralSeq++;centralEvent("api_ack",centralSeq);return;
  }
  if(op=="api_end" && centralBegun){const bool ok=centralWritten==centralLength;centralEvent("api_done",-2,ok);centralReset();}
}
static void centralSetup(){centralServer.begin();centralServer.setNoDelay(true);centralHeader.reserve(2048);}
static void centralLoop(){
  WiFiClient incoming=centralServer.accept();
  if(incoming){incoming.setTimeout(1);if(centralClient){centralError(incoming,503,"GATEWAY_BUSY");}else{centralClient=incoming;centralStarted=millis();centralHeader="";centralWaiting=false;centralBegun=false;}}
  if(!centralClient)return;
  if(!centralClient.connected()){centralAbort("CLIENT_DISCONNECTED");return;}
  if(millis()-centralStarted>(centralWaiting?45000UL:5000UL)){centralAbort("GATEWAY_TIMEOUT");return;}
  if(centralWaiting)return;
  for(int n=0;n<256 && centralClient.available();n++){
    const char ch=centralClient.read();centralHeader+=ch;
    if(centralHeader.length()>2048){centralError(centralClient,431,"HEADERS_TOO_LARGE");centralReset();return;}
    if(!centralHeader.endsWith("\r\n\r\n"))continue;
    const int end=centralHeader.indexOf("\r\n"),first=centralHeader.indexOf(' '),last=centralHeader.indexOf(' ',first+1);
    if(first!=3 || centralHeader.substring(0,first)!="GET"){centralError(centralClient,405,"GET_ONLY");centralReset();return;}
    const String version=centralHeader.substring(last+1,end),path=centralHeader.substring(first+1,last);
    String lower=centralHeader;lower.toLowerCase();
    bool bad=last<first || (version!="HTTP/1.1"&&version!="HTTP/1.0") || path.length()>1200 || !(path.startsWith("/api/v1/")||path.startsWith("/v1/"));
    for(size_t i=0;i<path.length();i++)if((uint8_t)path[i]<=32||(uint8_t)path[i]==127)bad=true;
    // Read-only gateway: never accept a request body or transfer encoding.
    if(lower.indexOf("\r\ntransfer-encoding:")>=0 || lower.indexOf("\r\ncontent-length:")>=0)bad=true;
    if(bad){centralError(centralClient,400,"INVALID_REQUEST");centralReset();return;}
    char id[40];snprintf(id,sizeof(id),"api-%08lx-%08lx",(unsigned long)esp_random(),(unsigned long)millis());centralId=id;
    centralWaiting=true;centralStarted=millis();centralEvent("api_request",-2,true,path.c_str());centralHeader="";return;
  }
}

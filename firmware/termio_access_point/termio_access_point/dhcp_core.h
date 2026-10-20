#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>

// Servidor DHCPv4 mínimo para una sola red local /24, sin relay ni DNS.
// Reservas .2-.99; pool dinámico separado .100-.199; no usa estado privado de lwIP.
namespace TermioDHCP {
struct Reservation { uint8_t mac[6]; uint8_t host; };
struct Lease { uint8_t mac[6]; uint8_t host; uint32_t expires; bool acked; };
class Server {
 public:
  Reservation reservations[16] = {};
  size_t count = 0;
  Lease leases[32] = {};
  uint32_t quarantine[200] = {};
  uint32_t offers = 0, acks = 0, naks = 0, errors = 0;
  static constexpr uint32_t leaseMs = 3600000;
  bool configure(const Reservation* values, size_t size) {
    if (size > 16) return false;
    for (size_t i=0;i<size;i++) {
      if (values[i].host<2 || values[i].host>99 || (values[i].mac[0]&1)) return false;
      const uint8_t zero[6]={}; if (!memcmp(values[i].mac,zero,6)) return false;
      for(size_t j=0;j<i;j++) if(values[i].host==values[j].host || !memcmp(values[i].mac,values[j].mac,6)) return false;
    }
    memset(reservations,0,sizeof(reservations)); if(size) memcpy(reservations,values,size*sizeof(Reservation)); count=size;
    // Llamar sólo al iniciar o después de reconectar todas las estaciones.
    memset(leases,0,sizeof(leases)); memset(quarantine,0,sizeof(quarantine)); return true;
  }
  bool live(uint32_t end,uint32_t now) const { return end && int32_t(end-now)>0; }
  uint8_t address(const uint8_t* mac,uint32_t now) const {
    for(const auto& l:leases) if(l.host && l.acked && live(l.expires,now) && !memcmp(l.mac,mac,6)) return l.host;
    return 0;
  }
  // out >= 300 bytes. Retorna bytes de respuesta o 0 para descartar.
  size_t process(const uint8_t* in,size_t len,uint8_t* out,size_t capacity,uint32_t now) {
    if(len<240 || len>600 || capacity<300 || in[0]!=1 || in[1]!=1 || in[2]!=6 || in[3]!=0 || in[24] || in[25] || in[26] || in[27] || memcmp(in+236,"\x63\x82\x53\x63",4)) {errors++;return 0;}
    const uint8_t* mac=in+28; const uint8_t zero[6]={}; if((mac[0]&1) || !memcmp(mac,zero,6)){errors++;return 0;}
    int type=0; bool requested=false,serverID=false; uint8_t requestedIP[4]={},serverIP[4]={};
    for(size_t p=240;p<len;) {
      uint8_t option=in[p++]; if(option==255)break; if(!option)continue;
      if(p>=len || p+1+in[p]>len){errors++;return 0;}
      uint8_t n=in[p++];
      if(option==53){if(n!=1 || type){errors++;return 0;}type=in[p];}
      if(option==50){if(n!=4 || requested){errors++;return 0;}requested=true;memcpy(requestedIP,in+p,4);}
      if(option==54){if(n!=4 || serverID){errors++;return 0;}serverID=true;memcpy(serverIP,in+p,4);}
      p+=n;
    }
    const uint8_t ap[4]={192,168,4,1}; if(serverID && memcmp(serverIP,ap,4))return 0;
    Lease* existing=nullptr; Lease* freeSlot=nullptr;
    for(auto& l:leases){if(l.host && !live(l.expires,now))l={};if(l.host && !memcmp(l.mac,mac,6))existing=&l;if(!l.host && !freeSlot)freeSlot=&l;}
    uint8_t reserved=0;for(size_t i=0;i<count;i++)if(!memcmp(reservations[i].mac,mac,6))reserved=reservations[i].host;
    auto available=[&](uint8_t h){
      if(h<2 || h>199 || live(quarantine[h],now))return false;
      if(reserved){if(h!=reserved)return false;}else if(h<100)return false;
      for(const auto& l:leases)if(l.host==h && memcmp(l.mac,mac,6))return false;
      return true;
    };
    uint8_t desired=0;bool validIP=true;
    if(requested){validIP=requestedIP[0]==192 && requestedIP[1]==168 && requestedIP[2]==4;desired=requestedIP[3];}
    else if(in[12] || in[13] || in[14] || in[15]){validIP=in[12]==192 && in[13]==168 && in[14]==4;desired=in[15];}
    if(type==7){if(existing && validIP && desired==existing->host)*existing={};return 0;}
    if(type==4){if(existing && requested && validIP && desired==existing->host){quarantine[desired]=now+600000;*existing={};}return 0;}
    if(type!=1 && type!=3 && type!=8)return 0;
    uint8_t response=0,host=0;
    if(type==8){response=5;}
    else if(type==1){
      if(reserved && available(reserved))host=reserved;
      else if(!reserved && existing && available(existing->host))host=existing->host;
      else if(!reserved && validIP && available(desired))host=desired;
      else if(!reserved)for(int h=100;h<=199;h++)if(available(h)){host=h;break;}
      if(!host || (!existing && !freeSlot)){errors++;return 0;} response=2;
    }else{
      if(validIP && desired && available(desired) && (existing || freeSlot)){host=desired;response=5;}
      else response=6;
    }
    if(host){Lease* slot=existing?existing:freeSlot;memcpy(slot->mac,mac,6);slot->host=host;slot->expires=now+(response==2 && !slot->acked?60000:leaseMs);if(response==5)slot->acked=true;}
    memset(out,0,300);out[0]=2;out[1]=1;out[2]=6;memcpy(out+4,in+4,4);memcpy(out+28,mac,6);
    // Broadcast para DORA/NAK, sin depender de ARP de un cliente aún sin IP.
    out[10]=0x80; if(response==5 && type!=8)memcpy(out+12,in+12,4);
    if(host){out[16]=192;out[17]=168;out[18]=4;out[19]=host;}memcpy(out+20,ap,4);memcpy(out+236,in+236,4);
    size_t p=240;auto option=[&](uint8_t code,const uint8_t* bytes,uint8_t n){out[p++]=code;out[p++]=n;memcpy(out+p,bytes,n);p+=n;};
    option(53,&response,1);option(54,ap,4);
    if(response!=6){const uint8_t mask[4]={255,255,255,0};option(1,mask,4);option(3,ap,4);
      if(type!=8){const uint8_t lease[4]={0,0,14,16},renew[4]={0,0,7,8},rebind[4]={0,0,12,78};option(51,lease,4);option(58,renew,4);option(59,rebind,4);}
    }
    out[p++]=255;if(response==2)offers++;else if(response==5)acks++;else naks++;
    return p<300?300:p;
  }
};
}

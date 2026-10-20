#include "../firmware/termio_access_point/termio_access_point/dhcp_core.h"
#include <vector>
#include <cassert>
#include <cstdio>
#include <random>
using namespace TermioDHCP;
const uint8_t mac1[6]={0xec,0x8e,0x77,0x10,0xd4,0xe8};
const uint8_t mac2[6]={0x74,0x97,0x79,0x51,0xdd,0xc1};
std::vector<uint8_t> packet(int type,const uint8_t* mac,int requested=0){
 std::vector<uint8_t> p(240,0);p[0]=1;p[1]=1;p[2]=6;p[4]=42;memcpy(p.data()+28,mac,6);memcpy(p.data()+236,"\x63\x82\x53\x63",4);
 p.insert(p.end(),{53,1,(uint8_t)type});if(requested)p.insert(p.end(),{50,4,192,168,4,(uint8_t)requested});p.push_back(255);return p;
}
int main(){
 Server server;Reservation r={};memcpy(r.mac,mac1,6);r.host=12;assert(server.configure(&r,1));uint8_t out[300];
 auto process=[&](std::vector<uint8_t> p){return server.process(p.data(),p.size(),out,sizeof(out),1000);};
 assert(process(packet(1,mac1))==300 && out[19]==12 && out[242]==2);assert(server.address(mac1,1000)==0);
 assert(process(packet(3,mac1,12))==300 && out[242]==5);assert(server.address(mac1,1000)==12);
 assert(process(packet(1,mac1))==300 && out[19]==12);assert(server.address(mac1,1000)==12);
 assert(process(packet(1,mac2))==300 && out[19]==100);assert(process(packet(3,mac2,100))==300 && out[242]==5);
 assert(process(packet(3,mac2,12))==300 && out[242]==6);assert(server.address(mac2,1000)==100);
 assert(process(packet(3,mac1,100))==300 && out[242]==6);
 auto renew=packet(3,mac1);renew[12]=192;renew[13]=168;renew[14]=4;renew[15]=12;assert(process(renew)==300 && out[242]==5);
 auto other=packet(3,mac1,12);other.pop_back();other.insert(other.end(),{54,4,192,168,4,9,255});assert(process(other)==0);
 Server reboot;assert(reboot.configure(&r,1));auto d=packet(1,mac1);assert(reboot.process(d.data(),d.size(),out,sizeof(out),2000)==300 && out[19]==12);
 Reservation duplicate[2]={r,r};assert(!server.configure(duplicate,2));r.host=1;assert(!server.configure(&r,1));
 auto release=packet(7,mac2);release[12]=192;release[13]=168;release[14]=4;release[15]=100;assert(process(release)==0 && server.address(mac2,1000)==0);
 assert(process(packet(1,mac2))==300 && out[19]==100);assert(process(packet(3,mac2,100))==300);assert(process(packet(4,mac2,100))==0);assert(process(packet(1,mac2))==300 && out[19]==101);
 auto malformed=packet(1,mac1);malformed.pop_back();malformed.insert(malformed.end(),{50,255,1});assert(process(malformed)==0);
 // Fuzz de tamaños/opciones con ASan/UBSan, sin red ni placa.
 std::mt19937 rng(6);for(int i=0;i<20000;i++){auto p=packet(1,mac1);p.resize(rng()%601);for(int j=0;j<12 && !p.empty();j++)p[rng()%p.size()]=rng()%256;server.process(p.data(),p.size(),out,sizeof(out),2000);}
 puts("PASS DHCP core: reserva MAC/IP, DORA, renovación, reinicio, pool separado, NAK, RELEASE, DECLINE, entradas inválidas y 20000 paquetes fuzz.");
}

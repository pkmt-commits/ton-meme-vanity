// TON W5 (v5r1) vanity на GPU. seed-based ed25519 (импортируется в My Wallet).
// Корректность: математика comb сверена с noble (gen_table.mjs), SHA-константы с Node,
// и режим --selftest сверяет адреса 20 эталонных сидов перед доверием.
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <cstdlib>
#include <chrono>
#include <string>
#include <random>
#include <thread>
#include <nvml.h>

typedef unsigned long long u64;
typedef unsigned char u8;

#include "sha_const.h"
#include "calib.h"
#include "base_table.h"   // __device__ u64 BASE_TABLE[64][8][3][5]
#include "words.h"        // DICT[NW][WMAXL], DLEN[NW], NW

#define M51 2251799813685247ULL  // 2^51 - 1
#define SUB0 4503599627370458ULL // 2*(2^51-19)
#define SUBN 4503599627370494ULL // 2*(2^51-1)
#define HITB 80                  // байт на находку: сид 32 + адрес 48
#ifndef ITERS
#define ITERS 8                  // ключей на поток за запуск
#endif

// ---------------- field (radix 2^51) ----------------
__device__ __forceinline__ void fe_copy(u64 o[5], const u64 a[5]){ o[0]=a[0];o[1]=a[1];o[2]=a[2];o[3]=a[3];o[4]=a[4]; }
__device__ __forceinline__ void fe_0(u64 o[5]){ o[0]=o[1]=o[2]=o[3]=o[4]=0; }
__device__ __forceinline__ void fe_1(u64 o[5]){ o[0]=1; o[1]=o[2]=o[3]=o[4]=0; }

__device__ __forceinline__ void fe_reduce(u64 h[5]){
  u64 c;
  c=h[0]>>51; h[0]&=M51; h[1]+=c;
  c=h[1]>>51; h[1]&=M51; h[2]+=c;
  c=h[2]>>51; h[2]&=M51; h[3]+=c;
  c=h[3]>>51; h[3]&=M51; h[4]+=c;
  c=h[4]>>51; h[4]&=M51; h[0]+=19*c;
  c=h[0]>>51; h[0]&=M51; h[1]+=c;
}
__device__ __forceinline__ void fe_add(u64 o[5], const u64 a[5], const u64 b[5]){
  o[0]=a[0]+b[0]; o[1]=a[1]+b[1]; o[2]=a[2]+b[2]; o[3]=a[3]+b[3]; o[4]=a[4]+b[4];
  fe_reduce(o);
}
__device__ __forceinline__ void fe_sub(u64 o[5], const u64 a[5], const u64 b[5]){
  o[0]=a[0]+SUB0-b[0]; o[1]=a[1]+SUBN-b[1]; o[2]=a[2]+SUBN-b[2]; o[3]=a[3]+SUBN-b[3]; o[4]=a[4]+SUBN-b[4];
  fe_reduce(o);
}
// 128-битный аккумулятор на паре u64 (MSVC не знает __int128)
__device__ __forceinline__ void mac(u64 &lo, u64 &hi, u64 x, u64 y){
  u64 p=x*y, h=__umul64hi(x,y); u64 old=lo; lo+=p; hi += h + (lo<old);
}
__device__ void fe_mul(u64 o[5], const u64 a[5], const u64 b[5]){
  u64 a0=a[0],a1=a[1],a2=a[2],a3=a[3],a4=a[4];
  u64 b0=b[0],b1=b[1],b2=b[2],b3=b[3],b4=b[4];
  u64 a1_19=19*a1, a2_19=19*a2, a3_19=19*a3, a4_19=19*a4;
  u64 l0=0,h0=0,l1=0,h1=0,l2=0,h2=0,l3=0,h3=0,l4=0,h4=0;
  mac(l0,h0,a0,b0); mac(l0,h0,a1_19,b4); mac(l0,h0,a2_19,b3); mac(l0,h0,a3_19,b2); mac(l0,h0,a4_19,b1);
  mac(l1,h1,a0,b1); mac(l1,h1,a1,b0);    mac(l1,h1,a2_19,b4); mac(l1,h1,a3_19,b3); mac(l1,h1,a4_19,b2);
  mac(l2,h2,a0,b2); mac(l2,h2,a1,b1);    mac(l2,h2,a2,b0);    mac(l2,h2,a3_19,b4); mac(l2,h2,a4_19,b3);
  mac(l3,h3,a0,b3); mac(l3,h3,a1,b2);    mac(l3,h3,a2,b1);    mac(l3,h3,a3,b0);    mac(l3,h3,a4_19,b4);
  mac(l4,h4,a0,b4); mac(l4,h4,a1,b3);    mac(l4,h4,a2,b2);    mac(l4,h4,a3,b1);    mac(l4,h4,a4,b0);
  u64 c, old;
  c=(h0<<13)|(l0>>51); u64 r0=l0&M51;
  old=l1; l1+=c; h1+=(l1<old); c=(h1<<13)|(l1>>51); u64 r1=l1&M51;
  old=l2; l2+=c; h2+=(l2<old); c=(h2<<13)|(l2>>51); u64 r2=l2&M51;
  old=l3; l3+=c; h3+=(l3<old); c=(h3<<13)|(l3>>51); u64 r3=l3&M51;
  old=l4; l4+=c; h4+=(l4<old); c=(h4<<13)|(l4>>51); u64 r4=l4&M51;
  r0 += 19*c;
  u64 cc=r0>>51; r0&=M51; r1+=cc;
  o[0]=r0;o[1]=r1;o[2]=r2;o[3]=r3;o[4]=r4;
}
__device__ __forceinline__ void fe_sq(u64 o[5], const u64 a[5]){ fe_mul(o,a,a); }
__device__ void fe_invert(u64 o[5], const u64 z[5]){
  u64 t0[5],t1[5],t2[5],t3[5]; int i;
  fe_sq(t0,z);
  fe_sq(t1,t0); fe_sq(t1,t1); fe_mul(t1,z,t1);
  fe_mul(t0,t0,t1);
  fe_sq(t2,t0); fe_mul(t1,t1,t2);
  fe_sq(t2,t1); for(i=0;i<4;i++) fe_sq(t2,t2); fe_mul(t1,t2,t1);
  fe_sq(t2,t1); for(i=0;i<9;i++) fe_sq(t2,t2); fe_mul(t2,t2,t1);
  fe_sq(t3,t2); for(i=0;i<19;i++) fe_sq(t3,t3); fe_mul(t2,t3,t2);
  fe_sq(t2,t2); for(i=0;i<9;i++) fe_sq(t2,t2); fe_mul(t1,t2,t1);
  fe_sq(t2,t1); for(i=0;i<49;i++) fe_sq(t2,t2); fe_mul(t2,t2,t1);
  fe_sq(t3,t2); for(i=0;i<99;i++) fe_sq(t3,t3); fe_mul(t2,t3,t2);
  fe_sq(t2,t2); for(i=0;i<49;i++) fe_sq(t2,t2); fe_mul(t1,t2,t1);
  fe_sq(t1,t1); for(i=0;i<4;i++) fe_sq(t1,t1); fe_mul(o,t1,t0);
}
__device__ void fe_tobytes(u8 s[32], const u64 h[5]){
  u64 t0=h[0],t1=h[1],t2=h[2],t3=h[3],t4=h[4],c;
  c=t0>>51; t0&=M51; t1+=c; c=t1>>51; t1&=M51; t2+=c;
  c=t2>>51; t2&=M51; t3+=c; c=t3>>51; t3&=M51; t4+=c;
  c=t4>>51; t4&=M51; t0+=19*c; c=t0>>51; t0&=M51; t1+=c;
  u64 q=(t0+19)>>51; q=(t1+q)>>51; q=(t2+q)>>51; q=(t3+q)>>51; q=(t4+q)>>51;
  t0+=19*q;
  c=t0>>51; t0&=M51; t1+=c; c=t1>>51; t1&=M51; t2+=c;
  c=t2>>51; t2&=M51; t3+=c; c=t3>>51; t3&=M51; t4+=c; c=t4>>51; t4&=M51;
  u64 s0=t0 | (t1<<51);
  u64 s1=(t1>>13) | (t2<<38);
  u64 s2=(t2>>26) | (t3<<25);
  u64 s3=(t3>>39) | (t4<<12);
  #pragma unroll
  for(int i=0;i<8;i++){ s[i]=s0>>(8*i); s[8+i]=s1>>(8*i); s[16+i]=s2>>(8*i); s[24+i]=s3>>(8*i); }
}

// ---------------- group (extended coords) ----------------
__device__ void madd_p3(u64 X[5],u64 Y[5],u64 Z[5],u64 T[5], const u64 q0[5], const u64 q1[5], const u64 q2[5]){
  u64 YpX[5],YmX[5],A[5],B[5],C[5],D[5],rX[5],rY[5],rZ[5],rT[5];
  fe_add(YpX,Y,X); fe_sub(YmX,Y,X);
  fe_mul(A,YpX,q0); fe_mul(B,YmX,q1); fe_mul(C,q2,T); fe_add(D,Z,Z);
  fe_sub(rX,A,B); fe_add(rY,A,B); fe_add(rZ,D,C); fe_sub(rT,D,C);
  fe_mul(X,rX,rT); fe_mul(Y,rY,rZ); fe_mul(Z,rZ,rT); fe_mul(T,rX,rY);
}

__device__ void scalarmult_base(u8 pub[32], const u8 a[32]){
  signed char e[64];
  #pragma unroll
  for(int i=0;i<32;i++){ e[2*i]=a[i]&15; e[2*i+1]=(a[i]>>4)&15; }
  int carry=0;
  for(int i=0;i<63;i++){ int v=e[i]+carry; carry=(v+8)>>4; e[i]=v-(carry<<4); }
  e[63]+=carry;
  u64 X[5],Y[5],Z[5],T[5]; fe_0(X); fe_1(Y); fe_1(Z); fe_0(T);
  for(int i=0;i<64;i++){
    int d=e[i]; if(d==0) continue;
    int mag = d<0 ? -d : d;
    const u64* q0=BASE_TABLE[i][mag-1][0];
    const u64* q1=BASE_TABLE[i][mag-1][1];
    const u64* q2=BASE_TABLE[i][mag-1][2];
    if(d>0){ madd_p3(X,Y,Z,T,q0,q1,q2); }
    else { u64 nq2[5]; u64 zero[5]; fe_0(zero); fe_sub(nq2,zero,q2); madd_p3(X,Y,Z,T,q1,q0,nq2); }
  }
  u64 zi[5],x[5],y[5]; fe_invert(zi,Z); fe_mul(x,X,zi); fe_mul(y,Y,zi);
  u8 xb[32]; fe_tobytes(pub,y); fe_tobytes(xb,x);
  pub[31] |= (xb[0]&1)<<7;
}

// v10: то же без финального обращения — для пакетного обращения Монтгомери (одно fe_invert на ITERS ключей)
__device__ void scalarmult_base_xyz(u64 X[5], u64 Y[5], u64 Z[5], const u8 a[32]){
  signed char e[64];
  #pragma unroll
  for(int i=0;i<32;i++){ e[2*i]=a[i]&15; e[2*i+1]=(a[i]>>4)&15; }
  int carry=0;
  for(int i=0;i<63;i++){ int v=e[i]+carry; carry=(v+8)>>4; e[i]=v-(carry<<4); }
  e[63]+=carry;
  u64 T[5]; fe_0(X); fe_1(Y); fe_1(Z); fe_0(T);
  for(int i=0;i<64;i++){
    int d=e[i]; if(d==0) continue;
    int mag = d<0 ? -d : d;
    const u64* q0=BASE_TABLE[i][mag-1][0];
    const u64* q1=BASE_TABLE[i][mag-1][1];
    const u64* q2=BASE_TABLE[i][mag-1][2];
    if(d>0){ madd_p3(X,Y,Z,T,q0,q1,q2); }
    else { u64 nq2[5]; u64 zero[5]; fe_0(zero); fe_sub(nq2,zero,q2); madd_p3(X,Y,Z,T,q1,q0,nq2); }
  }
}
__device__ void encode_pub(u8 pub[32], const u64 X[5], const u64 Y[5], const u64 zi[5]){
  u64 x[5],y[5]; fe_mul(x,X,zi); fe_mul(y,Y,zi);
  u8 xb[32]; fe_tobytes(pub,y); fe_tobytes(xb,x);
  pub[31] |= (xb[0]&1)<<7;
}

// ---------------- SHA-512 (один блок, вход 32 байта) ----------------
__device__ __forceinline__ u64 ror64(u64 x,int n){ return (x>>n)|(x<<(64-n)); }
__device__ void sha512_32(u8 out[64], const u8 in[32]){
  u8 blk[128];
  #pragma unroll
  for(int i=0;i<128;i++) blk[i]=0;
  for(int i=0;i<32;i++) blk[i]=in[i];
  blk[32]=0x80;
  // длина 256 бит в последние 16 байт (big-endian): байт 126=0x01
  blk[126]=0x01;
  u64 w[80];
  #pragma unroll
  for(int i=0;i<16;i++){
    w[i]=0; for(int j=0;j<8;j++) w[i]=(w[i]<<8)|blk[i*8+j];
  }
  for(int i=16;i<80;i++){
    u64 s0=ror64(w[i-15],1)^ror64(w[i-15],8)^(w[i-15]>>7);
    u64 s1=ror64(w[i-2],19)^ror64(w[i-2],61)^(w[i-2]>>6);
    w[i]=w[i-16]+s0+w[i-7]+s1;
  }
  u64 a=SHA512_H[0],b=SHA512_H[1],c=SHA512_H[2],d=SHA512_H[3];
  u64 e=SHA512_H[4],f=SHA512_H[5],g=SHA512_H[6],h=SHA512_H[7];
  for(int i=0;i<80;i++){
    u64 S1=ror64(e,14)^ror64(e,18)^ror64(e,41);
    u64 ch=(e&f)^((~e)&g);
    u64 t1=h+S1+ch+SHA512_K[i]+w[i];
    u64 S0=ror64(a,28)^ror64(a,34)^ror64(a,39);
    u64 maj=(a&b)^(a&c)^(b&c);
    u64 t2=S0+maj;
    h=g;g=f;f=e;e=d+t1;d=c;c=b;b=a;a=t1+t2;
  }
  u64 H[8]={SHA512_H[0]+a,SHA512_H[1]+b,SHA512_H[2]+c,SHA512_H[3]+d,SHA512_H[4]+e,SHA512_H[5]+f,SHA512_H[6]+g,SHA512_H[7]+h};
  for(int i=0;i<8;i++) for(int j=0;j<8;j++) out[i*8+j]=H[i]>>(56-8*j);
}

// ---------------- SHA-256 (вход <= 120 байт) ----------------
__device__ __forceinline__ unsigned ror32(unsigned x,int n){ return (x>>n)|(x<<(32-n)); }
__device__ void sha256_buf(u8 out[32], const u8* in, int len){
  u8 blk[128];
  int nb = ((len+9+63)/64); // число блоков
  int total = nb*64;
  for(int i=0;i<total;i++) blk[i]=0;
  for(int i=0;i<len;i++) blk[i]=in[i];
  blk[len]=0x80;
  u64 bits=(u64)len*8;
  for(int i=0;i<8;i++) blk[total-1-i]=bits>>(8*i);
  unsigned H[8]; for(int i=0;i<8;i++) H[i]=SHA256_H[i];
  for(int b=0;b<nb;b++){
    unsigned w[64];
    for(int i=0;i<16;i++){ const u8* p=blk+b*64+i*4; w[i]=(p[0]<<24)|(p[1]<<16)|(p[2]<<8)|p[3]; }
    for(int i=16;i<64;i++){
      unsigned s0=ror32(w[i-15],7)^ror32(w[i-15],18)^(w[i-15]>>3);
      unsigned s1=ror32(w[i-2],17)^ror32(w[i-2],19)^(w[i-2]>>10);
      w[i]=w[i-16]+s0+w[i-7]+s1;
    }
    unsigned a=H[0],bb=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
    for(int i=0;i<64;i++){
      unsigned S1=ror32(e,6)^ror32(e,11)^ror32(e,25);
      unsigned ch=(e&f)^((~e)&g);
      unsigned t1=h+S1+ch+SHA256_K[i]+w[i];
      unsigned S0=ror32(a,2)^ror32(a,13)^ror32(a,22);
      unsigned maj=(a&bb)^(a&c)^(bb&c);
      unsigned t2=S0+maj;
      h=g;g=f;f=e;e=d+t1;d=c;c=bb;bb=a;a=t1+t2;
    }
    H[0]+=a;H[1]+=bb;H[2]+=c;H[3]+=d;H[4]+=e;H[5]+=f;H[6]+=g;H[7]+=h;
  }
  for(int i=0;i<8;i++) for(int j=0;j<4;j++) out[i*4+j]=H[i]>>(24-8*j);
}

// ---------------- CRC16 / base64 / адрес ----------------
__device__ unsigned crc16(const u8* b, int len){
  unsigned c=0;
  for(int i=0;i<len;i++){
    c ^= (unsigned)b[i]<<8;
    for(int k=0;k<8;k++) c = (c&0x8000)?((c<<1)^0x1021):(c<<1);
  }
  return c&0xffff;
}
__device__ __constant__ char B64[65]="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

__device__ void addr_from_pub(const u8 pub[32], u8 addrHash[32], char raw[48]);
// seed(32) -> pubkey(32), addrHash(32), полная UQ-строка raw[48] (как есть)
__device__ void compute(const u8 seed[32], u8 pub[32], u8 addrHash[32], char raw[48]){
  u8 h[64]; sha512_32(h, seed);
  u8 a[32]; for(int i=0;i<32;i++) a[i]=h[i];
  a[0]&=248; a[31]&=127; a[31]|=64;
  scalarmult_base(pub, a);
  addr_from_pub(pub, addrHash, raw);
}
__device__ void seed_to_scalar(u8 a[32], const u8 seed[32]){
  u8 h[64]; sha512_32(h, seed);
  for(int i=0;i<32;i++) a[i]=h[i];
  a[0]&=248; a[31]&=127; a[31]|=64;
}
// pubkey(32) -> addrHash(32), raw[48]
__device__ void addr_from_pub(const u8 pub[32], u8 addrHash[32], char raw[48]){
  // data aug
  u8 aug[TEMPLATE_LEN];
  for(int i=0;i<TEMPLATE_LEN;i++) aug[i]=TEMPLATE_AUG[i];
  int bit=PUBKEY_BIT_OFF;
  for(int i=0;i<32;i++){ u8 bb=pub[i]; for(int k=7;k>=0;k--){ int bi=bit>>3,sh=7-(bit&7); if((bb>>k)&1) aug[bi]|=1<<sh; else aug[bi]&=~(1<<sh); bit++; } }
  u8 dataIn[2+TEMPLATE_LEN]; dataIn[0]=0x00; dataIn[1]=(u8)DATA_D2;
  for(int i=0;i<TEMPLATE_LEN;i++) dataIn[2+i]=aug[i];
  u8 dataHash[32]; sha256_buf(dataHash, dataIn, 2+TEMPLATE_LEN);
  u8 addrIn[CONST_PREFIX_LEN+32];
  for(int i=0;i<CONST_PREFIX_LEN;i++) addrIn[i]=CONST_PREFIX[i];
  for(int i=0;i<32;i++) addrIn[CONST_PREFIX_LEN+i]=dataHash[i];
  sha256_buf(addrHash, addrIn, CONST_PREFIX_LEN+32);
  // user-friendly UQ: [0x51,0x00,hash32,crc2]
  u8 addr[36]; addr[0]=0x51; addr[1]=0x00;
  for(int i=0;i<32;i++) addr[2+i]=addrHash[i];
  unsigned crc=crc16(addr,34); addr[34]=crc>>8; addr[35]=crc&0xff;
  // полная base64url-строка 36 байт -> 48 символов (как есть)
  int si=0;
  for(int g=0; g<36; g+=3){
    unsigned n=(addr[g]<<16)|(addr[g+1]<<8)|addr[g+2];
    raw[si++]=B64[(n>>18)&63]; raw[si++]=B64[(n>>12)&63]; raw[si++]=B64[(n>>6)&63]; raw[si++]=B64[n&63];
  }
}

// ---------------- детектор гемов (работает по raw[48]) ----------------
__device__ int g_run_any(const char*s){int b=1,c=1;for(int i=1;i<48;i++){if(s[i]==s[i-1]){c++;if(c>b)b=c;}else c=1;}return b;}
__device__ int g_run_end(const char*s){int c=1;for(int i=47;i>0&&s[i]==s[i-1];i--)c++;return c;}
__device__ int g_distinct(const char*s,int win){int c=0;for(int i=48-win;i<48;i++){bool f=false;for(int j=48-win;j<i;j++)if(s[j]==s[i]){f=true;break;}if(!f)c++;}return c;}
__device__ int g_asc(const char*s){int b=1,c=1;for(int i=1;i<48;i++){if((int)s[i]==(int)s[i-1]+1){c++;if(c>b)b=c;}else c=1;}return b;}
__device__ int g_pal(const char*s){int best=0;for(int ct=0;ct<48;ct++){int r=0;while(ct-r>=0&&ct+r<48&&s[ct-r]==s[ct+r])r++;int L=2*(r-1)+1;if(L>best)best=L;r=0;while(ct-r>=0&&ct+1+r<48&&s[ct-r]==s[ct+1+r])r++;int L2=2*r;if(L2>best)best=L2;}return best;}
__device__ __forceinline__ char g_norm(char c){ if(c>='A'&&c<='Z')c+=32; if(c=='-')c='_'; return c;}
__device__ bool g_clean(const char*raw,int p,int L){ bool up=true,lo=true,hasL=false; for(int k=0;k<L;k++){char c=raw[p+k]; if(c>='a'&&c<='z'){hasL=true;up=false;} else if(c>='A'&&c<='Z'){hasL=true;lo=false;}} return hasL&&(up||lo); }
// fuzzy-матч слова с допуском повтора каждой буквы (swaaag). Возвращает конец (exclusive) или -1.
__device__ int g_fuzzy(const char*norm,int p,int w){
  int i=p,k=0,L=DLEN[w];
  while(k<L){
    char c=DICT[w][k]; int need=0; while(k<L && DICT[w][k]==c){need++;k++;}
    int cnt=0; while(i<48 && norm[i]==c){cnt++;i++;}
    if(cnt<need) return -1;
  }
  return i;
}

// v10: пачка из ITERS сидов -> пачка публичных ключей; одно fe_invert на всю пачку (трюк Монтгомери):
// P_i = Z_0·…·Z_i, inv = 1/P_{B-1}; идём назад: 1/Z_i = inv·P_{i-1}, inv ← inv·Z_i.
__device__ void pubs_batch(u8 pubs[ITERS][32], const u8 seeds[ITERS][32]){
  u64 X[ITERS][5], Y[ITERS][5], Z[ITERS][5], P[ITERS][5];
  for(int i=0;i<ITERS;i++){
    u8 a[32]; seed_to_scalar(a, seeds[i]);
    scalarmult_base_xyz(X[i],Y[i],Z[i],a);
    if(i==0){ for(int k=0;k<5;k++) P[0][k]=Z[0][k]; } else fe_mul(P[i],P[i-1],Z[i]);
  }
  u64 inv[5]; fe_invert(inv, P[ITERS-1]);
  for(int i=ITERS-1;i>0;i--){
    u64 zi[5], t[5]; fe_mul(zi, inv, P[i-1]);
    encode_pub(pubs[i], X[i], Y[i], zi);
    fe_mul(t, inv, Z[i]); for(int k=0;k<5;k++) inv[k]=t[k];
  }
  encode_pub(pubs[0], X[0], Y[0], inv);
}

#include "detector_words.inc"   // правила поиска слов (v2)

// ---------------- kernels ----------------
__device__ u8 d_base[32];
// Сид ключа = SHA-256(база(32) ‖ номер(8, LE)). База — 32 случайных байта из системного криптогенератора.
// Раньше сид был «номер + база» как есть: утечка ОДНОГО ключа раскрывала базу и всех соседей (перебор номера).
// Теперь по сиду базу не восстановить (нужен прообраз SHA-256), каждый ключ независим.
__device__ __forceinline__ void derive_seed(u8 seed[32], u64 n){
  u8 in[40];
  for(int i=0;i<32;i++) in[i]=d_base[i];
  for(int i=0;i<8;i++) in[32+i]=(u8)(n>>(8*i));
  sha256_buf(seed, in, 40);
}
// --suffix STR: вместо правил гемов — точное окончание адреса (буквы без учёта регистра); для тестов
__constant__ char d_suf[48]; __constant__ int d_sufLen;
__device__ __forceinline__ bool suf_match(const char*raw){
  for(int k=0;k<d_sufLen;k++){ char a=raw[48-d_sufLen+k], b=d_suf[k];
    if(a>='A'&&a<='Z') a+=32;
    if(a!=b) return false; }
  return true;
}
__global__ void __launch_bounds__(256,2) k_search(u64 baseCtr, u8* hits, unsigned* cnt, int maxHits,   // v10: <=128 регистров -> 2 блока на SM (+20%)
                         int RUN_ANY,int RUN_END,int DIST,int DWIN,int ASCN,int PAL,int ADIST){
  u64 id = (u64)blockIdx.x*blockDim.x + threadIdx.x;
  u64 grid = (u64)gridDim.x*blockDim.x;
  // несколько ключей на поток: запуск длиннее -> меньше доля накладных расходов хоста;
  // v10: публичные ключи всех ITERS считаются вместе, обращение Z — одно на пачку (Монтгомери)
  u8 seeds[ITERS][32], pubs[ITERS][32];
  for(int it=0; it<ITERS; it++){
    u64 n = baseCtr + (u64)it*grid + id;
    derive_seed(seeds[it], n);
  }
  pubs_batch(pubs, seeds);
  for(int it=0; it<ITERS; it++){
    const u8* seed=seeds[it];
    u8 addrHash[32]; char raw[48];
    addr_from_pub(pubs[it], addrHash, raw);
    if(d_sufLen ? suf_match(raw) : is_gem_fast(raw,RUN_ANY,RUN_END,DIST,DWIN,ASCN,PAL,ADIST)){
      unsigned idx=atomicAdd(cnt,1u);
      // находка: сид (32) + готовый адрес (48) — обёртке не нужно пересчитывать адрес
      if(idx<(unsigned)maxHits){ for(int i=0;i<32;i++) hits[idx*HITB+i]=seed[i]; for(int i=0;i<48;i++) hits[idx*HITB+32+i]=(u8)raw[i]; }
    }
  }
}
// статистика правил слов: res[k] — сколько адресов подпадает под правило k
__global__ void k_stats(u64 baseCtr, unsigned* res){
  u64 id = (u64)blockIdx.x*blockDim.x + threadIdx.x;
  u8 seed[32];
  derive_seed(seed, baseCtr+id);
  u8 pub[32], addrHash[32]; char raw[48];
  compute(seed, pub, addrHash, raw);
  char norm[48], lnorm[48]; int seps=0;
  for(int i=0;i<48;i++){ norm[i]=g_norm(raw[i]); lnorm[i]=g_leet(norm[i]); if(i>=2 && norm[i]=='_') seps++; }
  WScan s=scan_words<true>(raw,norm,lnorm);
  int runAny=g_run_any(raw), d46=f_distinct(raw,46);
  bool t=s.tail;
  if(s.W>=2&&t) atomicAdd(&res[0],1u);
  if(s.W>=2&&t&&s.L>=8) atomicAdd(&res[1],1u);
  if(s.W>=2&&t&&s.L>=9) atomicAdd(&res[2],1u);
  if(s.W>=2&&t&&s.L>=10) atomicAdd(&res[3],1u);
  if(s.W>=3) atomicAdd(&res[4],1u);
  if(s.W>=3&&t) atomicAdd(&res[5],1u);
  if(s.start&&t&&s.W>=2) atomicAdd(&res[6],1u);
  if(s.start&&t&&s.W>=2&&s.L>=8) atomicAdd(&res[7],1u);
  if(t&&s.stretchTail) atomicAdd(&res[8],1u);
  if(t&&seps>=7) atomicAdd(&res[9],1u);
  if(t&&runAny>=4) atomicAdd(&res[10],1u);
  if(t&&d46<=25) atomicAdd(&res[11],1u);
  if(s.W>=2) atomicAdd(&res[12],1u);
  if(s.stretchAny) atomicAdd(&res[13],1u);
}
// сверка быстрого детектора с эталонным на тех же адресах: res[0]=расхождения, res[1]=гемов(эталон)
__global__ void k_validate(u64 baseCtr, unsigned* res, int RUN_ANY,int RUN_END,int DIST,int DWIN,int ASCN,int PAL,int ADIST){
  u64 id = (u64)blockIdx.x*blockDim.x + threadIdx.x;
  u8 seed[32];
  derive_seed(seed, baseCtr+id);
  u8 pub[32], addrHash[32]; char raw[48];
  compute(seed, pub, addrHash, raw);
  bool a=is_gem(raw,RUN_ANY,RUN_END,DIST,DWIN,ASCN,PAL,ADIST);
  bool b=is_gem_fast(raw,RUN_ANY,RUN_END,DIST,DWIN,ASCN,PAL,ADIST);
  if(a!=b) atomicAdd(&res[0],1u);
  if(a) atomicAdd(&res[1],1u);
}
// v10: selftest идёт ТЕМ ЖЕ пакетным путём, что и поиск (pubs_batch + addr_from_pub): поток берёт ITERS сидов подряд
__global__ void k_selftest(const u8* seeds, int n, u8* pubOut, u8* hashOut){
  int t=blockIdx.x*blockDim.x+threadIdx.x; if(t*ITERS>=n) return;
  u8 ss[ITERS][32], pubs[ITERS][32];
  for(int j=0;j<ITERS;j++){ int id=t*ITERS+j; for(int i=0;i<32;i++) ss[j][i]= id<n ? seeds[id*32+i] : (u8)(j+1); }
  pubs_batch(pubs, ss);
  for(int j=0;j<ITERS;j++){ int id=t*ITERS+j; if(id>=n) break;
    u8 addrHash[32]; char raw[48]; addr_from_pub(pubs[j], addrHash, raw);
    for(int i=0;i<32;i++){ pubOut[id*32+i]=pubs[j][i]; hashOut[id*32+i]=addrHash[i]; } }
}

// ---------------- host ----------------
static void ck(cudaError_t e,const char*w){ if(e!=cudaSuccess){ fprintf(stderr,"CUDA err %s: %s\n",w,cudaGetErrorString(e)); exit(1);} }
static void hex(const u8*b,int n,char*o){ const char*H="0123456789abcdef"; for(int i=0;i<n;i++){o[2*i]=H[b[i]>>4];o[2*i+1]=H[b[i]&15];} o[2*n]=0; }

int main(int argc, char** argv){
  bool selftest = (argc>1 && strcmp(argv[1],"selftest")==0);
  int threads=256, blocks=0;
  int MAXT=70; bool noThermal=false;
  // пороги гемов (по умолчанию «строго»)
  int RUN_ANY=6, RUN_END=5, DIST=2, DWIN=8, ASCN=6, PAL=11, ADIST=20;
  for(int i=1;i<argc;i++){
    if(!strcmp(argv[i],"--blocks")&&i+1<argc) blocks=atoi(argv[i+1]);
    if(!strcmp(argv[i],"--threads")&&i+1<argc) threads=atoi(argv[i+1]);
    if(!strcmp(argv[i],"--max-temp")&&i+1<argc){ MAXT=atoi(argv[i+1]); }
    if(!strcmp(argv[i],"--no-thermal")) noThermal=true;
    if(!strcmp(argv[i],"--run-any")&&i+1<argc) RUN_ANY=atoi(argv[i+1]);
    if(!strcmp(argv[i],"--run-end")&&i+1<argc) RUN_END=atoi(argv[i+1]);
    if(!strcmp(argv[i],"--dist")&&i+1<argc) DIST=atoi(argv[i+1]);
    if(!strcmp(argv[i],"--dwin")&&i+1<argc) DWIN=atoi(argv[i+1]);
    if(!strcmp(argv[i],"--asc")&&i+1<argc) ASCN=atoi(argv[i+1]);
    if(!strcmp(argv[i],"--pal")&&i+1<argc) PAL=atoi(argv[i+1]);
    if(!strcmp(argv[i],"--all-dist")&&i+1<argc) ADIST=atoi(argv[i+1]);
    if(!strcmp(argv[i],"--suffix")&&i+1<argc){ char s[48]={0}; int n=(int)strlen(argv[i+1]); if(n>47) n=47;
      for(int k=0;k<n;k++){ char c=argv[i+1][k]; s[k]=(c>='A'&&c<='Z')?c+32:c; }
      cudaMemcpyToSymbol(d_suf,s,48); cudaMemcpyToSymbol(d_sufLen,&n,sizeof n); fprintf(stderr,"режим --suffix: ...%s\n",s); }
  }
  // --max-temp = температура, которую держит регулятор
  int HARDT=MAXT+5;    // порог полного простоя (охлаждение)
  int RESUMET=MAXT-6;  // до скольки остываем после простоя
  int ABSMAX=MAXT+10; if(ABSMAX>90) ABSMAX=90;  // аварийный стоп, не выше 90 (у карты замедление с 93-95)
  if(HARDT>=ABSMAX) HARDT=ABSMAX-2;

  if(selftest){
    // читаем сиды hex из argv[2] (файл)
    FILE* f=fopen(argv[2],"r"); if(!f){ fprintf(stderr,"no seedfile\n"); return 1; }
    static u8 seeds[64*32]; int n=0; char line[200];
    while(n<64 && fgets(line,sizeof line,f)){
      if(strlen(line)<64) continue;
      for(int i=0;i<32;i++){ unsigned v; sscanf(line+2*i,"%2x",&v); seeds[n*32+i]=v; }
      n++;
    }
    fclose(f);
    u8 *d_seeds,*d_pub,*d_hash; ck(cudaMalloc(&d_seeds,n*32),"a"); ck(cudaMalloc(&d_pub,n*32),"b"); ck(cudaMalloc(&d_hash,n*32),"c");
    ck(cudaMemcpy(d_seeds,seeds,n*32,cudaMemcpyHostToDevice),"d");
    k_selftest<<<(n+63)/64,64>>>(d_seeds,n,d_pub,d_hash); ck(cudaDeviceSynchronize(),"k");
    static u8 pub[64*32],hash[64*32]; ck(cudaMemcpy(pub,d_pub,n*32,cudaMemcpyDeviceToHost),"e"); ck(cudaMemcpy(hash,d_hash,n*32,cudaMemcpyDeviceToHost),"f");
    char sh[65],ph[65],hh[65];
    for(int i=0;i<n;i++){ hex(seeds+i*32,32,sh); hex(pub+i*32,32,ph); hex(hash+i*32,32,hh); printf("%s %s %s\n",sh,ph,hh); }
    return 0;
  }

  build_k2();
  if(argc>1 && strcmp(argv[1],"stats")==0){
    int L = argc>2 ? atoi(argv[2]) : 50;
    std::random_device rd; u8 b[32]; for(int i=0;i<32;i++) b[i]=(u8)rd(); ck(cudaMemcpyToSymbol(d_base,b,32),"sb");
    unsigned* d_res; ck(cudaMalloc(&d_res,64),"sr"); unsigned res[16]={0}; ck(cudaMemcpy(d_res,res,64,cudaMemcpyHostToDevice),"sz");
    nvmlInit(); nvmlDevice_t vd; nvmlDeviceGetHandleByIndex(0,&vd);
    for(int i=0;i<L;i++){ k_stats<<<480,256>>>((u64)i*480*256,d_res); ck(cudaDeviceSynchronize(),"sk");
      unsigned t=0; nvmlDeviceGetTemperature(vd,NVML_TEMPERATURE_GPU,&t); while(t>=78){ std::this_thread::sleep_for(std::chrono::milliseconds(300)); nvmlDeviceGetTemperature(vd,NVML_TEMPERATURE_GPU,&t);} }
    ck(cudaMemcpy(res,d_res,64,cudaMemcpyDeviceToHost),"sc");
    double N=(double)L*480*256;
    const char* names[]={"2 слова+хвост","2сл+хвост L>=8","2сл+хвост L>=9","2сл+хвост L>=10","3+ слова","3+ слова+хвост","начало+хвост","начало+хвост L>=8","хвост+растяжка","хвост+7 разд.","хвост+серия4","хвост+<=25 симв","2+ слова где угодно","растяжка 4+ где угодно"};
    for(int k=0;k<14;k++) printf("%-24s p=%.2e  при 10M/s: %.2f/с\n",names[k],res[k]/N,res[k]/N*1e7);
    return 0;
  }
  if(argc>1 && strcmp(argv[1],"validate")==0){
    // vanity.exe validate <launches> — сверка быстрого детектора с эталоном при разных порогах
    int L = argc>2 ? atoi(argv[2]) : 200;
    std::random_device rd; u8 b[32]; for(int i=0;i<32;i++) b[i]=(u8)rd(); ck(cudaMemcpyToSymbol(d_base,b,32),"vb");
    unsigned* d_res; ck(cudaMalloc(&d_res,8),"vr");
    struct P{ const char* name; int a,e,d,w,s,p,ad; } sets[]={
      {"боевые пороги",        6,5,2,8,6,11,22},
      {"только слова",         99,99,-1,8,99,99,-1},
      {"мягкие (много гемов)", 4,3,4,8,4,6,30},
    };
    int bad=0;
    nvmlDevice_t vd; bool vok = nvmlInit()==NVML_SUCCESS && nvmlDeviceGetHandleByIndex(0,&vd)==NVML_SUCCESS;
    if(!vok){ fprintf(stderr,"NVML недоступен — сверку не запускаю\n"); return 1; }
    auto cool=[&](){ unsigned t=0; nvmlDeviceGetTemperature(vd,NVML_TEMPERATURE_GPU,&t);
      if(t>=76){ while(t>70){ std::this_thread::sleep_for(std::chrono::milliseconds(500)); nvmlDeviceGetTemperature(vd,NVML_TEMPERATURE_GPU,&t);} } };
    for(auto& P0: sets){
      unsigned res[2]={0,0}; ck(cudaMemcpy(d_res,res,8,cudaMemcpyHostToDevice),"vz");
      for(int i=0;i<L;i++){ k_validate<<<480,256>>>((u64)i*480*256,d_res,P0.a,P0.e,P0.d,P0.w,P0.s,P0.p,P0.ad); ck(cudaDeviceSynchronize(),"vk"); cool(); }
      ck(cudaMemcpy(res,d_res,8,cudaMemcpyDeviceToHost),"vc");
      printf("%-22s адресов %llu  гемов %u  расхождений %u\n",P0.name,(unsigned long long)L*480*256,res[1],res[0]);
      if(res[0]) bad=1;
    }
    printf(bad?"VALIDATE FAIL\n":"VALIDATE OK\n");
    return bad;
  }

  if(argc>1 && strcmp(argv[1],"bench")==0){
    // vanity.exe bench <launches> [--all-dist 22] — скорость ЯДРА (без пауз термо): ключей/с и хитов/с.
    // Остывание до 70C между запусками при >=76C в замер не входит.
    int L = argc>2 ? atoi(argv[2]) : 60;
    cudaDeviceProp bp; ck(cudaGetDeviceProperties(&bp,0),"bp");
    int bb = blocks ? blocks : bp.multiProcessorCount*6;
    std::random_device rd; u8 b[32]; for(int i=0;i<32;i++) b[i]=(u8)rd(); ck(cudaMemcpyToSymbol(d_base,b,32),"bb");
    u8* d_h; unsigned* d_c; ck(cudaMalloc(&d_h,(size_t)65536*HITB),"bh"); ck(cudaMalloc(&d_c,4),"bc");
    nvmlInit(); nvmlDevice_t vd; nvmlDeviceGetHandleByIndex(0,&vd);
    cudaEvent_t e0,e1; cudaEventCreate(&e0); cudaEventCreate(&e1);
    double ms=0; unsigned long long hitsN=0; unsigned zero=0;
    for(int i=0;i<L;i++){
      unsigned t=0; nvmlDeviceGetTemperature(vd,NVML_TEMPERATURE_GPU,&t);
      if(t>=76){ while(t>70){ std::this_thread::sleep_for(std::chrono::milliseconds(300)); nvmlDeviceGetTemperature(vd,NVML_TEMPERATURE_GPU,&t);} }
      ck(cudaMemcpy(d_c,&zero,4,cudaMemcpyHostToDevice),"bz");
      cudaEventRecord(e0);
      k_search<<<bb,threads>>>((u64)i*bb*threads*ITERS,d_h,d_c,65536,RUN_ANY,RUN_END,DIST,DWIN,ASCN,PAL,ADIST);
      cudaEventRecord(e1); ck(cudaEventSynchronize(e1),"bs");
      float m; cudaEventElapsedTime(&m,e0,e1); if(i>0) ms+=m;   // первый запуск — прогрев
      unsigned c; ck(cudaMemcpy(&c,d_c,4,cudaMemcpyDeviceToHost),"bcc"); if(i>0) hitsN+=c;
    }
    double N=(double)(L-1)*bb*threads*ITERS;
    printf("BENCH ключей %.0f  ядро %.2f M/s  хитов %.1f на 1M (≈%.0f/с при этой скорости)\n",N,N/ms/1e3,hitsN/N*1e6,hitsN/(ms/1e3));
    return 0;
  }

  // поиск
  cudaDeviceProp prop; ck(cudaGetDeviceProperties(&prop,0),"prop");
  if(blocks==0) blocks = prop.multiProcessorCount * 6;  // умеренная сетка: мягче по теплу

  // --- термоконтроль через NVML (обязателен, если не отключён явно) ---
  nvmlDevice_t nvdev; bool nvok=false;
  if(nvmlInit()==NVML_SUCCESS && nvmlDeviceGetHandleByIndex(0,&nvdev)==NVML_SUCCESS) nvok=true;
  if(!nvok && !noThermal){ fprintf(stderr,"NVML недоступен — останавливаюсь ради безопасности (запусти с --no-thermal, чтобы отключить защиту на свой риск)\n"); return 1; }
  fprintf(stderr,"термозащита: цель~%dC (пропорц.), простой при %dC до %dC, аварийный стоп %dC%s\n",MAXT,HARDT,RESUMET,ABSMAX,noThermal?" (ОТКЛЮЧЕНА)":"");
  const int MAXH=65536;
  u8* d_hits; unsigned* d_cnt; ck(cudaMalloc(&d_hits,(size_t)MAXH*HITB),"h"); ck(cudaMalloc(&d_cnt,4),"c");
  // База сида — из системного криптогенератора (MSVC random_device = RtlGenRandom), все 32 байта.
  // Раньше: mt19937_64 от одного 32-битного числа -> всего ~2^32 вариантов базы.
  std::random_device rd;
  u8 base[32];
  auto reseed=[&](){ for(int i=0;i<32;i+=4){ unsigned v=rd(); for(int k=0;k<4;k++) base[i+k]=(u8)(v>>(8*k)); } ck(cudaMemcpyToSymbol(d_base,base,32),"base"); };
  reseed();
  u64 baseCtr=0, total=0; unsigned zero=0;
  auto t0=std::chrono::steady_clock::now();
  u64 lastTotal=0; auto lastT=t0;
  fprintf(stderr,"GPU: %s | SM=%d | grid=%d x %d\n",prop.name,prop.multiProcessorCount,blocks,threads);
  fprintf(stderr,"гемы: run_any>=%d run_end>=%d dist<=%d(win%d) asc>=%d pal>=%d | словарь %d слов\n",RUN_ANY,RUN_END,DIST,DWIN,ASCN,PAL,NW);
  u64 perLaunch=(u64)blocks*threads*ITERS;
  auto lastTempT=t0;
  int launchesSinceReseed=0;
  double sleepMs=0, shownSleep=0, kAcc=0; unsigned curTemp=0; u64 hitAcc=0;
  double duty=0.25; const int TARGET=MAXT;
  while(true){
    ck(cudaMemcpy(d_cnt,&zero,4,cudaMemcpyHostToDevice),"z");
    auto kt0=std::chrono::steady_clock::now();
    k_search<<<blocks,threads>>>(baseCtr,d_hits,d_cnt,MAXH,RUN_ANY,RUN_END,DIST,DWIN,ASCN,PAL,ADIST);
    ck(cudaDeviceSynchronize(),"ks");
    kAcc+=std::chrono::duration<double>(std::chrono::steady_clock::now()-kt0).count();
    unsigned cnt; ck(cudaMemcpy(&cnt,d_cnt,4,cudaMemcpyDeviceToHost),"cc");
    hitAcc+=cnt;
    if(cnt>0){
      unsigned got=cnt<MAXH?cnt:MAXH;
      static u8 hits[MAXH*HITB]; ck(cudaMemcpy(hits,d_hits,(size_t)got*HITB,cudaMemcpyDeviceToHost),"hh");
      char sh[65], ad[49]; ad[48]=0;
      for(unsigned i=0;i<got;i++){ hex(hits+i*HITB,32,sh); memcpy(ad,hits+i*HITB+32,48); printf("HIT %s %s\n",sh,ad); }
      fflush(stdout);
    }
    baseCtr+=perLaunch; total+=perLaunch; launchesSinceReseed++;

    // --- термоконтроль: регулятор доли нагрузки (duty) + полный простой при перегреве ---
    // Карта греется за 1-2 с, поэтому не рывки «полный газ/стоп», а ровная доля работы:
    // после каждого запуска пауза = время_запуска * (1/duty - 1). duty подстраивается под цель.
    bool stop=false;
    double lt=std::chrono::duration<double>(std::chrono::steady_clock::now()-kt0).count();
    bool tempDue = std::chrono::duration<double>(std::chrono::steady_clock::now()-lastTempT).count() >= 0.25;
    if(nvok && tempDue){
      lastTempT=std::chrono::steady_clock::now();
      unsigned t;
      if(nvmlDeviceGetTemperature(nvdev,NVML_TEMPERATURE_GPU,&t)!=NVML_SUCCESS){
        printf("TEMP_FAIL\n"); fflush(stdout); fprintf(stderr,"датчик температуры не отвечает — стоп\n"); break;
      }
      curTemp=t;
      if((int)t>=ABSMAX){ printf("TEMP_STOP %u\n",t); fflush(stdout); fprintf(stderr,"аварийный перегрев %uC — стоп\n",t); break; }
      if((int)t>=HARDT){
        // полный простой GPU (ядро не запускаем), пока не остынет; процесс жив
        printf("COOLDOWN %u\n",t); fflush(stdout);
        while(true){
          std::this_thread::sleep_for(std::chrono::milliseconds(500));
          unsigned t2; if(nvmlDeviceGetTemperature(nvdev,NVML_TEMPERATURE_GPU,&t2)!=NVML_SUCCESS){ printf("TEMP_FAIL\n"); fflush(stdout); stop=true; break; }
          curTemp=t2;
          if((int)t2<=RESUMET) break;
        }
        if(stop) break;
        printf("RESUME %u\n",curTemp); fflush(stdout);
        duty=0.25;
      } else {
        int err=(int)t-TARGET;
        duty -= 0.03*err;                 // плавная подстройка (каждые 0.25 с)
        if(err>=3) duty*=0.7;             // быстрый сброс, если пошло выше цели
        if(duty<0.03) duty=0.03; if(duty>1.0) duty=1.0;
      }
    }
    if(stop) break;
    sleepMs = nvok ? lt*1000.0*(1.0/duty-1.0) : 0; if(sleepMs>3000) sleepMs=3000;
    shownSleep=sleepMs;

    auto now=std::chrono::steady_clock::now();
    double dt=std::chrono::duration<double>(now-lastT).count();
    if(dt>=1.0){
      double rate=(double)(total-lastTotal)/dt;
      // RATE total rate | доля времени в ядре, хитов/с — диагностика (обёртка читает первые два поля)
      printf("RATE %llu %.0f %.2f %.0f\n",(unsigned long long)total,rate,kAcc/dt,(double)hitAcc/dt);
      printf("TEMP %u %.0f %.2f\n",curTemp,shownSleep,duty); fflush(stdout);
      lastTotal=total; lastT=now; kAcc=0; hitAcc=0;
    }
    if(sleepMs>0) std::this_thread::sleep_for(std::chrono::milliseconds((int)sleepMs));
    // периодически обновляем случайную базу (32 байта)
    if(launchesSinceReseed>=2000){ reseed(); baseCtr=0; launchesSinceReseed=0; }
  }
  if(nvok) nvmlShutdown();
  return 0;
}

// ---------------- сито v5-lite (2026-10-05): оценка v5 прямо на видеокарте ----------------
// Старое сито (правила слов в detector_words.inc) пропускало лишь ~25% адресов, которые v5 оценивает на 150+:
// не видело трёхбуквенных слов на границе регистра (scamKEK, L0hRug), «рваного» регистра (RugWEeD) и знало 7 тыс. слов
// вместо ~47 тыс. Здесь — та же разметка на слова, что в src/score_v5.mjs: разбор хвоста с конца адреса, начала,
// растянутые слова где угодно; тот же словарь (cuda/v5dict.h из src/gpu_dict_v5.mjs), те же веса и заметность.
// Хвост разбирается «толкающим» способом: только от разобранных мест, по обратному индексу (слова, КОНЧАЮЩИЕСЯ в месте),
// поэтому у случайного адреса это один-два перебора. Замер (200 млн случайных адресов): оценка GPU = v5 ±2 очка у 96–99%,
// полнота при 150+ — 99% (старое сито 25%) при той же скорости. Семейство «серий» ловят дешёвые правила в is_gem_v5.
#include "v5dict.h"
#define BN 46            // длина адреса без «UQ»
__device__ unsigned short V5S_L[KT*K3SUB+1], V5S_D[KT*K3SUB+1];
__device__ unsigned short V5IDX_L[V5N], V5IDX_D[V5N];
// обратный индекс: ключ — три последние пробежки слова (для перебора слов, КОНЧАЮЩИХСЯ в данном месте)
__device__ unsigned short V5R_S_L[KT*K3SUB+1], V5R_S_D[KT*K3SUB+1];
__device__ unsigned short V5R_IDX_L[V5N], V5R_IDX_D[V5N];

__device__ __forceinline__ bool b_sep(char c){ return c=='-'||c=='_'; }
__device__ __forceinline__ bool b_dig(char c){ return c>='0'&&c<='9'; }
__device__ __forceinline__ bool b_up(char c){ return c>='A'&&c<='Z'; }
__device__ __forceinline__ bool b_lo(char c){ return c>='a'&&c<='z'; }
__device__ __forceinline__ bool b_let(char c){ return b_up(c)||b_lo(c); }
__device__ __forceinline__ bool b_caseCut(const char* b,int j){ return b_let(b[j-1])&&b_let(b[j])&&(b_up(b[j-1])!=b_up(b[j])); }

// совпадение слова w в X[p..n) с растяжкой; последнюю пробежку можно оборвать раньше: концы [minE, maxE]
__device__ __forceinline__ int v5_fuzzy(const char* X, int n, int p, int w, int &minE){
  int i=p,k=0,L=V5LEN[w];
  while(k<L){
    char c=V5W[w][k]; int need=0; while(k<L && V5W[w][k]==c){need++;k++;}
    int cnt=0; while(i<n && X[i]==c){cnt++;i++;}
    if(cnt<need) return -1;
    if(k==L) minE=i-cnt+need;
  }
  return i;
}
// регистр отрезка: 0 U (ВСЁ), 1 L (всё), 2 C (Всё), 3 M (рваный или без букв)
__device__ int v5_case(const char* b,int i,int e){
  int nu=0,nl=0,first=-1; bool restLow=true;
  for(int k=i;k<e;k++){ char c=b[k]; if(b_up(c)){ if(first<0) first=1; else restLow=false; nu++; } else if(b_lo(c)){ if(first<0) first=0; nl++; } }
  if(nu+nl==0) return 3; if(nl==0) return 0; if(nu==0) return 1; return (first==1&&restLow)?2:3;
}
__device__ __forceinline__ float v5_edge(const char* b,int n,int pos,int cls,bool left){
  if(pos<0||pos>=n||b_sep(b[pos])) return 1.f;
  char c=b[pos]; if(b_dig(c)) return P5_visDigit;
  bool up=b_up(c);
  if(cls==0) return up?0.f:P5_visCase;
  if(cls==1) return up?P5_visCase:0.f;
  if(cls==2) return left?(up?0.f:P5_visCamel):(up?P5_visCamel:0.f);
  return 0.f;
}
__device__ __forceinline__ float v5_extra(const char* b,int n,int sp,int out,int inner){
  if(sp<0||sp>=n||!b_sep(b[sp])) return 0.f;
  if(out>=0&&out<n&&b_sep(b[out])) return P5_sepDouble;
  if(out>=0&&out<n&&b_let(b[out])&&b_let(b[inner])&&(b_up(b[out])!=b_up(b[inner]))) return P5_sepCase;
  return 0.f;
}
// заметность отрезка [i,e) в строке длины n (как withVis)
__device__ float v5_vis(const char* b,int n,int i,int e){
  int cls=v5_case(b,i,e);
  float v=(v5_edge(b,n,i-1,cls,true)+v5_edge(b,n,e,cls,false))*0.5f;
  if(cls==3) v*=P5_visMixed;
  v+=(v5_extra(b,n,i-1,i-2,i)+v5_extra(b,n,e,e+1,e-1))*0.5f;
  return v;
}
// выигрыш слова без заметности (как wordInfo)
__device__ __forceinline__ float v5_raw(const char* b,int w,int i,int e){
  int L=V5LEN[w]; unsigned char fl=V5FLAGS[w];
  int st=e-i-L; if(st>(int)P5_stretchCap) st=(int)P5_stretchCap;
  int leet=0; if(fl&1) for(int k=i;k<e;k++) if(b_dig(b[k])) leet++;
  float g=V5BASE[w]+st*P5_stretchGain-leet*P5_leetCost;
  if(fl&2) g*=P5_funcK;
  return g+V5BONUS[w];
}
__device__ __forceinline__ bool v5_shortOk(const char* b,int n,int i,int e){
  return (e-i>2) || ((i==0||b_sep(b[i-1])||b_dig(b[i-1])) && (e==n||b_sep(b[e])||b_dig(b[e])));
}
// перебор слов, начинающихся в i в строке длины n: want(e) — нужен ли такой конец (проверяется до подсчёта выигрыша);
// f(w, e, gain, vis). XA — строка для буквенных слов (leet-версия или просто нижний регистр), leetOk — правила leet
template<typename P, typename F>
__device__ void v5_words_at(const char* b,const char* low,const char* XA,int n,int i,bool leetRules,P want,F f){
  for(int t=0;t<2;t++){
    const char* X = t==0 ? XA : low;
    const unsigned short *S = t==0?V5S_L:V5S_D, *I = t==0?V5IDX_L:V5IDX_D;
    int c0=kc(X[i]); int q=i; while(q<n && X[q]==X[i]) q++;
    int c1 = q<n ? kc(X[q]) : 37, c2=38;
    if(q<n){ int r=q; while(r<n && X[r]==X[q]) r++; if(r<n) c2=kc(X[r]); }
    int ka=(c0*(KC+1)+c1)*K3SUB, kb=(c0*(KC+1)+KSINGLE)*K3SUB+39;
    int lists[3][2]={{c2<38?S[ka+c2]:0, c2<38?S[ka+c2+1]:0},{S[ka+39],S[ka+40]},{S[kb],S[kb+1]}};
    for(int li=0;li<3;li++) for(int x=lists[li][0]; x<lists[li][1]; x++){
      int w=I[x]; int minE; int maxE=v5_fuzzy(X,n,i,w,minE); if(maxE<0) continue;
      if(t==0 && leetRules && b_dig(low[i])) continue;          // leet: слово не с цифры
      int L=V5LEN[w];
      for(int e=minE;e<=maxE;e++){
        if(!want(e)) continue;
        if(t==0 && leetRules){ int d=0; for(int k=i;k<e;k++) if(b_dig(low[k])) d++; if(d>(L>=6?2:1)) continue; }
        if(L<=2 && !v5_shortOk(b,n,i,e)) continue;
        float g=v5_raw(b,w,i,e), vis=v5_vis(b,n,i,e);
        f(w,e,g>0.f? g*(1.f-P5_vis*(1.f-vis)) : g, vis);
      }
    }
  }
}
// совпадение слова w, КОНЧАЮЩЕГОСЯ в e (X[..e)), с растяжкой. Внутренние и последняя пробежки съедаются целиком (как при
// прямом разборе), первая — частично: допустимые начала [iMin, iMax]. -1 — не совпало.
__device__ __forceinline__ int v5_fuzzy_rev(const char* X, int e, int w, int &iMax){
  int p=e-1, k=V5LEN[w]-1;
  while(k>=0){
    char c=V5W[w][k]; int need=0; while(k>=0 && V5W[w][k]==c){need++;k--;}
    int cnt=0; while(p>=0 && X[p]==c){cnt++;p--;}
    if(cnt<need) return -1;
    if(k<0){ iMax=p+1+cnt-need; return p+1; }
  }
  return -1;
}
// перебор слов, кончающихся в e: f(w, i, gain, vis) для каждого допустимого начала i
template<typename F>
__device__ void v5_words_end(const char* b,const char* low,const char* lt,int n,int e,F f){
  for(int t=0;t<2;t++){
    const char* X = t==0 ? lt : low;
    const unsigned short *S = t==0?V5R_S_L:V5R_S_D, *I = t==0?V5R_IDX_L:V5R_IDX_D;
    int c0=kc(X[e-1]); int q=e-1; while(q>=0 && X[q]==X[e-1]) q--;
    int c1 = q>=0 ? kc(X[q]) : 37, c2=38;
    if(q>=0){ int r=q; while(r>=0 && X[r]==X[q]) r--; if(r>=0) c2=kc(X[r]); }
    int ka=(c0*(KC+1)+c1)*K3SUB, kb=(c0*(KC+1)+KSINGLE)*K3SUB+39;
    int lists[3][2]={{c2<38?S[ka+c2]:0, c2<38?S[ka+c2+1]:0},{S[ka+39],S[ka+40]},{S[kb],S[kb+1]}};
    for(int li=0;li<3;li++) for(int x=lists[li][0]; x<lists[li][1]; x++){
      int w=I[x]; int iMax; int iMin=v5_fuzzy_rev(X,e,w,iMax); if(iMin<0) continue;
      int L=V5LEN[w];
      for(int i=iMin;i<=iMax;i++){
        if(t==0){ if(b_dig(low[i])) continue; int d=0; for(int k=i;k<e;k++) if(b_dig(low[k])) d++; if(d>(L>=6?2:1)) continue; }
        if(L<=2 && !v5_shortOk(b,n,i,e)) continue;
        float g=v5_raw(b,w,i,e), vis=v5_vis(b,n,i,e);
        f(w,i,g>0.f? g*(1.f-P5_vis*(1.f-vis)) : g, vis);
      }
    }
  }
}
// состояние разбора: g — выигрыш; fl: 1 есть слова, 2 есть длинное, 4 последнее — слово, 8 длинное с повтором букв, 16 сленг
struct V5St { float g; unsigned char nw, nc, fl, w1len; float w1vis; };
#define V5NULL (-1e30f)
__device__ __forceinline__ void v5_dadj(const char* b,int n,float* dAdj){
  int dcnt[10]={0}; for(int i=0;i<n;i++) if(b_dig(b[i])) dcnt[b[i]-'0']++;
  for(int i=0;i<n;i++){ dAdj[i]=0.f; char c=b[i]; if(!b_dig(c)) continue;
    bool lone=(i==0||!b_dig(b[i-1]))&&(i==n-1||!b_dig(b[i+1]));
    if(c=='0') dAdj[i]=0.f; else if((c=='2'||c=='4')&&lone) dAdj[i]=P5_digitToFor; else if(dcnt[c-'0']>=2) dAdj[i]=0.f; else dAdj[i]=-P5_digitSep; }
}
// лучший хвост строки b[0..n) (как analyze().suf + bestTail); k — множитель «почти хвоста».
// Разбор «толкающий»: идём справа налево, и из каждого разобранного места e перебираем только слова, кончающиеся в e
// (обратный индекс). У случайного адреса разобрано обычно одно место — конец, поэтому перебор один-два раза на адрес.
__device__ void v5_tail(const char* b,const char* low,const char* lt,int n,float k,float &bestG,int &bestStart,int &bestNc,bool &bestDup){
  float dAdj[BN]; v5_dadj(b,n,dAdj);
  V5St suf[BN+1]; for(int i=0;i<=n;i++) suf[i].g=V5NULL;
  suf[n].g=0.f; suf[n].nw=0; suf[n].nc=0; suf[n].fl=0;
  for(int e=n;e>0;e--){
    const V5St nx=suf[e]; if(nx.g<=V5NULL) continue;
    // разделитель/цифра перед e
    if(b_sep(b[e-1])||b_dig(b[e-1])){ float cg=nx.g+(nx.nw?dAdj[e-1]:0.f); if(cg>suf[e-1].g){ suf[e-1]=nx; suf[e-1].g=cg; suf[e-1].fl&=~4; } }
    // слово [i,e): после него — конец, разделитель/цифра или другое слово
    if(!(e==n || b_sep(b[e]) || b_dig(b[e]) || (nx.fl&4))) continue;
    v5_words_end(b,low,lt,n,e,[&](int w,int i,float g,float vis){
      float cg=nx.g+g;
      if(cg>suf[i].g){
        unsigned char fl=V5FLAGS[w];
        int dup=0; for(int q=i+1;q<e;q++) if(low[q]==low[q-1]) dup++;
        suf[i].g=cg; suf[i].nw=nx.nw+1; suf[i].nc=nx.nc+((fl&8)?1:0);
        suf[i].fl=(nx.fl&(2|8|16)) | 1 | 4 | ((fl&4)?2:0) | ((dup>=2&&(fl&4))?8:0) | ((fl&16)?16:0);
      }
    });
  }
  for(int i=0;i<n;i++){
    const V5St &p=suf[i]; if(p.g<=V5NULL || !(p.fl&2) || p.g<=0.f) continue;
    if(i>0 && !b_sep(b[i-1]) && !b_dig(b[i-1]) && !b_caseCut(b,i)) continue;
    if(p.g*k>bestG){ bestG=p.g*k; bestStart=i; bestNc=p.nc; bestDup=(p.fl&8)!=0; }
  }
}

// приближённые биты v5 (как scoreV5 без семейства «серий»)
__device__ float v5lite_bits(const char* raw){
  const char* b=raw+2;
  char low[BN], lt[BN];
  for(int i=0;i<BN;i++){ char c=b[i]; if(b_up(c)) c+=32; low[i]=c; lt[i]=g_leet(c); }
  int seps=0, run=1, runBest=1; for(int i=0;i<BN;i++){ if(b_sep(b[i])) seps++; if(i&&b[i]==b[i-1]){ if(++run>runBest) runBest=run; } else run=1; }
  // --- хвост (+ «почти хвост»: после фразы 1–2 мусорных символа через разделитель/цифру) ---
  float tailG=V5NULL; int tailStart=BN, nT=0; bool dupLong=false;
  v5_tail(b,low,lt,BN,1.f,tailG,tailStart,nT,dupLong);
#ifdef V5_CUT   // «почти хвост» (+1–2% полноты ценой −35% скорости) — по умолчанию выключен
  for(int cut=1; cut<=2; cut++){
    int c=BN-cut; if(!(b_sep(b[c-1])||b_dig(b[c-1])||b_sep(b[c]))) continue;
    float g=V5NULL; int st=BN, nc=0; bool dp=false;
    v5_tail(b,low,lt,c,cut==1?0.7f:0.55f,g,st,nc,dp);
    if(g>V5NULL && g>tailG){ tailG=g; tailStart=st; nT=nc; dupLong=dp; }
  }
#endif
  float bits=0.f; int startEnd=-1;
  if(tailG>V5NULL){
    // --- начало: префиксный разбор (с 0 и, если b[1] — разделитель, с 2) ---
    float startG=0.f; int nS=0;
    if(tailStart>0) for(int off=0; off<=2; off+=2){
      if(off==2 && !b_sep(b[1])) break;
      const char* bb=b+off; const char *lw=low+off, *lt2=lt+off; int n=BN-off;
      float dAdj[BN]; v5_dadj(bb,n,dAdj);
      V5St pre[BN+1]; for(int i=0;i<=n;i++) pre[i].g=V5NULL;
      pre[0].g=0.f; pre[0].nw=0; pre[0].nc=0; pre[0].fl=0;
      int lim=tailStart-off; if(lim>n) lim=n; int nr=0;
      for(int i=0;i<lim;i++){
        const V5St cur=pre[i]; if(cur.g<=V5NULL){ if(++nr>=V5MAXL+4) break; continue; } nr=0;
        if(b_sep(bb[i])||b_dig(bb[i])){ float cg=cur.g+(cur.nw?dAdj[i]:0.f); if(cg>pre[i+1].g){ pre[i+1]=cur; pre[i+1].g=cg; pre[i+1].fl&=~4; } }
        v5_words_at(bb,lw,lt2,n,i,true, [&](int e){ return e<=lim; },
          [&](int w,int e,float g,float vis){
            float cg=cur.g+g;
            if(cg>pre[e].g){
              unsigned char fl=V5FLAGS[w];
              pre[e].g=cg; pre[e].nw=cur.nw+1; pre[e].nc=cur.nc+((fl&8)?1:0);
              pre[e].fl=(cur.fl&(2|16)) | 1 | 4 | ((fl&4)?2:0) | ((fl&16)?16:0);
              if(cur.nw==0){ pre[e].w1len=V5LEN[w]; pre[e].w1vis=vis; } else { pre[e].w1len=cur.w1len; pre[e].w1vis=cur.w1vis; }
            }
          });
      }
      for(int j=1;j<=lim;j++){
        const V5St &p=pre[j]; if(p.g<=V5NULL || !(p.fl&2) || p.g<=0.f) continue;
        int J=j+off;
        if(J<BN && !b_sep(b[J]) && !b_dig(b[J]) && !b_caseCut(b,J)) continue;
        float g=p.g-(off==0?P5_startAD:0.f);
        if(off==0 && (p.fl&16)) g+=P5_startTheme;
        if(p.nw==1 && p.w1len<=3 && !(p.fl&16)) g-=P5_start3*(p.w1vis>=0.9f?P5_start3Vis:1.f);
        if(g>0.f && g>startG){ startG=g; nS=p.nc; startEnd=J; }
      }
    }
    if(tailStart==0){ startG=0.f; nS=0; startEnd=-1; }
    // --- редкости (combo) ---
    float combo=0.f;
    if(dupLong) combo+=4.f;
    if(seps>=7) combo+=3.f+(seps-7);
    if(runBest>=4) combo+=3.f*(runBest-3);
    { u64 m=0; for(int i=0;i<BN;i++) m|=1ull<<b64i(b[i]); int dist=__popcll(m); if(dist<=25) combo+=(26-dist)*1.2f; }
    if(g_face(raw)) combo+=P5_face;
    { const char* M[]={"69420","80085","5318008","100500","1337","420","228","322","69","67","777","666"}; const float MB[]={14,16,12,9,14,10,6,6,3,3,4,4};
      for(int m=0;m<12;m++){ int L=0; while(M[m][L]) L++; bool hit=false;
        for(int p=0;p+L<=BN && !hit;p++){ bool ok=true; for(int q=0;q<L;q++) if(b[p+q]!=M[m][q]){ok=false;break;}
          if(ok && (p==0||!b_dig(b[p-1])) && (p+L==BN||!b_dig(b[p+L]))) hit=true; }
        if(hit){ combo+=MB[m]; break; } } }
    { int k=1; while(k<BN && b[k]==b[0]) k++; int a=1; while(a<BN && b[a]==b[a-1]+1) a++; int best=k>a?k:a; if(best>=4) combo+=(best-3)*6.f; }
    int nAll=nT+nS;
    if(nAll>=2 || combo>0.f){
      bits=tailG + startG*P5_startK + (nAll>=2? combo*0.5f : combo);
      if(nAll<2) bits*=P5_singleK;
    } else { tailStart=BN; startEnd=-1; }
  }
  // --- растянутое слово где угодно (серия одного символа ≥4 в точном регистре): только если такая серия есть ---
  float midB=0.f, innerLong=0.f;
  if(runBest>=4){
    for(int i=0;i<BN;i++){
      v5_words_at(b,low,low,BN,i,false, [&](int e){ return e-i>=3; },
        [&](int w,int e,float g,float vis){
          if(!(V5FLAGS[w]&1) || V5LEN[w]<3 || !(V5FLAGS[w]&8)) return;
          int r=1, rb=1; for(int q=i+1;q<e;q++){ if(b[q]==b[q-1]){ if(++r>rb) rb=r; } else r=1; }
          if(rb<4) return;
          float raw=v5_raw(b,w,i,e); if(raw<=0.f) return;
          bool inPhrase = bits>0.f && (i>=tailStart || (startEnd>=0 && e<=startEnd));
          float lng=4.f*(float)max(0, rb-4);
          if(inPhrase){ if(lng>innerLong) innerLong=lng; return; }   // внутри фразы — только надбавка за длинную серию
          bool atStart = i==0 || (i==2 && b_sep(b[1])) || (i==1 && b[0]>='A'&&b[0]<='D' && (b[0]+32)!=V5W[w][0]);
          float mb=(raw + lng + (atStart?6.f:0.f) - (i==0?P5_startAD:0.f))*(1.f-0.35f*(1.f-vis));
          if(v5_case(b,i,e)==3) mb*=0.6f;
          if(mb>midB) midB=mb;
        });
    }
  }
  if(bits>0.f) bits+=innerLong;
  float hi=bits>midB?bits:midB, lo=bits>midB?midB:bits;
  return hi + lo*0.3f;
}

// хост: индекс словаря v5 (как K3: ключ первых трёх пробежек)
static void build_v5idx(){
  static char dict[V5N][V5MAXL]; static unsigned char dlen[V5N], fl[V5N];
  cudaMemcpyFromSymbol(dict,V5W,sizeof dict); cudaMemcpyFromSymbol(dlen,V5LEN,sizeof dlen); cudaMemcpyFromSymbol(fl,V5FLAGS,sizeof fl);
  auto hk=[](char c){ if(c>='a'&&c<='z')return c-'a'; if(c>='0'&&c<='9')return 26+c-'0'; if(c=='_')return 36; return 37; };
  for(int t=0;t<2;t++){
    static int key3[V5N], cnt3[KT*K3SUB], fill3[KT*K3SUB]; static unsigned short s3[KT*K3SUB+1], idx3[V5N];
    memset(cnt3,0,sizeof cnt3); memset(fill3,0,sizeof fill3);
    for(int w=0;w<V5N;w++){
      bool alpha=(fl[w]&1)!=0; if(alpha!=(t==0)) continue;
      int L=dlen[w]; int k=1; while(k<L && dict[w][k]==dict[w][0]) k++;
      int ka=hk(dict[w][0])*(KC+1) + (k<L ? hk(dict[w][k]) : KSINGLE);
      int sub=39;
      if(k<L){ int k2=k; while(k2<L && dict[w][k2]==dict[w][k]) k2++; if(k2<L) sub=hk(dict[w][k2]); }
      key3[w]=ka*K3SUB+sub; cnt3[key3[w]]++;
    }
    int acc=0; for(int k=0;k<KT*K3SUB;k++){ s3[k]=(unsigned short)acc; acc+=cnt3[k]; } s3[KT*K3SUB]=(unsigned short)acc;
    for(int w=0;w<V5N;w++){ bool alpha=(fl[w]&1)!=0; if(alpha!=(t==0)) continue; idx3[s3[key3[w]]+fill3[key3[w]]++]=(unsigned short)w; }
    if(t==0){ cudaMemcpyToSymbol(V5S_L,s3,sizeof s3); cudaMemcpyToSymbol(V5IDX_L,idx3,sizeof idx3); }
    else    { cudaMemcpyToSymbol(V5S_D,s3,sizeof s3); cudaMemcpyToSymbol(V5IDX_D,idx3,sizeof idx3); }
  }
  // обратный индекс: то же по перевёрнутым словам
  for(int t=0;t<2;t++){
    static int key3[V5N], cnt3[KT*K3SUB], fill3[KT*K3SUB]; static unsigned short s3[KT*K3SUB+1], idx3[V5N];
    memset(cnt3,0,sizeof cnt3); memset(fill3,0,sizeof fill3);
    for(int w=0;w<V5N;w++){
      bool alpha=(fl[w]&1)!=0; if(alpha!=(t==0)) continue;
      int L=dlen[w]; char r[V5MAXL]; for(int q=0;q<L;q++) r[q]=dict[w][L-1-q];
      int k=1; while(k<L && r[k]==r[0]) k++;
      int ka=hk(r[0])*(KC+1) + (k<L ? hk(r[k]) : KSINGLE);
      int sub=39;
      if(k<L){ int k2=k; while(k2<L && r[k2]==r[k]) k2++; if(k2<L) sub=hk(r[k2]); }
      key3[w]=ka*K3SUB+sub; cnt3[key3[w]]++;
    }
    int acc=0; for(int k=0;k<KT*K3SUB;k++){ s3[k]=(unsigned short)acc; acc+=cnt3[k]; } s3[KT*K3SUB]=(unsigned short)acc;
    for(int w=0;w<V5N;w++){ bool alpha=(fl[w]&1)!=0; if(alpha!=(t==0)) continue; idx3[s3[key3[w]]+fill3[key3[w]]++]=(unsigned short)w; }
    if(t==0){ cudaMemcpyToSymbol(V5R_S_L,s3,sizeof s3); cudaMemcpyToSymbol(V5R_IDX_L,idx3,sizeof idx3); }
    else    { cudaMemcpyToSymbol(V5R_S_D,s3,sizeof s3); cudaMemcpyToSymbol(V5R_IDX_D,idx3,sizeof idx3); }
  }
}

// ---------------- детектор слов v2 (подключается в vanity.cu) ----------------
// Правила (2026-10-03):
//  * слово может начинаться сразу после «UQ» (позиция 2) или после границы: '_' '-' или цифра;
//  * слово должно кончаться на границе (или в конце адреса);
//  * leet: в буквенных словах цифры читаются как буквы 0>o 1>i 3>e 4>a 5>s 7>t 8>b;
//    слова с цифрами (420, 1337, f00d) сравниваются как есть;
//  * гем: 3+ слова, или 2+ слова с хвостом (в т.ч. начало+хвост), ИЛИ  слово в хвосте + ещё одна редкость
//    (растяжка сильного слова, 7+ разделителей, серия 4+, <=25 разных символов).
//  * (2026-10-04) граница по РЕГИСТРУ: буквенное слово от 4 букв ровного регистра (ВСЁ / всё / Всё) может начинаться
//    и кончаться на контрасте регистра с соседней буквой: xyzHOMEabc, XYZhomeABC, abcHome, homeXyz. Пользователь:
//    «разделение визуальное очень важно, и не только - и _, но и разницей регистров». Таких слов в ~7 раз больше.
#define KC 38   // 0-25 a-z, 26-35 цифры, 36 '_', 37 прочее
#define KSINGLE KC
#define KT (KC*(KC+1))
__device__ __forceinline__ int kc(char c){ if(c>='a'&&c<='z')return c-'a'; if(c>='0'&&c<='9')return 26+c-'0'; if(c=='_')return 36; return 37; }
// два индекса: буквенные слова (ищем по leet-строке) и слова с цифрами (по обычной).
// v12 (2026-10-05): индекс по трём «пробежкам» текста. «Пробежка» — серия одинаковых символов (schmoo → s,c,h,m,o).
// Список (c0,c1,c2) — слова из 3+ пробежек; (c0,c1,·) — из двух; (c0,·) — из одной. Списки отсортированы по индексу
// слова, их слияние даёт тот же порядок, что перебор эталона (validate сверяет). Раньше (v10) перебиралась вся корзина
// (c0,c1) с отсечкой по маске c2 — на каждом слове 3 обращения к памяти; теперь только подходящие слова: +20–40% скорости.
#define K3SUB 40   // под-ключ: c2 (0..37) для слов из 3+ пробежек, 39 — для остальных
__device__ unsigned short K3S_L[KT*K3SUB+1], K3S_D[KT*K3SUB+1];   // начало списка ключа k: [S[k], S[k+1])
__device__ unsigned short K2IDX_L[NW], K2IDX_D[NW];                // слова, разложенные по спискам
__device__ unsigned char WDIG[NW];   // 1 = в слове есть цифра
__device__ __forceinline__ int b64i(char c){ if(c>='A'&&c<='Z')return c-'A'; if(c>='a'&&c<='z')return c-'a'+26; if(c>='0'&&c<='9')return c-'0'+52; return c=='-'?62:63; }
__device__ __forceinline__ int f_distinct(const char*s,int win){ u64 m=0; for(int i=48-win;i<48;i++) m|=1ull<<b64i(s[i]); return __popcll(m); }
__device__ __forceinline__ char g_leet(char c){ switch(c){ case '0':return 'o'; case '1':return 'i'; case '3':return 'e'; case '4':return 'a'; case '5':return 's'; case '7':return 't'; case '8':return 'b'; default:return c; } }
__device__ __forceinline__ bool g_isb(char n){ return n=='_' || (n>='0'&&n<='9'); }

// stretchAny (2026-10-04, v9): значимое слово где угодно, внутри которого символ повторён 4+ раз подряд (Swwwwwwwwag в середине)
struct WScan { int W, L; bool tail, start, stretchTail, stretchAny; };   // W — значимых слов, L — сумма их длин

__device__ __forceinline__ bool g_up(char c){ return c>='A'&&c<='Z'; }
__device__ __forceinline__ bool g_lo(char c){ return c>='a'&&c<='z'; }
// регистр слова raw[p..e): 1 — ВСЁ, 2 — всё, 3 — Всё (с заглавной), 0 — рваный (цифры leet не считаются)
__device__ int g_wcls(const char*raw,int p,int e){
  int nu=0,nl=0; bool capFirst=false,seen=false,restL=true;
  for(int k=p;k<e;k++){ char c=raw[k];
    if(g_up(c)){ nu++; if(!seen) capFirst=true; else restL=false; seen=true; }
    else if(g_lo(c)){ nl++; seen=true; } }
  if(nl==0) return 1; if(nu==0) return 2; return (capFirst&&restL) ? 3 : 0;
}
// контраст регистра соседа c с краем слова класса cl (left — сосед слева)
__device__ __forceinline__ bool g_cedge(char c,int cl,bool left){
  if(cl==1) return g_lo(c); if(cl==2) return g_up(c); if(cl==3) return left ? g_lo(c) : g_up(c); return false;
}
// годится ли слово w в raw[p..e): жёсткие границы (край / - _ / цифра) с обеих сторон — как раньше;
// иначе — граница по регистру: буквенное слово от 4 букв ровного регистра, контраст там, где нет жёсткой границы
__device__ __forceinline__ bool g_accept(const char*raw,const char*norm,int p,int e,int w,bool hardL){
  bool hardR = e==48 || g_isb(norm[e]);
  if(hardL && hardR) return true;
  if(WDIG[w] || DLEN[w]<4) return false;
  int cl=g_wcls(raw,p,e); if(!cl) return false;
  if(!hardL && !g_cedge(raw[p-1],cl,true)) return false;
  if(!hardR && !g_cedge(raw[e],cl,false)) return false;
  return true;
}

// первое (по индексу) слово данного типа, совпавшее в p и с годной границей (g_accept); конец или -1
template<bool FAST>
__device__ int find_word(const char*raw, const char*X, const char*norm, int p, bool digitType, bool hardL, int &wOut){
  if(FAST){
    int c0=kc(X[p]); int q=p; while(q<48 && X[q]==X[p]) q++;
    int c1 = q<48 ? kc(X[q]) : 37;
    int c2=38;
    if(q<48){ int r=q; while(r<48 && X[r]==X[q]) r++; if(r<48) c2=kc(X[r]); }
    const unsigned short *S = digitType?K3S_D:K3S_L, *I = digitType?K2IDX_D:K2IDX_L;
    int ka=(c0*(KC+1)+c1)*K3SUB, kb=(c0*(KC+1)+KSINGLE)*K3SUB+39;
    int i3=0,e3=0; if(c2<38){ i3=S[ka+c2]; e3=S[ka+c2+1]; }
    int i2=S[ka+39], e2=S[ka+40], ib=S[kb], eb=S[kb+1];
    while(i3<e3 || i2<e2 || ib<eb){
      int w3 = i3<e3 ? I[i3] : 0x7fffffff, w2 = i2<e2 ? I[i2] : 0x7fffffff, wb = ib<eb ? I[ib] : 0x7fffffff;
      int w;
      if(w3<=w2 && w3<=wb){ w=w3; i3++; } else if(w2<=wb){ w=w2; i2++; } else { w=wb; ib++; }
      if(DLEN[w]<3) continue;
      int e=g_fuzzy(X,p,w); if(e<0) continue;
      if(g_accept(raw,norm,p,e,w,hardL)){ wOut=w; return e; }
    }
  } else {
    for(int w=0; w<NW; w++){
      if((WDIG[w]!=0)!=digitType || DLEN[w]<3) continue;
      int e=g_fuzzy(X,p,w); if(e<0) continue;
      if(g_accept(raw,norm,p,e,w,hardL)){ wOut=w; return e; }
    }
  }
  return -1;
}

template<bool FAST>
__device__ WScan scan_words(const char*raw, const char*norm, const char*lnorm){
  WScan r{0,0,false,false,false,false};
  for(int p=2;p<48;p++){
    bool hardL=(p==2)||g_isb(norm[p-1]);
    // старт по регистру: буква после буквы другого регистра (abcHOME, ABChome)
    bool caseL=!hardL && ((g_up(raw[p])&&g_lo(raw[p-1])) || (g_lo(raw[p])&&g_up(raw[p-1])));
    if(!hardL && !caseL) continue;
    int w=-1;
    int e=find_word<FAST>(raw,lnorm,norm,p,false,hardL,w);
    if(e<0 && hardL) e=find_word<FAST>(raw,norm,norm,p,true,true,w);   // слова с цифрами (420, 1337) — только после жёсткой границы
    if(e<0) continue;
    // значимость короткого слова
    // 3 буквы: с одной стороны настоящий разделитель (- _ или край), с другой — хотя бы цифра
    bool lReal=(p==2 || norm[p-1]==0x5f), rReal=(e==48 || norm[e]==0x5f);
    bool sig = DLEN[w]>=4 || lReal || rReal;
    if(!sig){ p=e-1; continue; }
    r.W++; r.L+=DLEN[w];
    if(p==2) r.start=true;
    if(!r.stretchAny){ int run=1; for(int k=p+1;k<e;k++){ if(raw[k]==raw[k-1]){ if(++run>=4){ r.stretchAny=true; break; } } else run=1; } }
    bool tail=true; for(int k=e;k<48;k++) if(!g_isb(norm[k])){ tail=false; break; }
    if(tail){ r.tail=true; if(IS_SLANG[w]){ int dup=0; for(int k=p+1;k<e;k++) if(norm[k]==norm[k-1]) dup++; if(dup>=2) r.stretchTail=true; } }  // 2+ повтора букв в слове
    p=e-1;   // следующее слово — только после этого
  }
  return r;
}

// --- линзы (2026-10-04): смайлы на контрасте, мемные числа, серия/лесенка сразу после UQ ---
__device__ __forceinline__ int g_cat(char c){ if(c>='a'&&c<='z')return 1; if(c>='A'&&c<='Z')return 2; if(c>='0'&&c<='9')return 3; return 4; }
__device__ bool g_face(const char*raw){
  const char* F[]={"-_-","o_O","O_o","o_o","O_O","0_0","x_x","X_X","T_T","u_u","U_U","UwU","OwO","uwu","owo"};
  for(int f=0; f<15; f++){
    const char* s=F[f];
    for(int p=2;p+3<=48;p++){
      if(raw[p]!=s[0]||raw[p+1]!=s[1]||raw[p+2]!=s[2]) continue;
      int l = p>2 ? g_cat(raw[p-1]) : 0, r = p+3<48 ? g_cat(raw[p+3]) : 0;
      if(l!=g_cat(s[0]) && r!=g_cat(s[2])) return true;
    }
  }
  return false;
}
__device__ bool g_memnum(const char*raw){
  const char* M[]={"1337","420","80085","228","322","100500"}; const int ML[]={4,3,5,3,3,6};
  for(int m=0;m<6;m++){
    int L=ML[m];
    for(int p=2;p+L<=48;p++){
      bool ok=true; for(int k=0;k<L;k++) if(raw[p+k]!=M[m][k]){ ok=false; break; }
      if(!ok) continue;
      bool lb = p==2 || !(raw[p-1]>='0'&&raw[p-1]<='9'), rb = p+L==48 || !(raw[p+L]>='0'&&raw[p+L]<='9');
      if(lb&&rb) return true;
    }
  }
  return false;
}
// длина серии одного символа или лесенки сразу после UQ
__device__ int g_startpat(const char*raw){
  int k=1; while(2+k<48 && raw[2+k]==raw[2]) k++;
  int a=1; while(2+a<48 && raw[2+a]==raw[2+a-1]+1) a++;
  return k>a?k:a;
}

template<bool FAST>
__device__ bool gem_rules(const char*raw,int RUN_ANY,int RUN_END,int DIST,int DWIN,int ASCN,int PAL,int ADIST){
  if(g_run_end(raw)>=RUN_END) return true;
  int runAny=g_run_any(raw);
  if(runAny>=RUN_ANY) return true;
  if(f_distinct(raw,DWIN)<=DIST) return true;
  int dist46=f_distinct(raw,46);
  if(dist46<=ADIST) return true;
  if(g_asc(raw)>=ASCN) return true;
  if(g_pal(raw)>=PAL) return true;
  char norm[48], lnorm[48]; int seps=0;
  for(int i=0;i<48;i++){ norm[i]=g_norm(raw[i]); lnorm[i]=g_leet(norm[i]); if(i>=2 && norm[i]=='_') seps++; }
#ifdef NOWORDS
  WScan s{0,0,false,false,false,false};
#else
  WScan s=scan_words<FAST>(raw,norm,lnorm);
#endif
  if(s.W>=3) return true;                       // 3+ значимых слова
  if(s.stretchAny) return true;                  // растянутое слово где угодно (v9)
  if(s.W>=2 && s.tail) return true;              // 2+ слова, одно из них в хвосте (в т.ч. начало+хвост)
  if(s.tail && (s.stretchTail || seps>=7 || runAny>=4 || dist46<=25)) return true; // слово в хвосте + ещё редкость
  int sp=g_startpat(raw);
  if(sp>=5) return true;                                          // UQAAAAA / UQABCDE — как пример из документации
  if((s.tail||s.start) && (sp>=4 || g_face(raw) || g_memnum(raw))) return true;  // слово + смайл/мем-число/старт
  return false;
}

__device__ bool is_gem(const char*raw,int RUN_ANY,int RUN_END,int DIST,int DWIN,int ASCN,int PAL,int ADIST){
  return gem_rules<false>(raw,RUN_ANY,RUN_END,DIST,DWIN,ASCN,PAL,ADIST);
}
__device__ bool is_gem_fast(const char*raw,int RUN_ANY,int RUN_END,int DIST,int DWIN,int ASCN,int PAL,int ADIST){
#ifdef NOGEM
  return raw[47]=='~';  // замер: только вычисление адреса, без проверок
#endif
  return gem_rules<true>(raw,RUN_ANY,RUN_END,DIST,DWIN,ASCN,PAL,ADIST);
}

// хост: строим индексы из DICT, который уже лежит на устройстве
static void build_k2(){
  static char dict[NW][WMAXL]; static int dlen[NW];
  cudaMemcpyFromSymbol(dict,DICT,sizeof dict); cudaMemcpyFromSymbol(dlen,DLEN,sizeof dlen);
  auto hk=[](char c){ if(c>='a'&&c<='z')return c-'a'; if(c>='0'&&c<='9')return 26+c-'0'; if(c=='_')return 36; return 37; };
  static unsigned char dig[NW];
  for(int w=0;w<NW;w++){ dig[w]=0; for(int k=0;k<dlen[w];k++) if(dict[w][k]>='0'&&dict[w][k]<='9') dig[w]=1; }
  for(int t=0;t<2;t++){
    static int key3[NW], cnt3[KT*K3SUB], fill3[KT*K3SUB]; static unsigned short s3[KT*K3SUB+1], idx3[NW];
    memset(cnt3,0,sizeof cnt3); memset(fill3,0,sizeof fill3);
    for(int w=0;w<NW;w++){
      if(dig[w]!=t) continue;
      int k=1; while(k<dlen[w] && dict[w][k]==dict[w][0]) k++;                 // конец 1-й пробежки
      int ka=hk(dict[w][0])*(KC+1) + (k<dlen[w] ? hk(dict[w][k]) : KSINGLE);
      int sub=39;
      if(k<dlen[w]){ int k2=k; while(k2<dlen[w] && dict[w][k2]==dict[w][k]) k2++; if(k2<dlen[w]) sub=hk(dict[w][k2]); }
      key3[w]=ka*K3SUB+sub; cnt3[key3[w]]++;
    }
    int acc=0; for(int k=0;k<KT*K3SUB;k++){ s3[k]=(unsigned short)acc; acc+=cnt3[k]; } s3[KT*K3SUB]=(unsigned short)acc;
    for(int w=0;w<NW;w++) if(dig[w]==t) idx3[s3[key3[w]]+fill3[key3[w]]++]=(unsigned short)w;
    if(t==0){ cudaMemcpyToSymbol(K3S_L,s3,sizeof s3); cudaMemcpyToSymbol(K2IDX_L,idx3,sizeof idx3); }
    else    { cudaMemcpyToSymbol(K3S_D,s3,sizeof s3); cudaMemcpyToSymbol(K2IDX_D,idx3,sizeof idx3); }
  }
  cudaMemcpyToSymbol(WDIG,dig,sizeof dig);
}

// ---------------- word detector v2 (included from vanity.cu) ----------------
// Rules (2026-10-03):
//  * a word may start right after "UQ" (position 2) or after a boundary: '_' '-' or a digit;
//  * a word must end at a boundary (or at the end of the address);
//  * leet: in letter-only words, digits are read as letters 0>o 1>i 3>e 4>a 5>s 7>t 8>b;
//    words with digits (420, 1337, f00d) are compared as is;
//  * gem: 3+ words, or 2+ words with a tail (incl. start+tail), OR a word in the tail + one more rarity
//    (a stretched strong word, 7+ separators, a run of 4+, <=25 distinct characters).
//  * (2026-10-04) boundary by CASE: a letter word of 4+ letters in a uniform case (UPPER / lower / Capitalized) may start
//    and end at a case contrast with the neighbouring letter: xyzHOMEabc, XYZhomeABC, abcHome, homeXyz. Visual separation
//    comes not only from - and _ but also from a case difference. There are ~7 times more such words.
#define KC 38   // 0-25 a-z, 26-35 digits, 36 '_', 37 other
#define KSINGLE KC
#define KT (KC*(KC+1))
__device__ __forceinline__ int kc(char c){ if(c>='a'&&c<='z')return c-'a'; if(c>='0'&&c<='9')return 26+c-'0'; if(c=='_')return 36; return 37; }
// two indexes: letter words (looked up in the leet string) and words with digits (in the plain one).
// v12 (2026-10-05): an index over three "runs" of the text. A "run" is a series of identical characters (schmoo → s,c,h,m,o).
// The list (c0,c1,c2) holds words with 3+ runs; (c0,c1,·) with two; (c0,·) with one. The lists are sorted by word
// index, so merging them gives the same order as the reference scan (validate checks it). Previously (v10) the whole bucket
// (c0,c1) was scanned with a c2 mask cut-off — 3 memory accesses per word; now only the matching words: +20–40% speed.
#define K3SUB 40   // sub-key: c2 (0..37) for words with 3+ runs, 39 for the rest
__device__ unsigned short K3S_L[KT*K3SUB+1], K3S_D[KT*K3SUB+1];   // start of the list for key k: [S[k], S[k+1])
__device__ unsigned short K2IDX_L[NW], K2IDX_D[NW];                // words laid out by list
__device__ unsigned char WDIG[NW];   // 1 = the word contains a digit
__device__ __forceinline__ int b64i(char c){ if(c>='A'&&c<='Z')return c-'A'; if(c>='a'&&c<='z')return c-'a'+26; if(c>='0'&&c<='9')return c-'0'+52; return c=='-'?62:63; }
__device__ __forceinline__ int f_distinct(const char*s,int win){ u64 m=0; for(int i=48-win;i<48;i++) m|=1ull<<b64i(s[i]); return __popcll(m); }
__device__ __forceinline__ char g_leet(char c){ switch(c){ case '0':return 'o'; case '1':return 'i'; case '3':return 'e'; case '4':return 'a'; case '5':return 's'; case '7':return 't'; case '8':return 'b'; default:return c; } }
__device__ __forceinline__ bool g_isb(char n){ return n=='_' || (n>='0'&&n<='9'); }

// stretchAny (2026-10-04, v9): a significant word anywhere with a character repeated 4+ times in a row inside it (Swwwwwwwwag in the middle)
struct WScan { int W, L; bool tail, start, stretchTail, stretchAny; };   // W = number of significant words, L = sum of their lengths

__device__ __forceinline__ bool g_up(char c){ return c>='A'&&c<='Z'; }
__device__ __forceinline__ bool g_lo(char c){ return c>='a'&&c<='z'; }
// case of the word raw[p..e): 1 = UPPER, 2 = lower, 3 = Capitalized, 0 = ragged case (leet digits are not counted)
__device__ int g_wcls(const char*raw,int p,int e){
  int nu=0,nl=0; bool capFirst=false,seen=false,restL=true;
  for(int k=p;k<e;k++){ char c=raw[k];
    if(g_up(c)){ nu++; if(!seen) capFirst=true; else restL=false; seen=true; }
    else if(g_lo(c)){ nl++; seen=true; } }
  if(nl==0) return 1; if(nu==0) return 2; return (capFirst&&restL) ? 3 : 0;
}
// case contrast of the neighbour c with the edge of a word of class cl (left = the neighbour is on the left)
__device__ __forceinline__ bool g_cedge(char c,int cl,bool left){
  if(cl==1) return g_lo(c); if(cl==2) return g_up(c); if(cl==3) return left ? g_lo(c) : g_up(c); return false;
}
// does the word w fit raw[p..e): hard boundaries (edge / - _ / digit) on both sides — as before;
// otherwise a case boundary: a letter word of 4+ letters in a uniform case, with a contrast wherever there is no hard boundary
__device__ __forceinline__ bool g_accept(const char*raw,const char*norm,int p,int e,int w,bool hardL){
  bool hardR = e==48 || g_isb(norm[e]);
  if(hardL && hardR) return true;
  if(WDIG[w] || DLEN[w]<4) return false;
  int cl=g_wcls(raw,p,e); if(!cl) return false;
  if(!hardL && !g_cedge(raw[p-1],cl,true)) return false;
  if(!hardR && !g_cedge(raw[e],cl,false)) return false;
  return true;
}

// the first (by index) word of the given type that matches at p and has a valid boundary (g_accept); the end, or -1
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
    // start by case: a letter after a letter of the other case (abcHOME, ABChome)
    bool caseL=!hardL && ((g_up(raw[p])&&g_lo(raw[p-1])) || (g_lo(raw[p])&&g_up(raw[p-1])));
    if(!hardL && !caseL) continue;
    int w=-1;
    int e=find_word<FAST>(raw,lnorm,norm,p,false,hardL,w);
    if(e<0 && hardL) e=find_word<FAST>(raw,norm,norm,p,true,true,w);   // words with digits (420, 1337) — only after a hard boundary
    if(e<0) continue;
    // significance of a short word
    // 3 letters: a real separator on one side (- _ or the edge), at least a digit on the other
    bool lReal=(p==2 || norm[p-1]==0x5f), rReal=(e==48 || norm[e]==0x5f);
    bool sig = DLEN[w]>=4 || lReal || rReal;
    if(!sig){ p=e-1; continue; }
    r.W++; r.L+=DLEN[w];
    if(p==2) r.start=true;
    if(!r.stretchAny){ int run=1; for(int k=p+1;k<e;k++){ if(raw[k]==raw[k-1]){ if(++run>=4){ r.stretchAny=true; break; } } else run=1; } }
    bool tail=true; for(int k=e;k<48;k++) if(!g_isb(norm[k])){ tail=false; break; }
    if(tail){ r.tail=true; if(IS_SLANG[w]){ int dup=0; for(int k=p+1;k<e;k++) if(norm[k]==norm[k-1]) dup++; if(dup>=2) r.stretchTail=true; } }  // 2+ repeated letters in the word
    p=e-1;   // the next word only after this one
  }
  return r;
}

// --- lenses (2026-10-04): smileys by contrast, meme numbers, a run/ladder right after UQ ---
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
// length of a run of one character or of a ladder right after UQ
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
  if(s.W>=3) return true;                       // 3+ significant words
  if(s.stretchAny) return true;                  // a stretched word anywhere (v9)
  if(s.W>=2 && s.tail) return true;              // 2+ words, one of them in the tail (incl. start+tail)
  if(s.tail && (s.stretchTail || seps>=7 || runAny>=4 || dist46<=25)) return true; // a word in the tail + one more rarity
  int sp=g_startpat(raw);
  if(sp>=5) return true;                                          // UQAAAAA / UQABCDE — like an example from the documentation
  if((s.tail||s.start) && (sp>=4 || g_face(raw) || g_memnum(raw))) return true;  // a word + smiley/meme number/start
  return false;
}

__device__ bool is_gem(const char*raw,int RUN_ANY,int RUN_END,int DIST,int DWIN,int ASCN,int PAL,int ADIST){
  return gem_rules<false>(raw,RUN_ANY,RUN_END,DIST,DWIN,ASCN,PAL,ADIST);
}
__device__ bool is_gem_fast(const char*raw,int RUN_ANY,int RUN_END,int DIST,int DWIN,int ASCN,int PAL,int ADIST){
#ifdef NOGEM
  return raw[47]=='~';  // measurement: only the address computation, no checks
#endif
  return gem_rules<true>(raw,RUN_ANY,RUN_END,DIST,DWIN,ASCN,PAL,ADIST);
}

// host: build the indexes from DICT, which already sits on the device
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
      int k=1; while(k<dlen[w] && dict[w][k]==dict[w][0]) k++;                 // end of the 1st run
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

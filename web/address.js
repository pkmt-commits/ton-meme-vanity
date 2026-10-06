// TON wallet addresses from a public key (W5, V4R2, V3R2, V3R1) — synchronous, no libraries: SHA-256, CRC16, base64url.
// The data-cell templates and StateInit prefixes are the same as in the CUDA kernel (cuda/calib_multi.h, checked against @ton/ton).
// makeAddress(calib) → addr(pub, v) — a UQ… string (48 characters, url-safe, as wallets display it).
function makeAddress(calib) {
  const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152,
    0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb,
    0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c,
    0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  const W = new Uint32Array(64), H = new Uint32Array(8), blk = new Uint8Array(128);
  // SHA-256 of message m (≤ 119 bytes) → out (32 bytes)
  function sha256(m, len, out) {
    const nb = (len + 9 + 63) >> 6; blk.fill(0, 0, nb * 64); blk.set(m.subarray(0, len)); blk[len] = 0x80;
    const bits = len * 8; blk[nb * 64 - 1] = bits & 255; blk[nb * 64 - 2] = bits >>> 8;
    H.set([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    for (let b = 0; b < nb; b++) {
      for (let i = 0; i < 16; i++) { const o = b * 64 + 4 * i; W[i] = (blk[o] << 24) | (blk[o + 1] << 16) | (blk[o + 2] << 8) | blk[o + 3]; }
      for (let i = 16; i < 64; i++) {
        const x = W[i - 15], y = W[i - 2];
        const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
      }
      let a = H[0], bb = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const t2 = (S0 + ((a & bb) ^ (a & c) ^ (bb & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
      }
      H[0] += a; H[1] += bb; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    for (let i = 0; i < 8; i++) { out[4 * i] = H[i] >>> 24; out[4 * i + 1] = H[i] >>> 16; out[4 * i + 2] = H[i] >>> 8; out[4 * i + 3] = H[i]; }
  }
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const CRC = new Uint16Array(256);
  for (let i = 0; i < 256; i++) { let c = i << 8; for (let k = 0; k < 8; k++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) : (c << 1); CRC[i] = c & 0xffff; }
  const dataIn = new Uint8Array(64), siIn = new Uint8Array(80), dh = new Uint8Array(32), ah = new Uint8Array(32), a36 = new Uint8Array(36);
  return function addr(pub, v) {
    const tl = calib.tlen[v], off = calib.off[v];
    dataIn[0] = 0; dataIn[1] = calib.d2[v]; dataIn.set(calib.tpl[v].subarray(0, tl), 2);
    if ((off & 7) === 0) dataIn.set(pub, 2 + (off >> 3));
    else {
      const sh = off & 7, b0 = 2 + (off >> 3);
      const keep = dataIn[b0] & ((0xff << (8 - sh)) & 0xff), tail = dataIn[b0 + 32] & (0xff >> sh);
      dataIn[b0] = keep | (pub[0] >> sh);
      for (let i = 1; i < 32; i++) dataIn[b0 + i] = ((pub[i - 1] << (8 - sh)) | (pub[i] >> sh)) & 0xff;
      dataIn[b0 + 32] = ((pub[31] << (8 - sh)) & 0xff) | tail;
    }
    sha256(dataIn, 2 + tl, dh);
    siIn.set(calib.prefix[v], 0); siIn.set(dh, 39);
    sha256(siIn, 71, ah);
    a36[0] = 0x51; a36[1] = 0; a36.set(ah, 2);
    let c = 0; for (let i = 0; i < 34; i++) c = ((c << 8) ^ CRC[((c >> 8) ^ a36[i]) & 0xff]) & 0xffff;
    a36[34] = c >> 8; a36[35] = c & 255;
    let s = '';
    for (let i = 0; i < 36; i += 3) { const n = (a36[i] << 16) | (a36[i + 1] << 8) | a36[i + 2]; s += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63]; }
    return s;
  };
}
// calibration from cuda/calib_multi.h (for Node checks and for building the page)
function parseCalib(h) {
  const arr = (name) => JSON.parse('[' + h.match(new RegExp(name + '\\[[^=]*= \\{(.*)\\};'))[1].replace(/\{/g, '[').replace(/\}/g, ']') + ']');
  return { off: arr('V_OFF'), d2: arr('V_D2'), tlen: arr('V_TLEN'), tpl: arr('V_TPL').map((r) => new Uint8Array(r)), prefix: arr('V_PREFIX').map((r) => new Uint8Array(r)) };
}
if (typeof module !== 'undefined') module.exports = { makeAddress, parseCalib };

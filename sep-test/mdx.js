// MDX-Net vocal/instrumental separation (UVR models), plain JS. Works in browser and Node.
(function (root) {
  // mixed-radix complex FFT (factors 2,3,4,5), in place on interleaved arrays
  function makeFFT(N) {
    const fac = []; let n = N;
    for (const p of [4, 2, 3, 5]) while (n % p === 0) { fac.push(p); n /= p; }
    if (n !== 1) throw new Error("FFT size " + N);
    const cos = new Float64Array(N), sin = new Float64Array(N);
    for (let i = 0; i < N; i++) { cos[i] = Math.cos(-2 * Math.PI * i / N); sin[i] = Math.sin(-2 * Math.PI * i / N); }
    const tr = new Float64Array(N), ti = new Float64Array(N);
    function rec(xr, xi, off, stride, n, outR, outI, o, fi) {
      if (n === 1) { outR[o] = xr[off]; outI[o] = xi[off]; return; }
      const p = fac[fi], m = n / p;
      for (let q = 0; q < p; q++) rec(xr, xi, off + q * stride, stride * p, m, outR, outI, o + q * m, fi + 1);
      const tw = N / n, br = new Float64Array(p), bi = new Float64Array(p);
      for (let k = 0; k < m; k++) {
        for (let q = 0; q < p; q++) {
          const idx = (q * k * tw) % N, ar = outR[o + q * m + k], ai = outI[o + q * m + k];
          br[q] = ar * cos[idx] - ai * sin[idx]; bi[q] = ar * sin[idx] + ai * cos[idx];
        }
        for (let s = 0; s < p; s++) {
          let sr = 0, si = 0;
          for (let q = 0; q < p; q++) { const idx = ((q * s * m) * tw) % N; sr += br[q] * cos[idx] - bi[q] * sin[idx]; si += br[q] * sin[idx] + bi[q] * cos[idx]; }
          tr[s] = sr; ti[s] = si;
        }
        for (let s = 0; s < p; s++) { outR[o + s * m + k] = tr[s]; outI[o + s * m + k] = ti[s]; }
      }
    }
    const oR = new Float64Array(N), oI = new Float64Array(N);
    return function (xr, xi, inverse) {
      if (inverse) for (let i = 0; i < N; i++) xi[i] = -xi[i];
      rec(xr, xi, 0, 1, N, oR, oI, 0, 0);
      for (let i = 0; i < N; i++) { xr[i] = oR[i]; xi[i] = inverse ? -oI[i] : oI[i]; }
    };
  }
  const MODELS = {
    "UVR-MDX-NET-Inst_HQ_3": { nfft: 6144, dimF: 3072, stem: "inst" },
    "UVR-MDX-NET-Voc_FT": { nfft: 7680, dimF: 3072, stem: "vocals" },
    "UVR_MDXNET_KARA_2": { nfft: 5120, dimF: 2048, stem: "inst" },
  };
  async function separate(ort, session, cfg, L, R, onProgress) {
    const hop = 1024, dimT = 256, nfft = cfg.nfft, dimF = cfg.dimF, bins = nfft / 2 + 1;
    const chunk = hop * (dimT - 1), trim = nfft / 2, gen = chunk - 2 * trim;
    const n = L.length, pad = gen - (n % gen), tot = trim + n + pad + trim;
    const mp = [new Float32Array(tot), new Float32Array(tot)];
    mp[0].set(L, trim); mp[1].set(R, trim);
    const out = [new Float32Array(n + pad), new Float32Array(n + pad)];
    const fft = makeFFT(nfft), win = new Float64Array(nfft);
    for (let i = 0; i < nfft; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / nfft);
    const xr = new Float64Array(nfft), xi = new Float64Array(nfft);
    const steps = Math.ceil((n + pad) / gen);
    for (let st = 0, i = 0; i < n + pad; i += gen, st++) {
      const inp = new Float32Array(4 * dimF * dimT);
      for (let c = 0; c < 2; c++) {
        const w = mp[c].subarray(i, i + chunk);
        for (let t = 0; t < dimT; t++) {
          // centre=True with reflect padding
          for (let j = 0; j < nfft; j++) {
            let s = t * hop + j - nfft / 2;
            if (s < 0) s = -s; else if (s >= chunk) s = 2 * (chunk - 1) - s;
            xr[j] = w[s] * win[j]; xi[j] = 0;
          }
          fft(xr, xi, false);
          for (let f = 0; f < dimF; f++) { inp[((c * 2) * dimF + f) * dimT + t] = xr[f]; inp[((c * 2 + 1) * dimF + f) * dimT + t] = xi[f]; }
        }
      }
      const res = await session.run({ input: new ort.Tensor("float32", inp, [1, 4, dimF, dimT]) });
      const o = res[session.outputNames[0]].data;
      for (let c = 0; c < 2; c++) {
        const acc = new Float64Array(chunk + nfft), wsum = new Float64Array(chunk + nfft);
        for (let t = 0; t < dimT; t++) {
          xr.fill(0); xi.fill(0);
          for (let f = 0; f < dimF; f++) { xr[f] = o[((c * 2) * dimF + f) * dimT + t]; xi[f] = o[((c * 2 + 1) * dimF + f) * dimT + t]; }
          for (let f = 1; f < bins - 1; f++) { xr[nfft - f] = xr[f]; xi[nfft - f] = -xi[f]; }
          fft(xr, xi, true);
          for (let j = 0; j < nfft; j++) { const v = xr[j] / nfft * win[j]; acc[t * hop + j] += v; wsum[t * hop + j] += win[j] * win[j]; }
        }
        // drop centre padding, keep the middle (trim both ends)
        for (let s = trim; s < chunk - trim; s++) { const a = s + nfft / 2; out[c][i + s - trim] = wsum[a] > 1e-8 ? acc[a] / wsum[a] : 0; }
      }
      if (onProgress) onProgress((st + 1) / steps);
    }
    const a = [out[0].subarray(0, n), out[1].subarray(0, n)];
    const other = [new Float32Array(n), new Float32Array(n)];
    for (let c = 0; c < 2; c++) for (let s = 0; s < n; s++) other[c][s] = (c ? R : L)[s] - a[c][s];
    return cfg.stem === "inst" ? { inst: a, vocals: other } : { vocals: a, inst: other };
  }
  const api = { separate, MODELS, makeFFT };
  if (typeof module !== "undefined") module.exports = api; else root.MDX = api;
})(this);

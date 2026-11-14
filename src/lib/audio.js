import { SETTINGS } from "./settings.js";

export function monoHalf(audio) {
  let data = audio.getChannelData(0);
  if (audio.numberOfChannels > 1) {
    const r = audio.getChannelData(1),
      m = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) m[i] = (data[i] + r[i]) / 2;
    data = m;
  }
  let sr = audio.sampleRate;
  if (sr >= 44100) {
    const h = new Float32Array(Math.floor(data.length / 2));
    for (let i = 0; i < h.length; i++)
      h[i] = (data[2 * i] + data[2 * i + 1]) / 2;
    data = h;
    sr = sr / 2;
  }
  return { data, sr };
}

export function fftInPlace(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len,
      wr = Math.cos(ang),
      wi = Math.sin(ang),
      half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1,
        ci = 0;
      for (let j = 0; j < half; j++) {
        const a = i + j,
          b = a + half;
        const vr = re[b] * cr - im[b] * ci,
          vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr;
        im[b] = im[a] - vi;
        re[a] += vr;
        im[a] += vi;
        const nc = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nc;
      }
    }
  }
}
// which notes the music uses most (12 note classes), to compare its key with the vocal's
export async function chromaOf(audio, isCancelled) {
  const { data, sr } = monoHalf(audio);
  const N = 4096,
    hop = Math.round(sr * 0.5),
    df = sr / N;
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++)
    win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const h = new Array(12).fill(0);
  const re = new Float32Array(N),
    im = new Float32Array(N);
  const k0 = Math.ceil(100 / df),
    k1 = Math.floor(2000 / df);
  let frame = 0;
  for (let start = 0; start + N < data.length; start += hop) {
    if (isCancelled()) return null;
    for (let i = 0; i < N; i++) {
      re[i] = data[start + i] * win[i];
      im[i] = 0;
    }
    fftInPlace(re, im);
    for (let k = k0; k <= k1; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      const m = 69 + 12 * Math.log2((k * df) / SETTINGS.a4);
      h[((Math.round(m) % 12) + 12) % 12] += mag;
    }
    if (++frame % 25 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  const s = h.reduce((x, y) => x + y, 0) || 1;
  return h.map((v) => v / s);
}

// 16-bit mono WAV, gently normalized so quiet phone recordings are easy to hear
export function encodeWav(buf, maxGain = 8) {
  const nc = Math.min(2, buf.numberOfChannels || 1),
    sr = buf.sampleRate;
  const ch = [buf.getChannelData(0), nc > 1 ? buf.getChannelData(1) : null];
  const n = ch[0].length,
    bytes = n * nc * 2;
  const ab = new ArrayBuffer(44 + bytes),
    v = new DataView(ab);
  const w = (o, str) => {
    for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i));
  };
  w(0, "RIFF");
  v.setUint32(4, 36 + bytes, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, nc, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * nc * 2, true);
  v.setUint16(32, nc * 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, bytes, true);
  let peak = 0;
  for (let c = 0; c < nc; c++) {
    const d = ch[c];
    for (let i = 0; i < n; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
    }
  }
  const g = peak > 0 ? Math.min(0.9 / peak, maxGain) : 1;
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < nc; c++) {
      v.setInt16(o, Math.max(-1, Math.min(1, ch[c][i] * g)) * 32767, true);
      o += 2;
    }
  return new Blob([ab], { type: "audio/wav" });
}
// a soft room echo, made from decaying noise
export function makeImpulse(ctx, secs = 1.8) {
  const len = Math.floor(ctx.sampleRate * secs),
    ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < len; i++)
      d[i] =
        (Math.random() * 2 - 1) *
        Math.pow(1 - i / len, 3) *
        (i < 300 ? i / 300 : 1);
  }
  return ir;
}
export function peakOf(buf) {
  let p = 0;
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const a = Math.abs(d[i]);
    if (a > p) p = a;
  }
  return p || 1;
}
export async function saveBlob(blob, filename) {
  let dl = null;
  try {
    dl =
      window.claude && window.claude.use
        ? await window.claude.use("downloads")
        : null;
  } catch (e) {
    dl = null;
  }
  if (dl) {
    await dl.save({ filename, data: blob });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// piano-like tone: a few slightly stretched partials with a fast attack and a natural decay
export function playPiano(ctx, midi, dur = 3.2) {
  const when = ctx.currentTime + 0.02;
  const f = SETTINGS.a4 * Math.pow(2, (midi - 69) / 12);
  const out = ctx.createGain();
  // brightness fades as the string rings, like a real piano
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.Q.value = 0.6;
  lp.frequency.setValueAtTime(Math.min(12000, f * 12), when);
  lp.frequency.exponentialRampToValueAtTime(
    Math.min(5000, f * 3.5),
    when + Math.min(1.2, dur * 0.55),
  );
  out.connect(lp);
  lp.connect(ctx.destination);
  // quick hammer strike, a fast first drop, a slow natural decay, then a soft release
  out.gain.setValueAtTime(0.0001, when);
  out.gain.linearRampToValueAtTime(0.5, when + 0.005);
  out.gain.exponentialRampToValueAtTime(0.3, when + 0.15);
  out.gain.exponentialRampToValueAtTime(0.13, when + dur * 0.78);
  out.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  const amps = [1, 0.55, 0.34, 0.22, 0.14, 0.09, 0.055, 0.035];
  const total = amps.reduce((s, v) => s + v, 0);
  amps.forEach((amp, i) => {
    const n = i + 1,
      fn = f * n * Math.sqrt(1 + 0.00012 * n * n);
    if (fn > 12000) return;
    // two slightly detuned strings per note give the warm piano shimmer
    [-0.0006, 0.0006].forEach((dt) => {
      const o = ctx.createOscillator();
      o.type = i === 0 ? "triangle" : "sine";
      o.frequency.value = fn * (1 + dt);
      const g = ctx.createGain();
      g.gain.setValueAtTime((amp / total) * 0.5, when);
      g.gain.exponentialRampToValueAtTime(
        (amp / total) * 0.5 * 0.08,
        when + dur / (1 + i * 0.55),
      );
      o.connect(g);
      g.connect(out);
      o.start(when);
      o.stop(when + dur + 0.05);
    });
  });
  // a tiny felt "thump" from the hammer
  try {
    const len = Math.floor(ctx.sampleRate * 0.03),
      nb = ctx.createBuffer(1, len, ctx.sampleRate),
      d = nb.getChannelData(0);
    for (let i = 0; i < len; i++)
      d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const ns = ctx.createBufferSource();
    ns.buffer = nb;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = Math.min(4000, f * 3);
    bp.Q.value = 1.2;
    const ng = ctx.createGain();
    ng.gain.value = 0.06;
    ns.connect(bp);
    bp.connect(ng);
    ng.connect(ctx.destination);
    ns.start(when);
  } catch (e) {}
}

export function playChime(ctx) {
  [88, 93].forEach((m, i) => {
    const t = ctx.currentTime + 0.02 + i * 0.09;
    const o = ctx.createOscillator(),
      g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = SETTINGS.a4 * Math.pow(2, (m - 69) / 12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.4);
  });
}


/* ---------- vocal range ---------- */

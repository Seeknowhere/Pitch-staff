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

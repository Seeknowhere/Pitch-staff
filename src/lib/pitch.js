/* ---------- autocorrelation pitch detection ---------- */
export function detectPitch(buf, sr, gate = 0.01, minClarity = 0.8) {
  const n = buf.length;
  let rms = 0;
  for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / n);
  if (rms < gate) return { freq: -1, rms };

  const minLag = Math.floor(sr / 1400); // highest pitch ~1400 Hz
  const maxLag = Math.min(Math.floor(sr / 65), n - 2); // lowest pitch ~65 Hz
  const c = new Float32Array(maxLag + 2);
  let c0 = 0;
  for (let j = 0; j < n; j++) c0 += buf[j] * buf[j];
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let j = 0; j < n - lag; j++) s += buf[j] * buf[j + lag];
    c[lag] = s;
  }
  // skip the initial downward slope from lag 0
  let d = minLag;
  while (d < maxLag && c[d] > c[d + 1]) d++;
  let max = -Infinity,
    pos = -1;
  for (let i = d; i <= maxLag; i++)
    if (c[i] > max) {
      max = c[i];
      pos = i;
    }
  if (pos < 0) return { freq: -1, rms };
  // prefer the first strong peak (avoids octave-down errors)
  for (let i = d + 1; i < maxLag; i++) {
    if (c[i] >= 0.9 * max && c[i] >= c[i - 1] && c[i] >= c[i + 1]) {
      pos = i;
      break;
    }
  }
  const clarity = (c[pos] * n) / ((n - pos) * c0);
  if (clarity < minClarity) return { freq: -1, rms };
  // parabolic interpolation for sub-sample accuracy
  let T = pos;
  const x1 = c[pos - 1],
    x2 = c[pos],
    x3 = c[pos + 1];
  const a = (x1 + x3 - 2 * x2) / 2,
    b = (x3 - x1) / 2;
  if (a) T = pos - b / (2 * a);
  return { freq: sr / T, rms, clarity };
}

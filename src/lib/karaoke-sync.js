import { GRID } from "./analysis.js";
import { monoHalf } from "./audio.js";
import { pearson, mean } from "./math.js";

export const KARA_SYNC_KEY = "pitchstaff.karasync.v1";

// onset strength at 50 fps: how sharply the loudness rises
export function onsetEnvelope(audio) {
  const { data, sr } = monoHalf(audio);
  const hop = Math.round(sr * GRID),
    n = Math.floor(data.length / hop);
  const db = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let s = 0;
    for (let i = k * hop; i < (k + 1) * hop; i++) s += data[i] * data[i];
    db[k] = 10 * Math.log10(s / hop + 1e-10);
  }
  const on = new Float32Array(n);
  for (let k = 1; k < n; k++) on[k] = Math.max(0, db[k] - db[k - 1]);
  return on;
}

// find where the music lines up with the vocal: returns seconds to add to song time to get music time
export function autoSync(a, b) {
  const maxLag = 1000; // ±20 s
  const ma = mean(Array.from(a)),
    mb = mean(Array.from(b));
  const A = a.map((v) => v - ma),
    Bv = b.map((v) => v - mb);
  const scores = [];
  let best = -Infinity,
    bestL = 0;
  for (let L = -maxLag; L <= maxLag; L++) {
    let s = 0;
    for (let k = 0; k < A.length; k++) {
      const j = k + L;
      if (j >= 0 && j < Bv.length) s += A[k] * Bv[j];
    }
    scores.push(s);
    if (s > best) {
      best = s;
      bestL = L;
    }
  }
  const mu = mean(scores),
    sd = Math.sqrt(mean(scores.map((s) => (s - mu) ** 2))) || 1;
  return { off: bestL * GRID, z: (best - mu) / sd };
}

// how many piano keys the music sits above the vocal (0 = same key)
export function keyGap(notes, instChroma) {
  const v = new Array(12).fill(0);
  notes.forEach((n) => {
    v[((n.midi % 12) + 12) % 12] += n.end - n.pos;
  });
  let best = 0,
    bc = -2;
  const c0 = pearson(v, instChroma);
  for (let r = 0; r < 12; r++) {
    const rot = v.map((_, i) => v[(i - r + 12) % 12]);
    const c = pearson(rot, instChroma);
    if (c > bc) {
      bc = c;
      best = r;
    }
  }
  if (best !== 0 && bc - c0 > 0.15) return best > 6 ? best - 12 : best;
  return 0;
}

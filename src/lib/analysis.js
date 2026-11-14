import { syllableCount } from "./lyrics.js";
import { median } from "./math.js";
import { freqToMidi } from "./music.js";
import { detectPitch } from "./pitch.js";
import { SETTINGS } from "./settings.js";

export const GRID = 0.02; // pitch track resolution: 50 frames per second

export const SESS_KEY = "pitchstaff.sessions.v1";

export const foldOct = (d) => d - 12 * Math.round(d / 12);

export async function decodeFile(file) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  try {
    const ab = await file.arrayBuffer();
    return await new Promise((res, rej) => {
      const p = ctx.decodeAudioData(ab, res, rej);
      if (p && p.then) p.then(res, rej);
    });
  } finally {
    if (ctx.close) ctx.close().catch(() => {});
  }
}

// Full pitch track (50 fps grid of fractional MIDI, NaN = silence) plus the list of held notes.
export async function trackPitch(audio, onProgress, isCancelled) {
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
  const N = 1024,
    hop = 512,
    total = Math.max(1, Math.floor((data.length - N) / hop));
  const raw = new Float32Array(total).fill(NaN),
    rawL = new Float32Array(total).fill(-100),
    weak = new Float32Array(total).fill(NaN);
  const notes = [];
  let cand = { midi: null, since: 0 },
    confirmed = null,
    silentSince = -1;
  const recent = [];
  for (let f = 0; f < total; f++) {
    if (isCancelled()) return null;
    const t = (f * hop) / sr;
    // songs are a little less strict than the live mic: breathy, echoey singing still counts
    const r = detectPitch(
      data.subarray(f * hop, f * hop + N),
      sr,
      0.01,
      0.55,
    );
    rawL[f] = 20 * Math.log10(r.rms + 1e-5);
    // weaker pitch (clarity 0.55–0.75) is kept aside: lyric lines that are short of notes can look here later
    if (r.freq > 0 && r.clarity < 0.75) {
      weak[f] = 69 + 12 * Math.log2(r.freq / SETTINGS.a4);
      r.freq = -1;
    }
    if (r.freq > 0) {
      raw[f] = 69 + 12 * Math.log2(r.freq / SETTINGS.a4);
      silentSince = -1;
      recent.push(r.freq);
      if (recent.length > 5) recent.shift();
      const med = median(recent);
      const { midi, cents } = freqToMidi(med);
      if (midi !== cand.midi) cand = { midi, since: t };
      if (t - cand.since >= 0.12 && confirmed !== midi) {
        if (notes.length && notes[notes.length - 1].end == null)
          notes[notes.length - 1].end = cand.since;
        notes.push({
          midi,
          freq: med,
          cents,
          pos: cand.since,
          end: null,
          cut: confirmed === null ? "silence" : "pitch",
        });
        confirmed = midi;
      }
    } else {
      if (silentSince < 0) silentSince = t;
      if (t - silentSince > 0.12) {
        if (
          confirmed !== null &&
          notes.length &&
          notes[notes.length - 1].end == null
        )
          notes[notes.length - 1].end = silentSince;
        confirmed = null;
        cand = { midi: null, since: 0 };
        recent.length = 0;
      }
    }
    if (f % 150 === 0) {
      onProgress(f / total);
      await new Promise((res) => setTimeout(res, 0));
    }
  }
  if (notes.length && notes[notes.length - 1].end == null)
    notes[notes.length - 1].end = data.length / sr;
  // light 3-frame median to remove single-frame glitches
  const smooth = new Float32Array(total).fill(NaN);
  for (let f = 0; f < total; f++) {
    const w = [raw[f - 1], raw[f], raw[f + 1]].filter(
      (v) => v === v && v !== undefined,
    );
    if (w.length >= 2 && raw[f] === raw[f]) smooth[f] = median(w);
  }
  const len = Math.ceil(audio.duration / GRID);
  const grid = new Float32Array(len).fill(NaN),
    loud = new Float32Array(len).fill(-100),
    loose = new Float32Array(len).fill(NaN);
  for (let k = 0; k < len; k++) {
    const f = Math.round((k * GRID * sr) / hop);
    if (f < total) {
      grid[k] = smooth[f];
      loud[k] = rawL[f];
      loose[k] = weak[f];
    }
  }
  onProgress(1);
  return {
    duration: audio.duration,
    grid,
    loud,
    loose,
    notes: fixOctaves(splitOnConsonants(notes, raw, rawL, hop, sr), grid),
  };
}

// The pitch finder sometimes lands a whole octave too low or high. Pull a note back when it sits
// 9+ semitones away from the notes around it (within 4 s) and moving it an octave brings it closer.
function fixOctaves(notes, grid) {
  if (notes.length < 5) return notes;
  const out = notes.map((n) => ({ ...n }));
  for (let pass = 0; pass < 2; pass++) {
    out.forEach((n, i) => {
      const mid = (n.pos + n.end) / 2,
        w = [];
      out.forEach((m, j) => {
        if (j !== i && Math.abs((m.pos + m.end) / 2 - mid) < 4)
          w.push([m.midi, m.end - m.pos]);
      });
      if (w.length < 4) return;
      w.sort((a, b) => a[0] - b[0]);
      const tot = w.reduce((a, x) => a + x[1], 0);
      let acc = 0,
        med = w[0][0];
      for (const [mm, d] of w) {
        acc += d;
        if (acc >= tot / 2) {
          med = mm;
          break;
        }
      }
      const off = n.midi - med;
      if (Math.abs(off) < 9) return;
      const sh = off > 0 ? -12 : 12;
      if (Math.abs(off + sh) >= Math.abs(off)) return;
      n.midi += sh;
      n.freq *= Math.pow(2, sh / 12);
      for (
        let k = Math.round(n.pos / GRID);
        k < Math.round(n.end / GRID) && k < grid.length;
        k++
      )
        if (grid[k] === grid[k]) grid[k] += sh;
    });
  }
  return out;
}

// With lyrics loaded, each line tells us roughly how many notes to expect (one per syllable).
// Lines short of notes look again with a looser ear and split notes at clear dips or pitch steps;
// lines with too many drop blips that look like breaths or echo. Real notes are never forced out.
export function guideBySyllables(notes, data, spans, tl) {
  if (!notes.length || !spans.length || !data.loud) return notes;
  const G = GRID,
    grid = data.grid,
    loud = data.loud,
    loose = data.loose || new Float32Array(0);
  const kOf = (t) =>
    Math.max(0, Math.min(grid.length - 1, Math.round(t / G)));
  const med = (a) => {
    if (!a.length) return NaN;
    const s = [...a].sort((x, y) => x - y);
    return s[s.length >> 1];
  };
  const loudOf = (a, b) => {
    let m = -100;
    for (let k = kOf(a); k <= kOf(b); k++) m = Math.max(m, loud[k]);
    return m;
  };
  let out = notes.map((n) => ({ ...n }));
  spans.forEach((l) => {
    if (!l.text) return;
    const want = l.text
      .split(/\s+/)
      .filter(Boolean)
      .reduce((a, w) => a + syllableCount(w, tl), 0);
    if (!want) return;
    const a = l.start - 0.08,
      b = l.end - 0.02;
    const inLine = () => out.filter((n) => n.pos >= a && n.pos < b);
    let ln = inLine();
    const lineLoud = med(
      ln.map((n) => loudOf(n.pos, n.end)).filter((v) => v > -90),
    );
    const centre = ln.length ? med(ln.map((n) => n.midi)) : NaN;
    // 1. too many: drop blips (very short, or short and quiet, or short and glued to the same pitch)
    if (ln.length > want) {
      const cand = ln
        .filter((n) => n.end - n.pos < 0.15)
        .map((n) => {
          const i = out.indexOf(n),
            p = out[i - 1],
            q = out[i + 1];
          const glued =
            (p && p.midi === n.midi && n.pos - p.end < 0.04) ||
            (q && q.midi === n.midi && q.pos - n.end < 0.04);
          const quiet = loudOf(n.pos, n.end) < lineLoud - 6;
          return {
            n,
            p,
            q,
            glued,
            junk: n.end - n.pos < 0.1 || quiet || glued,
            sc: n.end - n.pos + (quiet ? -0.1 : 0) + (glued ? -0.05 : 0),
          };
        })
        .filter((c) => c.junk)
        .sort((x, y) => x.sc - y.sc);
      for (const c of cand) {
        if (inLine().length <= want) break;
        const i = out.indexOf(c.n);
        if (i < 0) continue;
        if (c.p && c.p.midi === c.n.midi && c.n.pos - c.p.end < 0.04)
          c.p.end = c.n.end;
        else if (c.q && c.q.midi === c.n.midi && c.q.pos - c.n.end < 0.04)
          c.q.pos = c.n.pos;
        out.splice(i, 1);
      }
    }
    // 2. too few: pick up sung stretches that never became notes (weak or short pitch)
    ln = inLine();
    if (ln.length < want) {
      const covered = (k) =>
        out.some((n) => k * G >= n.pos - 0.01 && k * G < n.end + 0.01);
      const runs = [];
      let cur = null;
      for (let k = kOf(a); k <= kOf(b); k++) {
        const v =
          grid[k] === grid[k]
            ? grid[k]
            : loose[k] === loose[k]
              ? loose[k]
              : NaN;
        const ok =
          v === v && !covered(k) && (!cur || Math.abs(v - med(cur.v)) < 1);
        if (ok) {
          if (!cur) cur = { k0: k, v: [] };
          cur.v.push(v);
          cur.k1 = k;
        } else {
          if (cur) runs.push(cur);
          cur = v === v && !covered(k) ? { k0: k, k1: k, v: [v] } : null;
        }
      }
      if (cur) runs.push(cur);
      const adds = runs
        .filter(
          (r) =>
            r.k1 - r.k0 + 1 >= 5 &&
            loudOf(r.k0 * G, r.k1 * G) > lineLoud - 10,
        )
        .sort((x, y) => y.k1 - y.k0 - (x.k1 - x.k0))
        .slice(0, want - ln.length);
      adds.forEach((r) => {
        let m = Math.round(med(r.v));
        if (centre === centre && Math.abs(m - centre) >= 9)
          m += m > centre ? -12 : 12;
        out.push({
          midi: m,
          freq: SETTINGS.a4 * Math.pow(2, (m - 69) / 12),
          cents: 0,
          pos: r.k0 * G,
          end: (r.k1 + 1) * G,
          cut: "guide",
        });
      });
      out.sort((x, y) => x.pos - y.pos);
    }
    // 3. still too few: split notes at the clearest loudness dip or pitch step
    for (let guard = 0; guard < 20 && inLine().length < want; guard++) {
      let best = null;
      inLine().forEach((n) => {
        if (n.end - n.pos < 0.24) return;
        const k0 = kOf(n.pos) + 5,
          k1 = kOf(n.end) - 5;
        for (let k = k0; k <= k1; k++) {
          const dip =
            Math.min(
              loudOf((k - 5) * G, (k - 1) * G),
              loudOf((k + 1) * G, (k + 5) * G),
            ) - loud[k];
          const pa = [],
            pb = [];
          for (let j = k - 5; j < k; j++)
            if (grid[j] === grid[j]) pa.push(grid[j]);
          for (let j = k; j < k + 5; j++)
            if (grid[j] === grid[j]) pb.push(grid[j]);
          const step =
            pa.length >= 3 && pb.length >= 3
              ? Math.abs(med(pa) - med(pb))
              : 0;
          const sc = Math.max(dip / 3, step / 0.8);
          if (sc >= 1 && (!best || sc > best.sc))
            best = {
              n,
              k,
              sc,
              mb: pb.length >= 3 ? Math.round(med(pb)) : n.midi,
            };
        }
      });
      if (!best) break;
      const n = best.n,
        t = best.k * G;
      let m2 = best.mb;
      if (Math.abs(m2 - n.midi) >= 9) m2 = n.midi;
      out.splice(out.indexOf(n) + 1, 0, {
        ...n,
        pos: t,
        midi: m2,
        freq: SETTINGS.a4 * Math.pow(2, (m2 - 69) / 12),
        cut: "guide",
      });
      n.end = t;
    }
  });
  out.sort((x, y) => x.pos - y.pos);
  for (let i = 1; i < out.length; i++)
    if (out[i].pos < out[i - 1].end) out[i - 1].end = out[i].pos;
  return out.filter((n) => n.end - n.pos > 0.04);
}

// Two syllables sung on the same pitch would merge into one long note. Split notes where a
// consonant shows: a short unvoiced gap (s, t, k…) or a clear dip in loudness (m, n, l…).
function splitOnConsonants(notes, raw, rawL, hop, sr) {
  const fr = (t) => Math.round((t * sr) / hop),
    tm = (f) => (f * hop) / sr;
  const W = Math.max(3, Math.round((0.12 * sr) / hop)),
    out = [];
  notes.forEach((n) => {
    if (n.end - n.pos < 0.28) {
      out.push(n);
      return;
    }
    const f0 = fr(n.pos),
      f1 = Math.min(raw.length - 1, fr(n.end)),
      cuts = [];
    let last = f0;
    for (let f = f0 + 3; f < f1 - 3; f++) {
      let gap = 0;
      while (f + gap < f1 && raw[f + gap] !== raw[f + gap]) gap++;
      let cut = -1;
      if (gap >= 2) cut = f + (gap >> 1);
      else {
        let a = -200,
          b = -200;
        for (let q = Math.max(f0, f - W); q < f; q++)
          a = Math.max(a, rawL[q]);
        for (let q = f + 1; q <= Math.min(f1 - 1, f + W); q++)
          b = Math.max(b, rawL[q]);
        if (
          rawL[f] <= rawL[f - 1] &&
          rawL[f] <= rawL[f + 1] &&
          rawL[f] <= Math.min(a, b) - 7
        )
          cut = f;
      }
      if (
        cut >= 0 &&
        tm(cut) - tm(last) >= 0.12 &&
        tm(f1) - tm(cut) >= 0.12
      ) {
        cuts.push(cut);
        last = cut;
        f = cut + 3;
      } else if (gap >= 2) f += gap;
    }
    if (!cuts.length) {
      out.push(n);
      return;
    }
    let st = n.pos;
    cuts.forEach((c, i) => {
      out.push({ ...n, pos: st, end: tm(c), cut: i === 0 ? n.cut : "dip" });
      st = tm(c);
    });
    out.push({ ...n, pos: st, end: n.end, cut: "dip" });
  });
  return out;
}

// simple piano-like guide tones for the original's notes, shifted into the singer's key
export function scheduleGuide(ctx, dest, notes, from, to, when, semis, speed = 1) {
  const out = [];
  notes.forEach((n) => {
    const s = Math.max(n.pos, from),
      e = Math.min(n.end, to);
    if (e - s < 0.06) return;
    const st = when + (s - from) / speed,
      en = when + (e - from) / speed;
    const f = SETTINGS.a4 * Math.pow(2, (n.midi + semis - 69) / 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, st);
    g.gain.exponentialRampToValueAtTime(0.3, st + 0.015);
    g.gain.exponentialRampToValueAtTime(0.15, Math.max(st + 0.03, en - 0.05));
    g.gain.exponentialRampToValueAtTime(0.0001, en);
    g.connect(dest);
    const o1 = ctx.createOscillator();
    o1.type = "triangle";
    o1.frequency.value = f;
    o1.connect(g);
    const o2 = ctx.createOscillator();
    o2.type = "sine";
    o2.frequency.value = f * 2;
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    o2.connect(g2);
    g2.connect(g);
    o1.start(st);
    o2.start(st);
    o1.stop(en + 0.02);
    o2.stop(en + 0.02);
    out.push(o1, o2);
  });
  return out;
}

// Which key did the singer use? Compare note-class histograms, then confirm with alignment.
function keyCandidates(o, t) {
  const hist = (g) => {
    const h = new Float64Array(12);
    let n = 0;
    for (let k = 0; k < g.length; k++) {
      const v = g[k];
      if (v !== v) continue;
      const pc = ((v % 12) + 12) % 12,
        i = Math.floor(pc),
        f = pc - i;
      h[i % 12] += 1 - f;
      h[(i + 1) % 12] += f;
      n++;
    }
    if (n) for (let i = 0; i < 12; i++) h[i] /= n;
    return h;
  };
  const A = hist(o.grid),
    B = hist(t.grid);
  const sc = [];
  for (let r = 0; r < 12; r++) {
    let s = 0;
    for (let i = 0; i < 12; i++) s += A[i] * B[(i + r) % 12];
    sc.push({ r: r > 6 ? r - 12 : r, s });
  }
  sc.sort((x, y) => y.s - x.s);
  const c = [0];
  sc.slice(0, 2).forEach((x) => {
    if (!c.includes(x.r)) c.push(x.r);
  });
  return c;
}

export function detectKeyAndOffset(o, t, keyFree) {
  const cands = keyFree ? keyCandidates(o, t) : [0];
  let best = null;
  cands.forEach((ks) => {
    const r = autoAlign(o, t, ks);
    if (!best || r.score > best.score * (ks === 0 ? 0.95 : 1.05))
      best = { ks, off: r.off, score: r.score };
  });
  return best;
}

function autoAlign(o, t, ks = 0) {
  const a = o.grid,
    b = t.grid,
    maxLag = 750; // ±15 s
  let best = -1,
    bestL = 0;
  for (let L = -maxLag; L <= maxLag; L++) {
    let m = 0;
    for (let k = 0; k < a.length; k += 2) {
      const ak = a[k];
      if (ak !== ak) continue;
      const j = k + L;
      if (j < 0 || j >= b.length) continue;
      const bj = b[j];
      if (bj !== bj) continue;
      if (Math.abs(foldOct(bj - ak - ks)) < 0.6) m++;
    }
    if (m > best || (m === best && Math.abs(L) < Math.abs(bestL))) {
      best = m;
      bestL = L;
    }
  }
  return { off: bestL, score: best };
}

export function fixedMap(len, off) {
  const m = new Int32Array(len);
  for (let k = 0; k < len; k++) m[k] = k + off;
  return m;
}

// Dynamic time warping on 10 fps features (note class, voicing, loudness, onsets).
// Returns a 50 fps map: take frame index for each original frame, or null if it fails.
export function warpMap(o, t, off, ks = 0) {
  const S = 5,
    B = 120,
    PEN = 0.3; // 10 fps, ±12 s band around the tempo line
  const feat = (tr) => {
    const n = Math.floor(tr.grid.length / S);
    const p = new Float32Array(n).fill(NaN),
      L = new Float32Array(n),
      on = new Float32Array(n);
    const ls = Array.from(tr.loud)
      .filter((v) => isFinite(v))
      .sort((x, y) => x - y);
    const ref = ls.length ? ls[Math.floor(ls.length * 0.95)] : 0;
    for (let i = 0; i < n; i++) {
      const vals = [];
      let sum = 0;
      for (let r = 0; r < S; r++) {
        const k = i * S + r,
          g = tr.grid[k];
        if (g === g) vals.push(g);
        const l = tr.loud[k];
        sum += isFinite(l) ? Math.max(-60, l - ref) : -60;
      }
      if (vals.length >= 3) p[i] = median(vals);
      L[i] = sum / S;
    }
    for (let i = 1; i < n; i++) on[i] = Math.max(0, L[i] - L[i - 1]);
    return { p, L, on, n };
  };
  const A = feat(o),
    T = feat(t);
  if (A.n < 10 || T.n < 10) return null;
  const ext = (F) => {
    const ok = (i) => {
      let c = 0;
      for (let r = 0; r < 5 && i + r < F.n; r++)
        if (F.p[i + r] === F.p[i + r]) c++;
      return c >= 3;
    };
    let a = -1,
      b = -1;
    for (let i = 0; i < F.n; i++)
      if (ok(i)) {
        a = i;
        break;
      }
    for (let i = F.n - 5; i >= 0; i--)
      if (ok(i)) {
        b = i + 4;
        break;
      }
    return [a, b];
  };
  const [oa, ob] = ext(A),
    [ta, tb] = ext(T);
  let slope = 1,
    inter = off / S;
  if (oa >= 0 && ta >= 0 && ob > oa + 20 && tb > ta + 20) {
    slope = Math.min(2, Math.max(0.5, (tb - ta) / (ob - oa)));
    inter = ta - oa * slope;
  }
  const W = 2 * B + 1;
  const lo = (i) =>
    Math.min(
      Math.max(Math.round(inter + i * slope) - B, 0),
      Math.max(0, T.n - W),
    );
  const cost = (i, j) => {
    const pa = A.p[i],
      pb = T.p[j];
    let pc;
    if (pa === pa && pb === pb)
      pc = Math.min(Math.abs(foldOct(pb - pa - ks)), 3) / 3;
    else if (pa === pa || pb === pb) pc = 0.6;
    else pc = 0.1;
    const lc = Math.min(1, Math.abs(A.L[i] - T.L[j]) / 20);
    const oc = Math.min(1, Math.abs(A.on[i] - T.on[j]) / 10);
    return 0.6 * pc + 0.25 * lc + 0.15 * oc;
  };
  const D = new Float32Array(A.n * W).fill(Infinity),
    P = new Uint8Array(A.n * W);
  for (let i = 0; i < A.n; i++) {
    const l = lo(i),
      lp = i ? lo(i - 1) : 0;
    for (let w = 0; w < W; w++) {
      const j = l + w;
      if (j < 0 || j >= T.n) continue;
      const c = cost(i, j);
      if (i === 0) {
        D[w] = c;
        continue;
      } // free start anywhere in the take
      let best = Infinity,
        ptr = 0;
      const wd = j - 1 - lp,
        wu = j - lp;
      if (wd >= 0 && wd < W && D[(i - 1) * W + wd] < best) {
        best = D[(i - 1) * W + wd];
        ptr = 1;
      }
      if (wu >= 0 && wu < W && D[(i - 1) * W + wu] + PEN < best) {
        best = D[(i - 1) * W + wu] + PEN;
        ptr = 2;
      }
      if (w >= 1 && D[i * W + w - 1] + PEN < best) {
        best = D[i * W + w - 1] + PEN;
        ptr = 3;
      }
      if (ptr) {
        D[i * W + w] = c + best;
        P[i * W + w] = ptr;
      }
    }
  }
  let w = -1,
    bestEnd = Infinity;
  for (let x = 0; x < W; x++) {
    const v = D[(A.n - 1) * W + x];
    if (v < bestEnd) {
      bestEnd = v;
      w = x;
    }
  }
  if (w < 0) return null;
  const Mc = new Float32Array(A.n),
    cnt = new Uint16Array(A.n);
  let i = A.n - 1,
    guard = A.n * W;
  while (i >= 0 && guard-- > 0) {
    const j = lo(i) + w;
    Mc[i] += j;
    cnt[i]++;
    const ptr = P[i * W + w];
    if (ptr === 1) {
      i--;
      if (i < 0) break;
      w = j - 1 - lo(i);
    } else if (ptr === 2) {
      i--;
      if (i < 0) break;
      w = j - lo(i);
    } else if (ptr === 3) {
      w--;
    } else break;
  }
  for (let x = 0; x < A.n; x++)
    if (!cnt[x]) return null;
    else Mc[x] /= cnt[x];
  // back to 50 fps, smoothed and kept moving forward
  const len = o.grid.length,
    raw = new Float32Array(len);
  for (let k = 0; k < len; k++) {
    const x = Math.max(0, Math.min(A.n - 1, (k - 2) / S));
    const i0 = Math.floor(x),
      i1 = Math.min(A.n - 1, i0 + 1),
      fr = x - i0;
    raw[k] = (Mc[i0] + (Mc[i1] - Mc[i0]) * fr) * S + 2;
  }
  const out = new Int32Array(len);
  let run = -Infinity;
  for (let k = 0; k < len; k++) {
    let s = 0,
      c = 0;
    for (let q = Math.max(0, k - 10); q <= Math.min(len - 1, k + 10); q++) {
      s += raw[q];
      c++;
    }
    run = Math.max(run, Math.round(s / c));
    out[k] = run;
  }
  return out;
}

// map an original-timeline time (s) to take time (s), and back
export function mapTime(map, tO) {
  const k = Math.max(0, Math.min(map.length - 1, Math.round(tO / GRID)));
  return map[k] * GRID + (tO - k * GRID);
}

export function invTime(map, tT) {
  const n = map.length;
  if (tT <= map[0] * GRID) return tT - map[0] * GRID;
  if (tT >= map[n - 1] * GRID)
    return (n - 1) * GRID + (tT - map[n - 1] * GRID);
  let lo = 0,
    hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (map[mid] * GRID <= tT) lo = mid;
    else hi = mid - 1;
  }
  return lo * GRID + Math.min(GRID, tT - map[lo] * GRID);
}

// warp only the stretch of the song your take covers, so a short take isn't squeezed across the whole song
export function warpTake(o, t, off, ks) {
  const len = o.grid.length,
    tl = t.grid.length;
  const pad = Math.max(150, Math.round(0.15 * tl));
  const lo = Math.max(0, -off - pad),
    hi = Math.min(len, tl - off + pad);
  if (hi - lo < 60) return null;
  if (lo === 0 && hi === len) return warpMap(o, t, off, ks);
  const sub = {
    grid: o.grid.subarray(lo, hi),
    loud: o.loud.subarray(lo, hi),
    notes: [],
    duration: (hi - lo) * GRID,
  };
  const m = warpMap(sub, t, off + lo, ks);
  if (!m) return null;
  const out = new Int32Array(len);
  for (let k = 0; k < len; k++)
    out[k] = k < lo ? k + off : k >= hi ? k + off : m[k - lo];
  return out;
}

export function compare(o, t, map, octaveFree, warped, off, ks = 0) {
  const a = o.grid,
    b = t.grid;
  const fold = octaveFree ? foldOct : (d) => d;
  const rawD = [];
  for (let k = 0; k < a.length; k += 3) {
    const j = map[k];
    if (a[k] === a[k] && j >= 0 && j < b.length && b[j] === b[j])
      rawD.push(b[j] - a[k]);
  }
  const med0 = rawD.length ? median(rawD) : 0;
  const shift = octaveFree ? ks + 12 * Math.round((med0 - ks) / 12) : ks;
  // with warping, allow ±40 ms of slack so tiny boundary errors don't count as wrong notes
  const reach = warped ? 2 : 0;
  const takeAt = (k) => {
    const j = map[k];
    let best = NaN,
      bd = Infinity;
    for (let q = j - reach; q <= j + reach; q++) {
      if (q < 0 || q >= b.length) continue;
      const v = b[q];
      if (v !== v) continue;
      const dd = Math.abs(fold(v - a[k] - shift));
      if (dd < bd) {
        bd = dd;
        best = v;
      }
    }
    return best;
  };
  // the part of the song you actually sang: from the note where you start to the note where you stop
  const sungAt = new Float32Array(a.length).fill(NaN);
  let firstK = -1,
    lastK = -1;
  for (let k = 0; k < a.length; k++) {
    if (a[k] !== a[k]) continue;
    const v = takeAt(k);
    sungAt[k] = v;
    if (v === v) {
      if (firstK < 0) firstK = k;
      lastK = k;
    }
  }
  let lo = 0,
    hi = a.length - 1;
  if (firstK >= 0) {
    const t0 = firstK * GRID,
      t1 = lastK * GRID;
    const n0 = o.notes.find((n) => t0 >= n.pos - 0.05 && t0 < n.end + 0.05),
      n1 = [...o.notes]
        .reverse()
        .find((n) => t1 >= n.pos - 0.05 && t1 < n.end + 0.05);
    lo = Math.max(0, Math.round((n0 ? Math.min(n0.pos, t0) : t0) / GRID));
    hi = Math.min(
      a.length - 1,
      Math.round((n1 ? Math.max(n1.end, t1) : t1) / GRID),
    );
  }
  const inRange = (k) => k >= lo && k <= hi;
  const rangeLo = lo * GRID,
    rangeHi = (hi + 1) * GRID;
  const d = new Float32Array(a.length).fill(NaN);
  let voiced = 0,
    both = 0,
    w50 = 0,
    w25 = 0,
    sum = 0,
    sumN = 0;
  for (let k = lo; k <= hi; k++) {
    if (a[k] !== a[k]) continue;
    voiced++;
    const v = sungAt[k];
    if (v !== v) continue;
    both++;
    const dd = fold(v - a[k] - shift);
    d[k] = dd;
    const c = Math.abs(dd) * 100;
    if (c <= 50) w50++;
    if (c <= 25) w25++;
    if (c <= 300) {
      sum += dd * 100;
      sumN++;
    }
  }
  // timing: how far the take drifts from the original's timing (warped mode)
  let dev = null,
    drift = null;
  if (warped) {
    const offs = [];
    for (let k = lo; k <= hi; k += 2)
      if (a[k] === a[k]) offs.push(map[k] - k);
    const base = offs.length ? median(offs) : 0;
    dev = new Float32Array(a.length);
    const absd = [];
    for (let k = 0; k < a.length; k++) {
      dev[k] = (map[k] - k - base) * GRID;
      if (a[k] === a[k] && inRange(k)) absd.push(Math.abs(dev[k]));
    }
    drift = absd.length ? Math.round(median(absd) * 1000) : 0;
  }
  const offSec = off * GRID;
  const timings = [];
  const rows = o.notes
    .filter((n) => n.end > rangeLo + 0.02 && n.pos < rangeHi - 0.02)
    .map((n) => {
      const k0 = Math.round(n.pos / GRID),
        k1 = Math.max(k0 + 1, Math.round(n.end / GRID));
      const vals = [];
      for (let k = k0; k < k1 && k < d.length; k++)
        if (d[k] === d[k]) vals.push(d[k]);
      let timing = null;
      if (dev) timing = dev[Math.min(dev.length - 1, k0)];
      else {
        t.notes.forEach((m) => {
          const dt = m.pos - offSec - n.pos;
          const same = octaveFree
            ? foldOct(m.midi - n.midi) === 0
            : m.midi === n.midi;
          if (
            same &&
            Math.abs(dt) < 0.6 &&
            (timing === null || Math.abs(dt) < Math.abs(timing))
          )
            timing = dt;
        });
        if (timing !== null) timings.push(timing);
      }
      if (vals.length < 0.3 * (k1 - k0)) return { n, missed: true, timing };
      const med = median(vals);
      const cents = Math.round(med * 100);
      const yours = Math.round(n.midi + med) + shift;
      let verdict, tone;
      if (Math.abs(cents) <= 25) {
        verdict = "On pitch";
        tone = "good";
      } else if (Math.abs(cents) <= 50) {
        verdict = cents > 0 ? "A bit sharp" : "A bit flat";
        tone = "warn";
      } else {
        const st = Math.round(med);
        verdict =
          "Off by " +
          Math.abs(st) +
          (Math.abs(st) === 1 ? " half step" : " half steps");
        tone = "bad";
      }
      return { n, cents, yours, verdict, tone, timing };
    });
  // phrases to practice: 3 s windows, step 1 s, flagged for pitch or timing
  const cand = [];
  for (let s = 0; s + 150 <= a.length; s += 50) {
    if (s + 150 <= lo || s > hi) continue;
    let v = 0,
      bad = 0,
      missing = 0,
      sc = 0,
      scN = 0,
      dv = 0;
    for (let k = s; k < s + 150; k++) {
      if (a[k] !== a[k] || !inRange(k)) continue;
      v++;
      if (dev) dv += dev[k];
      if (d[k] !== d[k]) {
        bad++;
        missing++;
        continue;
      }
      if (Math.abs(d[k]) > 0.5) bad++;
      if (Math.abs(d[k]) <= 3) {
        sc += d[k] * 100;
        scN++;
      }
    }
    if (v < 40) continue;
    const rate = bad / v,
      meanDev = dev ? dv / v : 0;
    const late = Math.abs(meanDev) >= 0.25;
    if (rate < 0.25 && !late) continue;
    const avg = scN ? sc / scN : 0;
    const parts = [];
    const kind =
      rate >= 0.25
        ? missing / v > 0.5
          ? "missing"
          : Math.abs(avg) >= 30
            ? "lean"
            : "wrong"
        : null;
    if (rate >= 0.25) {
      if (missing / v > 0.5)
        parts.push("Mostly missing here. You may be too quiet.");
      else if (Math.abs(avg) >= 30)
        parts.push(
          "Mostly " +
            (avg > 0 ? "sharp" : "flat") +
            " by about " +
            Math.round(Math.abs(avg)) +
            "¢.",
        );
      else parts.push("Several wrong notes in this phrase.");
    }
    if (late)
      parts.push(
        "You're about " +
          Math.abs(meanDev).toFixed(1) +
          " s " +
          (meanDev > 0 ? "behind" : "ahead") +
          " here.",
      );
    cand.push({
      start: s * GRID,
      end: (s + 150) * GRID,
      rate: Math.max(rate, late ? Math.min(0.9, Math.abs(meanDev)) : 0),
      why: parts.join(" "),
      kind,
      avg,
      late,
      meanDev,
    });
  }
  cand.sort((x, y) => y.rate - x.rate);
  const spots = [];
  cand.forEach((c) => {
    if (
      spots.length < 3 &&
      spots.every((s) => c.end <= s.start || c.start >= s.end)
    )
      spots.push(c);
  });
  spots.sort((x, y) => x.start - y.start);
  return {
    d,
    dev,
    drift,
    shift,
    keyShift: ks,
    octShift: shift - ks,
    rows,
    spots,
    map,
    range: {
      start: rangeLo,
      end: Math.min(rangeHi, a.length * GRID),
      whole: lo <= 5 && hi >= a.length - 6,
    },
    score: voiced ? Math.round((100 * w50) / voiced) : 0,
    inTune: both ? Math.round((100 * w25) / both) : 0,
    rightNote: both ? Math.round((100 * w50) / both) : 0,
    coverage: voiced ? Math.round((100 * both) / voiced) : 0,
    tendency: sumN ? Math.round(sum / sumN) : 0,
    timing: dev
      ? null
      : timings.length
        ? Math.round(median(timings) * 1000)
        : null,
  };
}

/* ---------- plain-language wording ---------- */

export function loadSessions() {
  try {
    const v = JSON.parse(localStorage.getItem(SESS_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

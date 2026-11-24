// Splitting a song into phrases, finding its key, and scoring a sung phrase.
import {
  warpMap,
  fixedMap,
  detectKeyAndOffset,
  GRID,
  foldOct,
} from "./analysis.js";
import { median, mean } from "./math.js";

// Breath and timing for one line: breaths taken where the song keeps going, a last note cut short,
// and rushing or dragging (notes drifting earlier or later through the line).
function breathTiming(ph, rows, her, map, len, speed) {
  const b = her.grid,
    L = her.loud,
    inB = (j) => j >= 0 && j < b.length;
  const vl = [];
  if (L) for (let j = 0; j < b.length; j++) if (b[j] === b[j]) vl.push(L[j]);
  const thr = vl.length ? median(vl) - 18 : -60;
  const quiet = (j) => inB(j) && b[j] !== b[j] && (!L || L[j] < thr);
  const kOf = (t) =>
    Math.max(0, Math.min(len - 1, Math.round((t - ph.start) / speed / GRID)));
  const breaths = [];
  for (let i = 0; i + 1 < rows.length; i++) {
    const n = rows[i].n,
      m = rows[i + 1].n;
    if (m.pos - n.end >= 0.15) continue; // the song has a gap here, so a breath is fine
    const reach = Math.min(15, Math.round((m.end - m.pos) / speed / GRID / 2));
    const j0 = map[Math.max(0, kOf(n.end) - 3)],
      j1 = map[Math.min(len - 1, kOf(m.pos) + Math.max(3, reach))];
    let run = 0,
      best = 0;
    for (let j = j0; j <= j1; j++) {
      if (quiet(j)) {
        run++;
        best = Math.max(best, run);
      } else run = 0;
    }
    if (best >= 8)
      breaths.push({ i, t: n.end, len: Math.round(best * GRID * 100) / 100 });
  }
  let cut = null;
  const lastI = rows.length - 1,
    last = rows[lastI];
  if (last && last.n.end - last.n.pos >= 0.35) {
    // follow your voice from where the last note starts until it stops (gaps of a few frames allowed)
    const k0 = kOf(last.n.pos),
      want = Math.round((last.n.end - last.n.pos) / speed / GRID);
    let jS = map[k0],
      jl = -1,
      gap = 0;
    for (let j = jS - 3; j <= jS + want + 10 && inB(j); j++) {
      if (b[j] === b[j]) {
        jl = j;
        gap = 0;
      } else if (jl >= 0 && ++gap > 4) break;
    }
    const short =
      jl < 0
        ? last.n.end - last.n.pos
        : Math.max(0, (jS + want - jl) * GRID * speed);
    if (short >= 0.25)
      cut = { i: lastI, s: Math.round(short * 10) / 10, t: last.n.end };
  }
  const dts = rows
    .slice(1)
    .filter((r) => !r.missed && r.ok && r.dt != null)
    .map((r) => r.dt); // a late first note is "came in late", not rushing
  let pace = "steady";
  if (dts.length >= 6) {
    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length,
      d = avg(dts.slice(-3)) - avg(dts.slice(0, 3));
    if (d <= -0.15) pace = "rushed";
    else if (d >= 0.15) pace = "dragged";
  }
  return { breaths, cut, pace };
}

export function scorePhrase(ph, her, speed, tr) {
  const len = Math.ceil((ph.end - ph.start) / speed / GRID) + 1;
  const grid = new Float32Array(len).fill(NaN),
    loud = new Float32Array(len).fill(-100);
  for (let k = 0; k < len; k++) {
    const st = ph.start + k * GRID * speed;
    const n = ph.notes.find((x) => st >= x.pos && st < x.end);
    if (n) {
      grid[k] = n.midi + tr;
      loud[k] = -10;
    }
  }
  const tgt = { grid, loud, notes: [], duration: len * GRID };
  let kd = detectKeyAndOffset(tgt, her, true);
  // a one-key difference is more likely singing flat or sharp than a new key
  if (Math.abs(kd.ks) === 1) kd = detectKeyAndOffset(tgt, her, false);
  let map = len >= 60 ? warpMap(tgt, her, kd.off, kd.ks) : null;
  if (!map) map = fixedMap(len, kd.off);
  const b = her.grid;
  const rows = ph.notes.map((n) => {
    const k0 = Math.round((n.pos - ph.start) / speed / GRID),
      k1 = Math.max(k0 + 1, Math.round((n.end - ph.start) / speed / GRID));
    const cut = Math.floor((k1 - k0) * 0.2),
      i0 = k0 + cut,
      i1 = Math.max(i0 + 1, k1 - cut);
    const ds = [],
      raw = [],
      lv = [];
    for (let k = i0; k < i1 && k < len; k++) {
      const j = map[k];
      let best = NaN,
        bd = Infinity;
      for (let q = j - 2; q <= j + 2; q++) {
        if (q < 0 || q >= b.length || b[q] !== b[q]) continue;
        const d = foldOct(b[q] - (n.midi + tr) - kd.ks);
        if (Math.abs(d) < bd) {
          bd = Math.abs(d);
          best = q;
        }
      }
      if (best === best) {
        ds.push(foldOct(b[best] - (n.midi + tr) - kd.ks));
        raw.push(b[best]);
        lv.push(her.loud ? her.loud[best] : 0);
      }
    }
    // timing: how far this note's start sits from the line's own average timing (+ late, - early)
    let dt =
      len >= 60 && k0 < len
        ? Math.round((map[k0] - k0 - kd.off) * GRID * speed * 100) / 100
        : 0;
    if (Math.abs(dt) > 0.6) dt = null; // not a believable timing difference: probably matched the wrong spot
    if (ds.length < Math.max(1, 0.3 * (i1 - i0)))
      return { n, missed: true, ok: false, dt };
    // loud/soft drift on long notes: did the pitch sink as you got softer, or rise as you pushed?
    let dr = null;
    if (n.end - n.pos >= 0.5 && ds.length >= 12 && her.loud) {
      const t3 = Math.floor(ds.length / 3),
        avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
      const dL = avg(lv.slice(-t3)) - avg(lv.slice(0, t3)),
        dP = (avg(ds.slice(-t3)) - avg(ds.slice(0, t3))) * 100;
      if (dL <= -6 && dP <= -30)
        dr = { dir: "flat", with: "softer", c: Math.round(dP) };
      else if (dL >= 6 && dP >= 30)
        dr = { dir: "sharp", with: "louder", c: Math.round(dP) };
    }
    const cents = Math.round(median(ds) * 100);
    // did you slide up into it? look at the first moments of the note
    const head = [];
    for (let k = k0; k < Math.min(k0 + 6, len); k++) {
      const j = map[k];
      let bd = Infinity,
        v = NaN;
      for (let q = j - 2; q <= j + 2; q++) {
        if (q < 0 || q >= b.length || b[q] !== b[q]) continue;
        const d = foldOct(b[q] - (n.midi + tr) - kd.ks);
        if (Math.abs(d) < bd) {
          bd = Math.abs(d);
          v = d;
        }
      }
      if (v === v) head.push(v);
    }
    const sc = head.length >= 2 && head[0] <= -0.6 && median(ds) > -0.4;
    let sd = null;
    if (k1 - k0 >= 25 && ds.length > 8) {
      const mu = ds.reduce((a, x) => a + x, 0) / ds.length;
      sd = Math.round(
        Math.sqrt(ds.reduce((a, x) => a + (x - mu) * (x - mu), 0) / ds.length) *
          100,
      );
    }
    return {
      n,
      missed: false,
      cents,
      ok: Math.abs(cents) <= 50,
      sung: Math.round(median(raw)),
      sc,
      sd,
      dt,
      dr,
    };
  });
  // your pitch over the phrase, in the song's key, for drawing
  const trace = [];
  for (let k = 0; k < len; k += 2) {
    if (grid[k] !== grid[k]) {
      trace.push(null);
      continue;
    }
    const j = map[k];
    let bd = Infinity,
      v = NaN;
    for (let q = j - 2; q <= j + 2; q++) {
      if (q < 0 || q >= b.length || b[q] !== b[q]) continue;
      const d = foldOct(b[q] - grid[k] - kd.ks);
      if (Math.abs(d) < bd) {
        bd = Math.abs(d);
        v = d;
      }
    }
    trace.push(v === v ? Math.round((grid[k] - tr + v) * 100) / 100 : null);
  }
  const sung = rows.filter((r) => !r.missed && Math.abs(r.cents) <= 150);
  return {
    rows,
    right: rows.filter((r) => r.ok).length,
    score: Math.round((100 * rows.filter((r) => r.ok).length) / rows.length),
    lean: sung.length ? Math.round(mean(sung.map((r) => r.cents))) : 0,
    keyShift: kd.ks,
    trace,
    off: kd.off,
    bt: breathTiming(ph, rows, her, map, len, speed),
  };
}

/* ---------- learn mode ---------- */

export const KEY_MAJ = [
  "C",
  "D♭",
  "D",
  "E♭",
  "E",
  "F",
  "F♯",
  "G",
  "A♭",
  "A",
  "B♭",
  "B",
];

export const KEY_MIN = [
  "C",
  "C♯",
  "D",
  "E♭",
  "E",
  "F",
  "F♯",
  "G",
  "G♯",
  "A",
  "B♭",
  "B",
];

export const SOLFEGE = [
  "Do",
  "Di",
  "Re",
  "Ri",
  "Mi",
  "Fa",
  "Fi",
  "Sol",
  "Si",
  "La",
  "Li",
  "Ti",
];

const PROF_MAJ = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];

const PROF_MIN = [
  6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

// likely key from note durations (Krumhansl–Schmuckler profiles)
export function estimateKey(notes) {
  const h = new Array(12).fill(0);
  notes.forEach((n) => {
    h[((n.midi % 12) + 12) % 12] += n.end - n.pos;
  });
  const corr = (prof, r) => {
    const xs = h,
      ys = prof.map((_, i) => prof[(i - r + 12) % 12]);
    const mx = mean(xs),
      my = mean(ys);
    let a = 0,
      b = 0,
      c = 0;
    for (let i = 0; i < 12; i++) {
      a += (xs[i] - mx) * (ys[i] - my);
      b += (xs[i] - mx) ** 2;
      c += (ys[i] - my) ** 2;
    }
    return b && c ? a / Math.sqrt(b * c) : 0;
  };
  let best = { r: 0, minor: false, c: -2 };
  for (let r = 0; r < 12; r++) {
    const cM = corr(PROF_MAJ, r),
      cm = corr(PROF_MIN, r);
    if (cM > best.c) best = { r, minor: false, c: cM };
    if (cm > best.c) best = { r, minor: true, c: cm };
  }
  return {
    tonic: best.r,
    minor: best.minor,
    conf: best.c,
    doPc: (best.r + (best.minor ? 3 : 0)) % 12,
  };
}

export const keyName = (k, tr) => {
  const pc = (((k.tonic + tr) % 12) + 12) % 12;
  return (
    (k.minor ? KEY_MIN[pc] : KEY_MAJ[pc]) + (k.minor ? " minor" : " major")
  );
};

// With timed lyrics, each lyric line is one phrase, its edges moved to where the singing really
// starts and stops. Without lyrics, phrases are cut where the melody pauses.
function lyricGroups(notes, spans, grid) {
  const lines = spans.filter((l) => l.text);
  if (!lines.length) return null;
  const voiced = (t) => {
    if (!grid) return false;
    const k = Math.round(t / GRID);
    return k >= 0 && k < grid.length && grid[k] === grid[k];
  };
  const out = [];
  lines.forEach((l, i) => {
    const g = notes.filter(
      (n) => n.pos >= l.start - 0.08 && n.pos < l.end - 0.02,
    );
    if (!g.length) return;
    const next = lines[i + 1] ? lines[i + 1].start : Infinity,
      prevEnd = out.length ? out[out.length - 1].end : 0;
    let a = g[0].pos,
      b = g[g.length - 1].end;
    while (a - GRID > Math.max(prevEnd, l.start - 0.3) && voiced(a - GRID))
      a -= GRID;
    while (b + GRID < next - 0.05 && voiced(b)) b += GRID;
    out.push({ g, start: a, end: b });
  });
  return out.length ? out : null;
}

export function buildPhrases(notes, spans, grid) {
  if (!notes.length) return [];
  const lg = spans && spans.length ? lyricGroups(notes, spans, grid) : null;
  if (lg) return phraseTags(notes, lg);
  const groups = [[notes[0]]];
  for (let i = 1; i < notes.length; i++) {
    if (notes[i].pos - notes[i - 1].end > 0.35) groups.push([notes[i]]);
    else groups[groups.length - 1].push(notes[i]);
  }
  const merged = [];
  groups.forEach((g) => {
    const len = g[g.length - 1].end - g[0].pos;
    const prev = merged[merged.length - 1];
    if (
      prev &&
      (g.length < 2 || len < 0.8) &&
      g[0].pos - prev[prev.length - 1].end < 1.2
    )
      prev.push(...g);
    else merged.push(g.slice());
  });
  const out = [];
  const split = (g) => {
    const len = g[g.length - 1].end - g[0].pos;
    if (len <= 12 || g.length < 4) {
      out.push(g);
      return;
    }
    let bi = 1,
      bg = -1;
    for (let i = 1; i < g.length; i++) {
      const gap = g[i].pos - g[i - 1].end;
      if (gap > bg) {
        bg = gap;
        bi = i;
      }
    }
    split(g.slice(0, bi));
    split(g.slice(bi));
  };
  merged.forEach(split);
  return phraseTags(
    notes,
    out.map((g) => ({ g, start: g[0].pos, end: g[g.length - 1].end })),
  );
}

function phraseTags(notes, groups) {
  let hi = -Infinity,
    lo = Infinity;
  notes.forEach((n) => {
    hi = Math.max(hi, n.midi);
    lo = Math.min(lo, n.midi);
  });
  const wide = hi - lo >= 7;
  return groups.map(({ g, start, end }, i) => {
    const tags = [];
    let jump = 0;
    for (let j = 1; j < g.length; j++)
      if (g[j].pos - g[j - 1].end < 0.35)
        jump = Math.max(jump, Math.abs(g[j].midi - g[j - 1].midi));
    if (jump >= 5) tags.push("Big jump");
    let fast = false;
    for (let j = 0; j < g.length && !fast; j++) {
      let c = 0;
      for (let q = j; q < g.length && g[q].pos < g[j].pos + 1; q++) c++;
      if (c >= 5) fast = true;
    }
    if (fast) tags.push("Fast run");
    if (wide && g.some((n) => n.midi >= hi - 1)) tags.push("High note");
    if (wide && g.some((n) => n.midi <= lo + 1)) tags.push("Low note");
    if (g.some((n) => n.end - n.pos >= 1.5)) tags.push("Long hold");
    return { i, start, end, notes: g, tags };
  });
}

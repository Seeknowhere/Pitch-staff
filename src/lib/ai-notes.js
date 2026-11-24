// High-accuracy note detection with Spotify Basic Pitch (runs on the device).
import { GRID } from "./analysis.js";
import { median } from "./math.js";
import { estimateKey } from "./phrases.js";
import { loadJSON, saveJSON } from "./storage.js";

const AI_KEY = "pitchstaff.ainotes.v4";

const AI_FPS = 22050 / 256;

let bpModule = null;

const loadBasicPitch = () =>
  (bpModule =
    bpModule ||
    import(
      /* @vite-ignore */ new URL("tono-basic-pitch.js", document.baseURI).href
    ));

export function aiCacheGet(name, dur) {
  const all = loadJSON(AI_KEY, {}),
    e = all[name];
  if (!e || Math.abs(e.d - dur) > 0.5) return null;
  return e.n.map(([midi, pos, end, c]) => ({
    midi,
    pos,
    end,
    cut: ["silence", "dip", "pitch"][c] || "pitch",
  }));
}

export function aiCachePut(name, dur, notes) {
  const all = loadJSON(AI_KEY, {});
  all[name] = {
    d: Math.round(dur * 10) / 10,
    at: Date.now(),
    n: notes.map((n) => [
      n.midi,
      Math.round(n.pos * 1000) / 1000,
      Math.round(n.end * 1000) / 1000,
      { silence: 0, dip: 1, pitch: 2 }[n.cut] ?? 2,
    ]),
  };
  const keys = Object.keys(all).sort(
    (a, b) => (all[b].at || 0) - (all[a].at || 0),
  );
  keys.slice(15).forEach((k) => delete all[k]);
  saveJSON(AI_KEY, all);
}

// Basic Pitch finds where notes start (even repeated ones); our own pitch track gives the exact pitch
function aiToMelody(evs, onsets, grid) {
  const out = [];
  const ns = evs
    .map((e) => ({
      s: e.startTimeSeconds,
      e: e.startTimeSeconds + e.durationSeconds,
      p: e.pitchMidi,
      a: e.amplitude,
    }))
    .filter((n) => n.e - n.s >= 0.06 && n.p >= 36 && n.p <= 92)
    .sort((x, y) => x.s - y.s || y.a - x.a);
  ns.forEach((n) => {
    // pitch from our tracker over the middle of the note; skip notes with no sung pitch (breaths, noise)
    const k0 = Math.round((n.s + (n.e - n.s) * 0.15) / GRID),
      k1 = Math.max(k0 + 1, Math.round((n.e - (n.e - n.s) * 0.15) / GRID));
    const vals = [];
    for (let k = k0; k < k1 && k < grid.length; k++)
      if (grid[k] === grid[k]) vals.push(grid[k]);
    if (vals.length < Math.max(2, 0.35 * (k1 - k0))) return;
    const midi = Math.round(median(vals));
    const f = Math.min(
      onsets.length - 1,
      Math.max(0, Math.round(n.s * AI_FPS)),
    );
    let on = 0;
    for (
      let q = Math.max(0, f - 2);
      q <= Math.min(onsets.length - 1, f + 2);
      q++
    ) {
      const row = onsets[q];
      for (let b = n.p - 22; b <= n.p - 20; b++)
        if (row && row[b] > on) on = row[b];
    }
    const last = out[out.length - 1];
    if (last && n.s < last.end - 0.03) {
      if (n.e <= last.end + 0.02) return; // a ghost note inside the current one
      if (n.s - last.pos < 0.08) return; // two guesses for the same moment: keep the first
      last.end = n.s; // a new note starts: cut the previous one here
    }
    const prevEnd = last ? last.end : -1;
    const cut = n.s - prevEnd > 0.12 ? "silence" : on >= 0.5 ? "dip" : "pitch";
    if (
      last &&
      cut === "pitch" &&
      last.midi === midi &&
      n.s - last.end < 0.04
    ) {
      last.end = n.e;
      return;
    }
    out.push({ midi, pos: n.s, end: n.e, cut });
  });
  return out.filter((n) => n.end - n.pos >= 0.06);
}

// keep our notes; split them only where the AI hears a new attack on that pitch AND there's a consonant dip
function aiRefine(notes, onsets, grid, loud) {
  const THR = 0.5,
    MIN = 0.1,
    DIP = 4.5,
    out = [];
  const onCol = (f, midi) => {
    const r = onsets[f];
    if (!r) return 0;
    let v = 0;
    for (let b = midi - 22; b <= midi - 20; b++) if (r[b] > v) v = r[b];
    return v;
  };
  const dipAt = (t) => {
    const k = Math.round(t / GRID);
    let lo = Infinity,
      unv = false,
      hiB = -Infinity,
      hiA = -Infinity;
    for (let q = k - 3; q <= k + 2; q++) {
      if (q < 0 || q >= loud.length) continue;
      lo = Math.min(lo, loud[q]);
      if (grid[q] !== grid[q]) unv = true;
    }
    for (let q = k - 10; q < k - 2; q++)
      if (q >= 0) hiB = Math.max(hiB, loud[q]);
    for (let q = k + 2; q < k + 10; q++)
      if (q < loud.length) hiA = Math.max(hiA, loud[q]);
    return unv || Math.min(hiB, hiA) - lo >= DIP;
  };
  notes.forEach((n) => {
    const cuts = [];
    for (
      let f = Math.ceil((n.pos + MIN) * AI_FPS);
      f <= Math.floor((n.end - MIN) * AI_FPS);
      f++
    ) {
      const v = onCol(f, n.midi);
      if (
        v >= THR &&
        v >= onCol(f - 1, n.midi) &&
        v >= onCol(f + 1, n.midi) &&
        dipAt(f / AI_FPS)
      ) {
        const t = f / AI_FPS,
          last = cuts.length ? cuts[cuts.length - 1] : n.pos;
        if (t - last >= MIN && n.end - t >= MIN) cuts.push(t);
      }
    }
    let st = n.pos;
    cuts.forEach((t, i) => {
      out.push({ ...n, pos: st, end: t, cut: i === 0 ? n.cut : "dip" });
      st = t;
    });
    out.push({ ...n, pos: st, end: n.end, cut: cuts.length ? "dip" : n.cut });
  });
  return out;
}

export async function aiNotes(buffer, data, onProgress) {
  const m = await loadBasicPitch();
  try {
    await m.tf.setBackend("webgl");
  } catch (e) {}
  await m.tf.ready();
  const sr = 22050,
    len = Math.ceil(buffer.duration * sr);
  const Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const off = new Off(1, len, sr),
    src = off.createBufferSource();
  src.buffer = buffer;
  src.connect(off.destination);
  src.start();
  const rendered = await new Promise((res, rej) => {
    off.oncomplete = (e) => res(e.renderedBuffer);
    const pr = off.startRendering();
    if (pr && pr.then) pr.then(res, rej);
  });
  const bp = new m.BasicPitch(
    new URL("bp-model/model.json", document.baseURI).href,
  );
  const onsets = [];
  await bp.evaluateModel(
    rendered.getChannelData(0),
    (f, o) => {
      onsets.push(...o);
    },
    (p) => onProgress && onProgress(p),
  );
  return aiRefine(data.notes, onsets, data.grid, data.loud);
}

/* ---------- snap notes to the song's key ---------- */

// A sung note sitting between two piano keys can round to the out-of-key one. If the song's key is clear,
// move such borderline notes to the nearest in-key note (like UltraSinger does), and rejoin slides that split.
export function snapToKey(notes, grid) {
  if (!notes || notes.length < 8) return notes;
  const key = estimateKey(notes);
  if (!(key.conf >= 0.9)) return notes; // only when the key is really clear: a wrong key would move good notes
  const scale = (
    key.minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11]
  ).map((x) => (x + key.tonic) % 12);
  const inKey = (m) => scale.includes(((m % 12) + 12) % 12);
  const out = [];
  notes.forEach((n) => {
    let m = n.midi;
    if (!inKey(m)) {
      const k0 = Math.round((n.pos + (n.end - n.pos) * 0.15) / GRID),
        k1 = Math.max(
          k0 + 1,
          Math.round((n.end - (n.end - n.pos) * 0.15) / GRID),
        );
      const vals = [];
      for (let k = k0; k < k1 && k < grid.length; k++)
        if (grid[k] === grid[k]) vals.push(grid[k]);
      if (vals.length >= 3) {
        const v = median(vals);
        const cand = [m + 1, m - 1]
          .filter(inKey)
          .sort((a, b) => Math.abs(v - a) - Math.abs(v - b))[0];
        if (cand != null && Math.abs(v - cand) <= 0.65) m = cand;
      }
    }
    const last = out[out.length - 1];
    if (
      last &&
      m === last.midi &&
      n.cut === "pitch" &&
      n.pos - last.end < 0.03
    ) {
      last.end = n.end;
      return;
    }
    out.push(m === n.midi ? n : { ...n, midi: m, snapped: true });
  });
  return out;
}

/* ---------- UltraStar karaoke files (.txt) ---------- */

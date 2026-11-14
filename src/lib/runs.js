// Saved whole-song runs (Analyze tab) and the history charts helpers.
import { GRID } from "./analysis.js";
import { scorePhrase } from "./phrases.js";
import { loadJSON, saveJSON } from "./storage.js";

const RUNS_KEY = "pitchstaff.runs.v1",
  LASTRUN_KEY = "pitchstaff.lastrun.v1";

export const loadRuns = (song) => (song ? loadJSON(RUNS_KEY, {})[song] || [] : []);

export function addRun(song, run) {
  if (!song) return [];
  const all = loadJSON(RUNS_KEY, {}),
    list = [...(all[song] || []), run].slice(-40);
  all[song] = list;
  saveJSON(RUNS_KEY, all);
  return list;
}

export const loadLastRun = (song) =>
  song ? loadJSON(LASTRUN_KEY, {})[song] || null : null;

export function saveLastRun(song, run) {
  if (!song) return;
  const all = loadJSON(LASTRUN_KEY, {});
  all[song] = run;
  const keys = Object.keys(all);
  if (keys.length > 8)
    keys
      .sort((a, b) => (all[a].at || 0) - (all[b].at || 0))
      .slice(0, keys.length - 8)
      .forEach((k) => delete all[k]);
  saveJSON(LASTRUN_KEY, all);
}

// Cut the take around each lyric line (using the whole-song alignment) and score it with the same
// scorer Repeat after me uses, so numbers and charts match Practice.
export function analyzeRun(od, phrases, td, map) {
  const lines = phrases.map((ph) => {
    const k0 = Math.max(0, Math.round(ph.start / GRID)),
      k1 = Math.min(map.length - 1, Math.round(ph.end / GRID));
    const j0 = map[k0],
      j1 = map[k1];
    if (!(j0 >= 0) || !(j1 > j0) || j0 >= td.grid.length) return null;
    let v = 0;
    for (let j = j0; j < Math.min(j1, td.grid.length); j++)
      if (td.grid[j] === td.grid[j]) v++;
    if (v < 0.15 * (j1 - j0)) return null; // this line wasn't sung
    const a = Math.max(0, j0 - 30),
      b = Math.min(td.grid.length, j1 + 30);
    const her = {
      grid: td.grid.slice(a, b),
      loud: td.loud ? td.loud.slice(a, b) : new Float32Array(b - a).fill(-20),
      notes: td.notes
        .filter((n) => n.pos >= a * GRID && n.end <= b * GRID)
        .map((n) => ({ ...n, pos: n.pos - a * GRID, end: n.end - a * GRID })),
      duration: (b - a) * GRID,
    };
    const res = scorePhrase(ph, her, 1, 0);
    // came in early or late: where your voice actually starts near the line's first note (doesn't depend on pitch)
    let late = null;
    {
      const je = map[Math.max(0, Math.round(ph.notes[0].pos / GRID))];
      // the voice onset (sound after a short silence) closest to where the line should start
      let bestJ = -1;
      for (
        let j = Math.max(4, je - 30);
        j <= je + 30 && j < td.grid.length;
        j++
      ) {
        if (td.grid[j] !== td.grid[j]) continue;
        let quietBefore = true;
        for (let q = j - 4; q < j; q++)
          if (td.grid[q] === td.grid[q]) quietBefore = false;
        if (
          quietBefore &&
          (bestJ < 0 || Math.abs(j - je) < Math.abs(bestJ - je))
        )
          bestJ = j;
      }
      if (bestJ >= 0) late = Math.round((bestJ - je) * GRID * 100) / 100;
    }
    return {
      late,
      score: res.score,
      speed: 1,
      start: ph.start,
      trace: res.trace,
      clip: [Math.max(0, j0 * GRID - 0.3), j1 * GRID + 0.4],
      rows: res.rows.map((r) => ({
        p: Math.round(r.n.pos * 1000) / 1000,
        m: r.n.midi,
        c: r.missed ? null : r.cents,
        sc: !!r.sc,
        sd: r.sd == null ? null : r.sd,
        dt: r.dt,
        dr: r.dr || null,
      })),
      bt: res.bt,
    };
  });
  const sung = lines.filter(Boolean),
    tot = sung.reduce((s, r) => s + r.rows.length, 0);
  return {
    lines,
    score: tot
      ? Math.round(
          sung.reduce((s, r) => s + r.score * r.rows.length, 0) / tot,
        )
      : 0,
  };
}

// every score a line has had: whole-song runs and Repeat-after-me tries, oldest first
export function lineHistory(i, runs, tries) {
  const pts = [];
  runs.forEach((r) => {
    const s = r.lines && r.lines[i];
    if (s != null) pts.push({ at: r.at, s, kind: "run" });
  });
  const t = tries && tries[i];
  if (t) {
    if (t.hist && t.hist.length)
      t.hist.forEach((h) => pts.push({ at: h.at, s: h.s, kind: "try" }));
    else if (t.last)
      pts.push({ at: t.last.at || 0, s: t.last.score, kind: "try" });
  }
  return pts.sort((a, b) => a.at - b.at);
}

export const scoreTone = (s) => (s >= 80 ? "good" : s >= 55 ? "warn" : "bad");

export const dayLabel = (at) => {
  const d = new Date(at),
    t = new Date();
  return d.toDateString() === t.toDateString()
    ? "today"
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

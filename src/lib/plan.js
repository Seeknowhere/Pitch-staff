import { median } from "./math.js";
import { fmt, pretty, midiInfo } from "./music.js";
import { loadJSON, saveJSON } from "./storage.js";

const PLAN_KEY = "pitchstaff.plan.v1";

export const loadPlan = (song) =>
  song ? loadJSON(PLAN_KEY, {})[song] || null : null;

export const savePlan = (song, plan) => {
  if (!song) return;
  const all = loadJSON(PLAN_KEY, {});
  if (plan) all[song] = plan;
  else delete all[song];
  saveJSON(PLAN_KEY, all);
};

const rowRight = (r) => !r.missed && Math.abs(r.cents) <= 50;

export function makePlan(rows, notes, spans, phrases, source) {
  rows = (rows || []).filter((r) => r && r.n);
  if (rows.length < 3 || !notes.length) return null;
  rows = [...rows].sort((a, b) => a.n.pos - b.n.pos);
  const lines = spans.length
    ? spans
    : phrases.map((p) => ({ start: p.start, end: p.end, text: "" }));
  const lineOf = (t) => {
    const i = lines.findIndex((l) => t >= l.start - 0.05 && t < l.end);
    return i >= 0 ? i : null;
  };
  const lineRows = (li) =>
    rows.filter(
      (r) => r.n.pos >= lines[li].start - 0.05 && r.n.pos < lines[li].end,
    );
  const lineScore = (li) => {
    const rs = lineRows(li);
    return rs.length
      ? Math.round((100 * rs.filter(rowRight).length) / rs.length)
      : null;
  };
  const label = (li) =>
    li == null
      ? ""
      : lines[li].text
        ? "“" + lines[li].text + "”"
        : "the phrase at " + fmt(lines[li].start);
  const name = (m) => pretty(midiInfo(m).label);
  let hi = 0;
  notes.forEach((n) => {
    hi = Math.max(hi, n.midi);
  });
  const drills = [];
  // 1. high notes off pitch
  const highBad = rows.filter(
    (r) => !r.missed && r.n.midi >= hi - 3 && Math.abs(r.cents) > 35,
  );
  if (highBad.length >= 2) {
    const cnt = {};
    highBad.forEach((r) => {
      cnt[r.n.midi] = (cnt[r.n.midi] || 0) + 1;
    });
    const targets = Object.keys(cnt)
      .map(Number)
      .sort((a, b) => cnt[b] - cnt[a])
      .slice(0, 2)
      .sort((a, b) => b - a);
    const lean = median(highBad.map((r) => r.cents)),
      li = lineOf(highBad[0].n.pos);
    drills.push({
      id: "high",
      kind: "slide",
      title: "Land the high notes",
      why: "Slide into " + targets.map(name).join(" and ") + ", then hold",
      detail:
        "Your high notes" +
        (li != null ? " in " + label(li) : "") +
        " came out " +
        (lean < 0 ? "flat (a bit low)" : "sharp (a bit high)") +
        ".",
      tip:
        lean < 0
          ? "Aim a touch higher and keep the breath flowing as you go up."
          : "Relax and aim a touch lower. Don't push.",
      line: li,
      spec: {
        type: "hold",
        targets,
        hold: 1,
        tol: 30,
        tries: Math.max(3, targets.length * 2),
        verb: "Slide up to",
      },
    });
  }
  // 2. a jump you keep missing
  const jumps = {};
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1],
      b = rows[i];
    if (b.n.pos - a.n.end > 0.4 || Math.abs(b.n.midi - a.n.midi) < 5)
      continue;
    const key = a.n.midi + ">" + b.n.midi;
    const j = (jumps[key] = jumps[key] || {
      a: a.n.midi,
      b: b.n.midi,
      miss: 0,
      all: 0,
      pos: b.n.pos,
      cents: [],
    });
    j.all++;
    if (!rowRight(b)) {
      j.miss++;
      if (!b.missed) j.cents.push(b.cents);
    }
  }
  const jb = Object.values(jumps)
    .filter((j) => j.miss >= 1 && j.miss / j.all >= 0.5)
    .sort(
      (x, y) => y.miss - x.miss || Math.abs(y.b - y.a) - Math.abs(x.b - x.a),
    )[0];
  if (jb) {
    const li = lineOf(jb.pos),
      c = jb.cents.length ? median(jb.cents) : 0;
    drills.push({
      id: "jump",
      kind: "jump",
      title: "The big jump",
      why: name(jb.a) + " → " + name(jb.b) + ", slow then up to speed",
      detail:
        (li != null ? "In " + label(li) + " you " : "You ") +
        (jb.cents.length
          ? "landed " + (c < 0 ? "flat" : "sharp") + " on " + name(jb.b)
          : "missed " + name(jb.b)) +
        " (" +
        jb.miss +
        " of " +
        jb.all +
        " times).",
      tip:
        c < 0
          ? "Hear the top note in your head before you jump, and keep it light."
          : "Keep the top note relaxed instead of reaching for it.",
      line: li,
      spec: {
        type: "pattern",
        fixed: [jb.a, jb.b, jb.a, jb.b],
        rounds: 3,
        steps: [800, 600, 450],
        stages: ["Slow", "Medium", "Song speed"],
        tol: 0.5,
      },
    });
  }
  // 3. a long note that drifted
  const longs = rows
    .filter(
      (r) => !r.missed && r.n.end - r.n.pos >= 1 && Math.abs(r.cents) > 25,
    )
    .sort((a, b) => b.n.end - b.n.pos - (a.n.end - a.n.pos));
  if (longs.length) {
    const r = longs[0],
      secs = Math.round(Math.min(4, Math.max(2, r.n.end - r.n.pos))),
      li = lineOf(r.n.pos);
    drills.push({
      id: "long",
      kind: "hold",
      title: "Steady long notes",
      why: "Hold " + name(r.n.midi) + " for " + secs + " s, like in the song",
      detail:
        "The long " +
        name(r.n.midi) +
        (li != null ? " in " + label(li) : "") +
        " drifted " +
        (r.cents < 0 ? "flat" : "sharp") +
        ".",
      tip: "Take a full breath first and keep the same vowel the whole way.",
      line: li,
      spec: {
        type: "hold",
        targets: [r.n.midi],
        hold: secs,
        tol: 25,
        tries: 3,
        verb: "Hold",
      },
    });
  }
  // 4. phrase endings going flat
  if (drills.length < 3) {
    const ends = [];
    lines.forEach((l, li) => {
      const rs = lineRows(li);
      if (rs.length >= 3) {
        const last = rs[rs.length - 1];
        if (!last.missed && last.cents < -25) ends.push({ li, rs });
      }
    });
    if (ends.length >= 2) {
      const e = ends[0],
        tail = e.rs.slice(-3).map((r) => r.n.midi);
      drills.push({
        id: "end",
        kind: "end",
        title: "Finish the line in tune",
        why: "Sing the line endings, landing the last note",
        detail:
          "The last notes of " +
          ends.length +
          " lines went flat, usually when the breath runs low.",
        tip: "Keep the air going right to the end of the line, and think up on the last note.",
        line: e.li,
        spec: {
          type: "pattern",
          fixed: tail,
          rounds: 2,
          steps: [700, 520],
          stages: ["Slow", "Song speed"],
          tol: 0.5,
        },
      });
    }
  }
  // 5. polish your weakest line
  if (drills.length < 3) {
    const used = new Set(drills.map((d) => d.line));
    const cand = lines
      .map((l, li) => ({ li, n: lineRows(li).length, s: lineScore(li) }))
      .filter((x) => x.n >= 3 && x.s != null && x.s < 90 && !used.has(x.li))
      .sort((a, b) => a.s - b.s)[0];
    if (cand) {
      const ln = notes
        .filter(
          (n) =>
            n.pos >= lines[cand.li].start - 0.05 &&
            n.pos < lines[cand.li].end,
        )
        .slice(0, 6)
        .map((n) => n.midi);
      if (ln.length >= 3)
        drills.push({
          id: "polish",
          kind: "line",
          title: "Polish your weakest line",
          why:
            "The first notes of " +
            (lines[cand.li].text
              ? "“" + lines[cand.li].text + "”"
              : "phrase " + (cand.li + 1)),
          detail: "This line scored " + cand.s + "%, your lowest.",
          tip: "Sing it slowly first, then at the song's speed.",
          line: cand.li,
          spec: {
            type: "pattern",
            fixed: ln,
            rounds: 2,
            steps: [700, 520],
            stages: ["Slow", "Song speed"],
            tol: 0.5,
          },
        });
    }
  }
  const ds = drills.slice(0, 3);
  if (!ds.length) return null;
  const checks = [...new Set(ds.map((d) => d.line).filter((x) => x != null))]
    .slice(0, 3)
    .map((li) => ({
      li,
      start: lines[li].start,
      end: lines[li].end,
      text: lines[li].text,
      before: lineScore(li),
      notes: notes
        .filter(
          (n) => n.pos >= lines[li].start - 0.05 && n.pos < lines[li].end,
        )
        .slice(0, 12)
        .map((n) => n.midi),
    }))
    .filter((c) => c.notes.length >= 2 && c.before != null);
  return {
    at: Date.now(),
    source,
    drills: ds,
    done: {},
    checks,
    after: null,
    fresh: true,
  };
}

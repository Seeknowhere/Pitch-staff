// Vocal technique checks: scoops, held notes, steadiness.
import { invTime, GRID } from "./analysis.js";
import { median, mean } from "./math.js";
import { howMuch } from "./wording.js";

// bridge dropouts of up to 3 frames inside a sung note
function fillGaps(g) {
  const f = Float32Array.from(g);
  let k = 0;
  while (k < f.length) {
    if (f[k] === f[k]) {
      k++;
      continue;
    }
    let e = k;
    while (e < f.length && f[e] !== f[e]) e++;
    if (k > 0 && e < f.length && e - k <= 3) {
      const a = f[k - 1],
        b = f[e];
      for (let q = k; q < e; q++)
        f[q] = a + ((b - a) * (q - k + 1)) / (e - k + 1);
    }
    k = e;
  }
  return f;
}

// sliding up into notes that start after a breath
function scoopStats(tr) {
  const g = fillGaps(tr.grid);
  let n = 0,
    sc = 0,
    depthSum = 0;
  const ex = [];
  tr.notes.forEach((note) => {
    const k = Math.round(note.pos / GRID),
      k1 = Math.round(note.end / GRID);
    let s = k;
    while (s > 0 && k - s < 15 && g[s - 1] === g[s - 1]) s--;
    if (s > 0 && g[s - 1] === g[s - 1]) return; // joined from a previous note: legato, not a scoop
    const mid = [];
    for (let q = k + 8; q < k1 - 2; q++) if (g[q] === g[q]) mid.push(g[q]);
    if (mid.length < 5) return;
    const first = [g[s], g[s + 1], g[s + 2]].filter((v) => v === v);
    if (!first.length) return;
    const depth = median(mid) - median(first);
    n++;
    if (depth >= 0.6 && depth < 4) {
      sc++;
      depthSum += depth;
      ex.push(note.pos);
    }
  });
  return {
    count: n,
    scoops: sc,
    rate: n ? sc / n : 0,
    depth: sc ? Math.round((depthSum / sc) * 100) : 0,
    examples: ex,
  };
}

// vibrato, steadiness and drift on held notes
function holdStats(tr) {
  const g = fillGaps(tr.grid);
  const out = [];
  tr.notes.forEach((note) => {
    const k0 = Math.round(note.pos / GRID) + 8,
      k1 = Math.round(note.end / GRID) - 3;
    if (k1 - k0 < 22) return;
    const seg = [];
    for (let q = k0; q < k1; q++) {
      if (g[q] !== g[q]) return;
      seg.push(g[q]);
    }
    const N = seg.length,
      mx = (N - 1) / 2,
      my = mean(seg);
    let cov = 0,
      vx = 0;
    for (let i = 0; i < N; i++) {
      cov += (i - mx) * (seg[i] - my);
      vx += (i - mx) * (i - mx);
    }
    const slope = vx ? cov / vx : 0;
    const r = seg.map((v, i) => v - (my + slope * (i - mx)));
    const v0 = r.reduce((s, v) => s + v * v, 0);
    const std = Math.sqrt(v0 / N);
    let bestL = 0,
      bestC = -1;
    for (let L = 5; L <= 13 && L < N - 4; L++) {
      let c = 0;
      for (let i = 0; i + L < N; i++) c += r[i] * r[i + L];
      c = v0 ? (c / v0) * (N / (N - L)) : 0;
      if (c > bestC) {
        bestC = c;
        bestL = L;
      }
    }
    const ext = Math.SQRT2 * std * 100; // approx. half-width in cents
    const vib = bestC >= 0.45 && ext >= 12;
    out.push({
      pos: note.pos,
      vib,
      rate: vib ? 50 / bestL : 0,
      ext: vib ? ext : 0,
      std: std * 100,
      drift: slope * (N - 1) * 100,
    });
  });
  return out;
}

function summarizeHolds(h) {
  const vib = h.filter((x) => x.vib),
    straight = h.filter((x) => !x.vib);
  return {
    count: h.length,
    vibShare: h.length ? vib.length / h.length : 0,
    rate: vib.length ? mean(vib.map((x) => x.rate)) : 0,
    ext: vib.length ? mean(vib.map((x) => x.ext)) : 0,
    wobble: straight.length ? median(straight.map((x) => x.std)) : null,
    drift: h.length ? median(h.map((x) => x.drift)) : 0,
    straight,
    all: h,
  };
}

export function technique(o, t, result) {
  const toOrig = (tt) => Math.max(0, invTime(result.map, tt));
  const pct = (x) => Math.round(x * 100) + "%";
  const out = [];

  // 1. scoops
  const sy = scoopStats(t),
    so = scoopStats(o);
  if (sy.count >= 4) {
    const extra = sy.rate - so.rate;
    out.push({
      key: "scoop",
      title: "Landing on notes",
      value: sy.scoops ? pct(sy.rate) + " scooped" : "Clean",
      compare: "Original: " + pct(so.rate) + " of fresh starts",
      tone: extra > 0.35 ? "bad" : extra > 0.15 ? "warn" : "good",
      detail: sy.scoops
        ? "You slide up into " +
          sy.scoops +
          " of " +
          sy.count +
          " notes that start after a breath, from about " +
          sy.depth +
          "¢ below the note."
        : "You land notes that start after a breath right on pitch.",
      tip:
        extra > 0.15
          ? "Hear the note in your head before you breathe in, then aim for the middle of it. Starting on a light, clear vowel helps you land instead of slide."
          : "",
      p: {
        title: "Hitting notes cleanly",
        value: sy.scoops
          ? sy.scoops + " of " + sy.count + " slid in"
          : "Clean starts",
        compare: so.scoops
          ? "The original singer slides into " + pct(so.rate) + " of notes"
          : "The original singer starts notes cleanly",
        detail: sy.scoops
          ? "Sometimes you start a note too low and slide up to it. Singers call this a scoop, and it can make you sound unsure."
          : "You start your notes right on pitch instead of sliding up to them.",
        tip:
          extra > 0.15
            ? "Before you sing, hear the note in your head, then aim straight for it. Starting softly on the vowel sound helps."
            : "",
      },
      examples: sy.examples.slice(0, 3).map(toOrig),
    });
  }

  // 2. phrase endings
  const og = fillGaps(o.grid),
    runs = [];
  let s = -1;
  for (let k = 0; k <= og.length; k++) {
    const v = k < og.length && og[k] === og[k];
    if (v && s < 0) s = k;
    if (!v && s >= 0) {
      if (k - s >= 50) runs.push([s, k]);
      s = -1;
    }
  }
  // compare how your pitch moves over the last 0.3 s of each phrase with how the original's moves
  const tg = fillGaps(t.grid);
  const herAt = (k) => {
    const j = result.map[k];
    return j >= 0 && j < tg.length ? tg[j] : NaN;
  };
  const origAt = (k) => og[k];
  const win = (k0, k1, f) => {
    const v = [];
    for (let k = Math.max(0, k0); k < k1; k++) {
      const x = f(k);
      if (x === x) v.push(x);
    }
    return v;
  };
  const drops = [];
  runs.forEach(([a, b]) => {
    if (
      result.range &&
      (a * GRID < result.range.start - 0.1 || b * GRID > result.range.end + 0.1)
    )
      return;
    const oE = win(b - 15, b, origAt),
      oP = win(b - 30, b - 15, origAt),
      hE = win(b - 15, b, herAt),
      hP = win(b - 30, b - 15, herAt);
    if (oE.length < 8 || oP.length < 8 || hE.length < 8 || hP.length < 8)
      return;
    drops.push({
      at: b * GRID,
      drop: (mean(hE) - mean(hP) - (mean(oE) - mean(oP))) * 100,
    });
  });
  if (drops.length >= 2) {
    const avg = Math.round(mean(drops.map((x) => x.drop)));
    const flatOnes = drops.filter((x) => x.drop <= -25);
    out.push({
      key: "ends",
      title: "Phrase endings",
      value:
        Math.abs(avg) < 12
          ? "Steady"
          : Math.abs(avg) + "¢ " + (avg < 0 ? "flatter" : "sharper"),
      compare:
        flatOnes.length +
        " of " +
        drops.length +
        " phrases end noticeably flat",
      tone: avg <= -25 ? "bad" : avg <= -12 || avg >= 20 ? "warn" : "good",
      detail:
        Math.abs(avg) < 12
          ? "You hold your pitch through the ends of phrases."
          : "The last words of your phrases are about " +
            Math.abs(avg) +
            "¢ " +
            (avg < 0 ? "flatter" : "sharper") +
            " than the rest of the phrase.",
      tip:
        avg <= -12
          ? "Going flat at the end of a phrase usually means you're running low on air. Take your breath a little earlier and keep the support going through the last word."
          : "",
      p: {
        title: "Ends of lines",
        value:
          Math.abs(avg) < 12 ? "Steady" : "Drops " + (avg < 0 ? "low" : "high"),
        compare: flatOnes.length + " of " + drops.length + " lines end too low",
        detail:
          Math.abs(avg) < 12
            ? "You keep your pitch steady right to the end of each line."
            : avg < 0
              ? "At the end of your lines, your voice drops " +
                howMuch(avg) +
                " too low (goes flat)."
              : "At the end of your lines, your voice creeps " +
                howMuch(avg) +
                " too high (goes sharp).",
        tip:
          avg <= -12
            ? "This usually happens when you're running out of breath. Breathe a bit earlier and keep a gentle, steady push of air through the last word."
            : "",
      },
      examples: flatOnes
        .sort((x, y) => x.drop - y.drop)
        .slice(0, 3)
        .map((x) => Math.max(0, x.at - 1.5)),
    });
  }

  // 3. vibrato and 4. long-note steadiness
  const hy = summarizeHolds(holdStats(t)),
    ho = summarizeHolds(holdStats(o));
  if (hy.count >= 2) {
    let tone = "good",
      detail,
      tip = "";
    if (hy.vibShare === 0) {
      detail = "You hold your long notes straight, without vibrato.";
      if (ho.vibShare >= 0.3) {
        tone = "warn";
        tip =
          "The original uses vibrato on " +
          pct(ho.vibShare) +
          " of long notes. Try letting the note relax and wave slightly after you've landed it, instead of holding it rigid.";
      }
    } else {
      detail =
        "Vibrato on " +
        pct(hy.vibShare) +
        " of your long notes, about " +
        hy.rate.toFixed(1) +
        " waves per second and ±" +
        Math.round(hy.ext) +
        "¢ wide.";
      if (hy.ext > 70 || (ho.ext && hy.ext > ho.ext + 25)) {
        tone = "warn";
        tip =
          "Your vibrato is wider than the original's. Ease off the pressure and let it get narrower and more even.";
      } else if (hy.rate > 7.5) {
        tone = "warn";
        tip =
          "Your vibrato is fast and can sound tight. Relax the throat and jaw so it slows down.";
      } else if (hy.rate < 4.5) {
        tone = "warn";
        tip =
          "Your vibrato is slow and can sound wobbly. More steady breath support usually tightens it up.";
      }
    }
    const speedW = (r) =>
      r < 4.5 ? "slow" : r > 7.5 ? "fast" : "normal speed";
    const widthW = (e) => (e < 25 ? "small" : e < 60 ? "medium" : "big");
    let pTip = "";
    if (tip)
      pTip =
        hy.vibShare === 0
          ? "The original singer lets long notes wave a little. Once you've landed a note, relax and let it move naturally instead of holding it stiff."
          : hy.ext > 70 || (ho.ext && hy.ext > ho.ext + 25)
            ? "Your wave is bigger than the original's, which can sound shaky. Use a little less force and let it settle."
            : hy.rate > 7.5
              ? "Your wave is quick and can sound tense. Relax your jaw and throat."
              : "Your wave is slow and can sound wobbly. Steady breathing helps.";
    out.push({
      p: {
        title: "Vibrato (the wave in a long note)",
        value: hy.vibShare
          ? widthW(hy.ext)[0].toUpperCase() +
            widthW(hy.ext).slice(1) +
            " wave, " +
            speedW(hy.rate)
          : "No wave",
        compare: ho.count
          ? ho.vibShare
            ? "Original: " + widthW(ho.ext) + " wave, " + speedW(ho.rate)
            : "Original: no wave"
          : "",
        detail: hy.vibShare
          ? "Vibrato is the gentle wave you hear in a held note. You use it on " +
            pct(hy.vibShare) +
            " of your long notes."
          : "You hold your long notes perfectly straight, with no wave.",
        tip: pTip,
      },
      key: "vib",
      title: "Vibrato",
      value: hy.vibShare
        ? hy.rate.toFixed(1) + " Hz · ±" + Math.round(hy.ext) + "¢"
        : "None",
      compare: ho.count
        ? ho.vibShare
          ? "Original: " +
            ho.rate.toFixed(1) +
            " Hz · ±" +
            Math.round(ho.ext) +
            "¢ on " +
            pct(ho.vibShare)
          : "Original: none"
        : "",
      tone,
      detail,
      tip,
      examples: hy.all
        .filter((x) => x.vib)
        .slice(0, 3)
        .map((x) => toOrig(x.pos)),
    });

    const wob = hy.wobble,
      drift = Math.round(hy.drift);
    const wobOrig = ho.wobble;
    let stTone = "good",
      stDetail,
      stTip = "";
    const parts = [];
    if (wob != null)
      parts.push(
        "Your straight long notes waver by about ±" +
          Math.round(wob) +
          "¢" +
          (wobOrig != null ? " (original ±" + Math.round(wobOrig) + "¢)" : "") +
          ".",
      );
    if (Math.abs(drift) >= 20)
      parts.push(
        "Over a long note you typically drift " +
          Math.abs(drift) +
          "¢ " +
          (drift < 0 ? "flat" : "sharp") +
          ".",
      );
    stDetail = parts.join(" ") || "Your long notes stay put.";
    if ((wob != null && wob > 22) || Math.abs(drift) >= 35) {
      stTone = "bad";
    } else if ((wob != null && wob > 12) || Math.abs(drift) >= 20) {
      stTone = "warn";
    }
    if (stTone !== "good")
      stTip =
        drift <= -20
          ? "Sagging flat on long notes is usually lost breath support. Keep the air flowing steadily and think of the note staying up."
          : drift >= 20
            ? "Creeping sharp often comes from pushing more air or tension as the note goes on. Keep it relaxed and even."
            : "An unsteady long note usually needs steadier airflow. Practice holding single notes against the guide tone.";
    const worst = [...hy.straight].sort(
      (x, y) => Math.abs(y.drift) + y.std - (Math.abs(x.drift) + x.std),
    );
    const pParts = [];
    if (wob != null && wob > 12)
      pParts.push(
        "Your long notes shake a little" +
          (wobOrig != null && wobOrig < wob - 5
            ? ", more than the original singer's"
            : "") +
          ".",
      );
    if (drift <= -20)
      pParts.push(
        "As you hold a note, your voice slowly sinks lower (goes flat).",
      );
    if (drift >= 20)
      pParts.push(
        "As you hold a note, your voice slowly rises higher (goes sharp).",
      );
    out.push({
      p: {
        title: "Holding long notes",
        value:
          stTone === "good"
            ? "Steady"
            : drift <= -20
              ? "Sinks low"
              : drift >= 20
                ? "Creeps high"
                : "A bit shaky",
        compare: hy.count + " long notes checked",
        detail: pParts.join(" ") || "You hold your long notes nice and steady.",
        tip:
          stTone === "good"
            ? ""
            : drift <= -20
              ? "Your voice sinks when the air runs low. Keep a steady flow of breath until the note ends."
              : drift >= 20
                ? "Your voice rises when you push harder. Keep it relaxed and even."
                : "Practice holding one note at a time along with the guide notes.",
      },
      key: "hold",
      title: "Long notes",
      value:
        wob != null
          ? "±" +
            Math.round(wob) +
            "¢" +
            (Math.abs(drift) >= 20
              ? ", " + Math.abs(drift) + "¢ " + (drift < 0 ? "flat" : "sharp")
              : "")
          : Math.abs(drift) >= 20
            ? Math.abs(drift) + "¢ drift"
            : "Steady",
      compare: hy.count + " long notes measured",
      tone: stTone,
      detail: stDetail,
      tip: stTip,
      examples: (worst.length ? worst : hy.all)
        .slice(0, 3)
        .map((x) => toOrig(x.pos)),
    });
  }
  return out;
}

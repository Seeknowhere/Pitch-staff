// The battle remix: one continuous stretch of the song where each line is sung by whoever won
// it. Both phones run this on the same numbers (just swapped), so they agree on the stretch
// without asking each other.

export const REMIX_MAX = 35; // seconds of song, at most
const PAD = 0.6; // lead-in before the first line and tail after the last

// mine/theirs: { lineIndex: score }; lines: [{ start, end, text }] in song time
// → { t0, t1, segs: [{ line, who, from, to, text }] } (who: 1 me, -1 them, 0 tie), or null
export function pickRemix(mine, theirs, lines) {
  const both = Object.keys(mine)
    .map(Number)
    .filter((i) => theirs[i] != null && lines[i])
    .sort((a, b) => a - b);
  if (!both.length) return null;
  const who = (i) => Math.sign(mine[i] - theirs[i]);
  // best stretch: the most back-and-forth (winner changes), then the closest scores, then earliest
  let best = null;
  for (let a = 0; a < both.length; a++) {
    let switches = 0,
      gap = 0,
      e = a;
    for (let b = a; b < both.length; b++) {
      if (lines[both[b]].end - lines[both[a]].start > REMIX_MAX) break;
      if (b > a && both[b] !== both[b - 1] + 1) break; // keep it to consecutive lines
      if (b > a && who(both[b]) !== who(both[b - 1])) switches++;
      gap += Math.abs(mine[both[b]] - theirs[both[b]]);
      e = b;
    }
    const n = e - a + 1,
      score = switches * 1000 + n * 10 - gap / n;
    if (!best || score > best.score) best = { a, e, score };
  }
  const idx = both.slice(best.a, best.e + 1);
  const t0 = Math.max(0, lines[idx[0]].start - PAD),
    t1 = lines[idx[idx.length - 1]].end + PAD;
  // each line owns the time up to halfway to the next one, so the voices hand over between lines
  const segs = idx.map((i, k) => ({
    line: i,
    who: who(i),
    text: lines[i].text || "",
    from: k === 0 ? t0 : (lines[idx[k - 1]].end + lines[i].start) / 2,
    to:
      k === idx.length - 1 ? t1 : (lines[i].end + lines[idx[k + 1]].start) / 2,
  }));
  return { t0, t1, segs };
}

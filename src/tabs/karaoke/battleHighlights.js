// Picks a battle's highlight moments from both players' line scores. Both phones run this on
// the same numbers (just swapped), so they agree on which lines to clip without asking each other.
//   myBest / theirBest: each player's highest-scoring line
//   closest: the line won by the smallest margin (a tie if every shared line was tied)
//   win: { line, who } the line where the eventual winner took the lead for good
//        (who 1 = me, -1 = them); null if lines won were tied
export function pickHighlights(mine, theirs) {
  const best = (o) => {
    let k = null;
    Object.keys(o)
      .map(Number)
      .sort((a, b) => a - b)
      .forEach((i) => {
        if (k == null || o[i] > o[k]) k = i;
      });
    return k;
  };
  const both = Object.keys(mine)
    .map(Number)
    .filter((i) => theirs[i] != null)
    .sort((a, b) => a - b);
  let closest = null;
  both.forEach((i) => {
    const d = Math.abs(mine[i] - theirs[i]);
    if (d === 0) return;
    if (closest == null || d < Math.abs(mine[closest] - theirs[closest]))
      closest = i;
  });
  if (closest == null && both.length) closest = both[0];
  // running lines-won tally; remember when the final leader last moved ahead
  let y = 0,
    o = 0,
    since = null,
    lead = 0;
  both.forEach((i) => {
    if (mine[i] > theirs[i]) y++;
    else if (mine[i] < theirs[i]) o++;
    const now = Math.sign(y - o);
    if (now !== lead) {
      lead = now;
      since = now ? i : null;
    }
  });
  const win = lead && since != null ? { line: since, who: lead } : null;
  return { myBest: best(mine), theirBest: best(theirs), closest, win };
}

// which of my lines the other phone needs my voice for (mirrors what it plays)
export function linesToSend(h) {
  const s = new Set();
  if (h.myBest != null) s.add(h.myBest);
  if (h.closest != null) s.add(h.closest);
  if (h.win && h.win.who > 0) s.add(h.win.line);
  return [...s];
}

// a line's clip, with a little lead-in and tail
export const CLIP_PAD = 0.4;
export const CLIP_MAX = 12;

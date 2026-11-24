// Lyrics: reading .lrc files, saving them per song, matching words and syllables to notes.
const LYR_KEY = "pitchstaff.lyrics.v1";

export function parseLrc(text) {
  let shift = 0;
  const out = [];
  text.split(/\r?\n/).forEach((rawLine) => {
    const om = rawLine.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]/i);
    if (om) {
      shift = parseInt(om[1], 10) / 1000;
      return;
    }
    const re = /^\s*\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/;
    const tags = [];
    let rest = rawLine,
      mm;
    while ((mm = rest.match(re))) {
      tags.push(parseInt(mm[1], 10) * 60 + parseFloat(mm[2].replace(":", ".")));
      rest = rest.slice(mm[0].length);
    }
    if (!tags.length) return;
    const words = rest
      .replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    // enhanced LRC: <mm:ss.xx> before each word gives word-by-word timing
    let wordRel = null;
    const parts = rest.split(/<(\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?)>/);
    if (parts.length > 2) {
      wordRel = [];
      let tt = tags[0];
      parts.forEach((part, i) => {
        if (i % 2 === 1) {
          const m2 = part.match(/(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)/);
          tt = parseInt(m2[1], 10) * 60 + parseFloat(m2[2].replace(":", "."));
          return;
        }
        part
          .split(/\s+/)
          .filter(Boolean)
          .forEach((w) => wordRel.push({ dt: tt - tags[0], w }));
      });
      if (!wordRel.length) wordRel = null;
    }
    tags.forEach((t) =>
      out.push({
        t,
        text: words,
        words: wordRel ? wordRel.map((x) => ({ t: t + x.dt, w: x.w })) : null,
      }),
    );
  });
  out.sort((x, y) => x.t - y.t);
  // an [offset:] tag in ms makes lyrics appear sooner when positive
  return out.map((l) => ({
    t: Math.max(0, l.t - shift),
    text: l.text,
    words: l.words
      ? l.words.map((w) => ({ t: Math.max(0, w.t - shift), w: w.w }))
      : null,
  }));
}

export function loadLyricsStore() {
  try {
    return JSON.parse(localStorage.getItem(LYR_KEY) || "{}") || {};
  } catch (e) {
    return {};
  }
}

export function saveLyricsFor(song, entry) {
  try {
    const all = loadLyricsStore();
    if (entry) all[song] = entry;
    else delete all[song];
    localStorage.setItem(LYR_KEY, JSON.stringify(all));
  } catch (e) {}
}

// timed lines with start/end on the original's timeline (break markers removed)
export function lyricSpans(lyr, dur) {
  if (!lyr) return [];
  const L = lyr.lines,
    out = [];
  for (let i = 0; i < L.length; i++) {
    if (!L[i].text) continue;
    const start = L[i].t + lyr.offset,
      end = i + 1 < L.length ? L[i + 1].t + lyr.offset : dur;
    if (end > 0 && start < dur)
      out.push({
        src: i,
        start,
        end: Math.max(start + 0.2, end),
        text: L[i].text,
        words: L[i].words
          ? L[i].words.map((w) => ({ t: w.t + lyr.offset, w: w.w }))
          : null,
      });
  }
  return out;
}

// Lyrics from another version of the song (or a lyric video with a longer intro) can be early or
// late. Try shifts up to ±25 s and keep the one where line starts best match where singing starts
// (lyric files usually show a line about half a second before it is sung).
export function bestLyricShift(lines, notes) {
  const ts = lines.filter((l) => l.text).map((l) => l.t);
  if (ts.length < 4 || notes.length < 8) return null;
  const on = [];
  notes.forEach((n, i) => {
    if (!i || n.pos - notes[i - 1].end > 0.3) on.push(n.pos);
  });
  if (on.length < 4) return null;
  const near = (t) => {
    let lo = 0,
      hi = on.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (on[m] < t) lo = m + 1;
      else hi = m;
    }
    return Math.min(
      Math.abs(on[lo] - t),
      lo ? Math.abs(on[lo - 1] - t) : Infinity,
    );
  };
  const score = (off) =>
    ts.reduce((a, t) => {
      const d = near(t + off + 0.45);
      return a + Math.exp(-(d * d) / 0.08);
    }, 0) / ts.length;
  let best = 0,
    bs = -1;
  for (let off = -25; off <= 25.001; off += 0.05) {
    const s = score(off);
    if (s > bs) {
      bs = s;
      best = off;
    }
  }
  for (let off = best - 0.05; off <= best + 0.05; off += 0.01) {
    const s = score(off);
    if (s > bs) {
      bs = s;
      best = off;
    }
  }
  const s0 = score(0);
  return {
    off: Math.round(best * 100) / 100,
    score: bs,
    base: s0,
    sure: bs >= 0.5 && bs >= s0 + 0.15,
  };
}

// a search phrase from a file name: drop the extension, brackets and video/upload words
export function cleanSongName(name) {
  let t = (name || "").replace(/\.[^.]+$/, "").replace(/[_]+/g, " ");
  t = t.replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, " ");
  t = t.replace(
    /\b(official|lyrics?|lyric video|video|audio|hd|hq|4k|1080p|720p|mp3pm|mp3|karaoke|acapella|a cappella|vocals?|voice only|instrumental|music|letra|remaster(ed)?|sung by|my take|mixed|e major|\d+bpm|\d+hz)\b/gi,
    " ",
  );
  return t
    .replace(/&/g, " ")
    .replace(/\s+-\s+/g, " - ")
    .replace(/[^\p{L}\p{N}'\- ]+/gu, " ")
    .replace(/\s+/g, " ")
    .replace(/(^[\s-]+|[\s-]+$)/g, "")
    .trim();
}

export async function findLyrics(query, dur) {
  const tries = [query];
  const parts = query
    .split(" - ")
    .map((x) => x.trim())
    .filter(Boolean);
  if (parts.length > 1)
    tries.push(parts.join(" "), parts.slice(1).join(" "), parts[0]);
  const words = query.replace(/ - /g, " ").split(" ");
  for (let k = words.length - 1; k >= 2; k--)
    tries.push(words.slice(0, k).join(" "));
  const seen = new Set();
  for (const q of tries) {
    const key = q.toLowerCase();
    if (!q || seen.has(key)) continue;
    seen.add(key);
    const res = await fetch(
      "https://lrclib.net/api/search?q=" + encodeURIComponent(q),
    );
    if (!res.ok) throw new Error("lrclib " + res.status);
    const list = (await res.json()).filter((x) => x && !x.instrumental);
    if (!list.length) continue;
    const synced = list.filter((x) => x.syncedLyrics);
    const rank = (x) => (dur && x.duration ? Math.abs(x.duration - dur) : 30);
    return {
      synced: synced.sort((a, b) => rank(a) - rank(b)).slice(0, 5),
      plainOnly: !synced.length,
    };
  }
  return { synced: [], plainOnly: false };
}

// ---- matching lyrics to notes: one syllable per note ----
const TL_WORDS = new Set([
  "ang",
  "ng",
  "sa",
  "mga",
  "ko",
  "mo",
  "na",
  "ay",
  "at",
  "ka",
  "ako",
  "ikaw",
  "hindi",
  "lang",
  "pa",
  "ba",
  "ito",
  "kung",
  "siya",
  "tayo",
  "natin",
  "kita",
  "di",
  "nga",
  "yo",
]);

export function looksTagalog(lines) {
  let n = 0,
    t = 0;
  lines.forEach((l) =>
    (l.text || "")
      .toLowerCase()
      .split(/[^a-zñ']+/)
      .forEach((w) => {
        w = w.replace(/'/g, "");
        if (!w) return;
        n++;
        if (TL_WORDS.has(w)) t++;
      }),
  );
  return n > 0 && t / n > 0.12;
}

export function syllableCount(word, tl) {
  const w = word.toLowerCase().replace(/[^a-zñ]/g, "");
  if (!w) return 0;
  if (tl) {
    if (w === "mga") return 2;
    const m = w.match(/[aeiou]/g);
    return Math.max(1, m ? m.length : 1);
  } // Tagalog: every vowel is a syllable
  const m = w.replace(/(^|[aeiou])y(?=[aeiou])/g, "$1c").match(/[aeiouy]+/g);
  let c = m ? m.length : 1;
  if (c > 1 && /[^aeiou]e$/.test(w) && !/[^aeiou]le$/.test(w)) c--; // silent e
  if (c > 1 && /[^aeioudt]ed$/.test(w)) c--;
  if (c > 1 && /[^aeiou]es$/.test(w) && !/(s|x|z|ch|sh|ce|ge)es$/.test(w)) c--; // times, eyes
  if (/[aeiouy]ing$/.test(w) && !/[aeiou]ying$/.test(w)) c++; // ly-ing, be-ing
  return Math.max(1, c);
}

// split a line's notes among its words: strongest note boundaries (a consonant or a breath) become syllable starts,
// and notes joined by a plain pitch change stay with the same syllable (a run on one vowel)
export function wordsToNotes(text, ln, tl) {
  const words = text.split(/\s+/).filter((w) => /[a-zA-Zñ0-9]/.test(w));
  if (!words.length || !ln.length) return null;
  const owner = [];
  words.forEach((w, wi) => {
    const c = syllableCount(w, tl) || 1;
    for (let k = 0; k < c; k++) owner.push(wi);
  });
  const N = ln.length,
    S = owner.length;
  let groups;
  if (N >= S) {
    const bounds = [];
    for (let i = 1; i < N; i++) {
      const a = ln[i - 1],
        b = ln[i],
        gap = Math.max(0, b.pos - a.end);
      bounds.push({
        i,
        s:
          (b.cut === "silence" ? 3 : b.cut === "dip" ? 2 : 0) +
          Math.min(1, gap / 0.15) +
          (a.midi === b.midi ? 0.5 : 0),
      });
    }
    const keep = new Set(
      [...bounds]
        .sort((x, y) => y.s - x.s || x.i - y.i)
        .slice(0, S - 1)
        .map((b) => b.i),
    );
    groups = [];
    let cur = [0];
    for (let i = 1; i < N; i++) {
      if (keep.has(i)) {
        groups.push(cur);
        cur = [i];
      } else cur.push(i);
    }
    groups.push(cur);
  } else
    groups = Array.from({ length: S }, (_, k) => [
      Math.min(N - 1, Math.floor((k * N) / S)),
    ]);
  return words.map((w, wi) => {
    const idx = [];
    owner.forEach((o, k) => {
      if (o === wi)
        groups[k].forEach((i) => {
          if (!idx.includes(i)) idx.push(i);
        });
    });
    return { w, idx };
  });
}

export function songTitle(sampleName, vocal) {
  if (sampleName) return sampleName;
  return vocal && vocal.name ? vocal.name.replace(/\.[^.]+$/, "") : "";
}

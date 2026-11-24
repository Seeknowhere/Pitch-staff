// Lyric Duel: the song pauses before a line, its last words are hidden, and one singer has to
// sing the line with the right words. Tono checks the words with the browser's speech
// recognition (pitch on that line is a bonus). Wrong or silent: the other singer can steal.
// Both phones work out the same questions from the lyrics, so nothing has to be sent.

const wordsOf = (t) =>
  (t || "")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);

// a word as we compare it: lower case, letters and digits only ("don't" → "dont")
export const norm = (w) =>
  w
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

// up to 10 questions spread over the song; the first third hides 1 word, the middle 2,
// the last third the end of the line (up to 4 words). A rematch (round > 1) shifts which lines.
export function duelPlan(lines, round = 1) {
  const cands = lines
    .map((l, i) => ({ i, n: wordsOf(l.text).length }))
    .filter((x) => x.i > 0 && x.n >= 3);
  const want = Math.min(10, Math.floor(cands.length / 2));
  if (!want) return [];
  const step = cands.length / want,
    shift = round % 2 === 0 ? step / 2 : 0;
  const qs = [];
  for (let k = 0; k < want; k++) {
    const c = cands[Math.min(cands.length - 1, Math.floor(k * step + shift))];
    if (qs.length && c.i - qs[qs.length - 1].line < 2) continue; // never two lines in a row
    const part = k / want;
    const hide = part < 1 / 3 ? 1 : part < 2 / 3 ? 2 : Math.min(4, c.n - 1);
    qs.push({ line: c.i, hide });
  }
  return qs;
}

// the line split into what's shown and what's hidden (the last `hide` words)
export function splitLine(text, hide) {
  const w = wordsOf(text);
  return { shown: w.slice(0, w.length - hide), hidden: w.slice(w.length - hide) };
}

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

// did what Tono heard contain the hidden words? Small slips are fine (a letter or two on longer
// words), and with 3+ hidden words one can be missed.
export function checkWords(hidden, heard) {
  const got = wordsOf(heard).map(norm).filter(Boolean);
  const want = hidden.map(norm).filter(Boolean);
  if (!want.length) return { ok: true, matched: 0, of: 0 };
  let matched = 0;
  want.forEach((w) => {
    const slack = w.length <= 3 ? 0 : w.length <= 6 ? 1 : 2;
    if (got.some((g) => g === w || lev(g, w) <= slack)) matched++;
  });
  const need = want.length >= 3 ? want.length - 1 : want.length;
  return { ok: matched >= need, matched, of: want.length };
}

export const canHear = () =>
  typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

// listens until stop() and resolves with everything it heard ("" if nothing, or null if the
// browser can't do it). The browser sends the audio to its speech service (Google or Apple).
export function listen(lang) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return { stop() {}, result: Promise.resolve(null) };
  const r = new SR();
  r.lang = lang;
  r.continuous = true;
  r.interimResults = true;
  r.maxAlternatives = 3;
  let finals = [],
    interim = "",
    done;
  const result = new Promise((res) => (done = res));
  r.onresult = (e) => {
    interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const alts = Array.from(e.results[i]).map((a) => a.transcript);
      if (e.results[i].isFinal) finals[i] = alts.join(" ");
      else interim = alts.join(" ");
    }
  };
  r.onerror = () => {};
  r.onend = () => done([...finals.filter(Boolean), interim].join(" ").trim());
  try {
    r.start();
  } catch (e) {
    done(null);
  }
  return {
    stop() {
      try {
        r.stop();
      } catch (e) {
        done([...finals.filter(Boolean), interim].join(" ").trim());
      }
    },
    result,
  };
}

// points: 100 for the words on your turn (50 on a steal), plus up to 50 for pitch on that line
export const pointsFor = (steal, pitch) =>
  (steal ? 50 : 100) + Math.round(((pitch || 0) / 100) * (steal ? 25 : 50));

// the line as shown before it's answered: its hidden words become blanks
export function maskLine(line, hide) {
  if (!line) return line;
  const blank = (w) => "_".repeat(Math.max(3, Math.min(8, norm(w).length || 4)));
  if (line.words && line.words.length) {
    const n = line.words.length;
    return { ...line, words: line.words.map((w, i) => (i >= n - hide ? { ...w, w: blank(w.w) } : w)) };
  }
  const { shown, hidden } = splitLine(line.text, hide);
  return { ...line, text: [...shown, ...hidden.map(blank)].join(" ") };
}

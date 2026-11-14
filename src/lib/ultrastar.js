// Reading and writing UltraStar karaoke files (.txt).
import { GRID } from "./analysis.js";
import { wordsToNotes, looksTagalog } from "./lyrics.js";
import { median } from "./math.js";

// Each line ": beat length pitch syllable". Pitch 0 = C4. A leading space starts a new word; "~" continues a syllable.
export function parseUltraStar(text) {
  const rows = text.replace(/^﻿/, "").split(/\r?\n/);
  const hdr = {};
  rows.forEach((r) => {
    const m = r.match(/^#([^:]+):(.*)$/);
    if (m) hdr[m[1].trim().toUpperCase()] = m[2].trim();
  });
  const bpm = parseFloat((hdr.BPM || "").replace(",", "."));
  if (!(bpm > 0)) return null;
  const gap = parseFloat((hdr.GAP || "0").replace(",", ".")) || 0;
  const rel = /^yes$/i.test(hdr.RELATIVE || "");
  const spb = 60 / (bpm * 4),
    time = (b) => gap / 1000 + b * spb;
  const items = [];
  let base = 0;
  for (const r of rows) {
    const c = r[0];
    if (c === "E") break;
    if (c === ":" || c === "*" || c === "F" || c === "R" || c === "G") {
      const m = r.match(/^[:*FRG]\s*(-?\d+)\s+(\d+)\s+(-?\d+)\s?(.*)$/);
      if (m)
        items.push({
          kind: "n",
          type: c,
          beat: +m[1] + base,
          len: +m[2],
          pitch: +m[3],
          text: m[4],
        });
    } else if (c === "-") {
      const m = r.match(/^-\s*(-?\d+)(?:\s+(-?\d+))?/);
      if (m) {
        items.push({ kind: "b", beat: +m[1] + base });
        if (rel) base += m[2] != null ? +m[2] : +m[1];
      }
    }
  }
  const lines = [],
    notes = [];
  let cur = null,
    word = null;
  const flush = () => {
    if (cur && cur.words.length) {
      cur.text = cur.words.map((w) => w.w).join(" ");
      lines.push(cur);
    }
    cur = null;
    word = null;
  };
  items.forEach((it) => {
    if (it.kind === "b") {
      flush();
      return;
    }
    const t0 = time(it.beat),
      t1 = time(it.beat + Math.max(1, it.len));
    const raw = it.text || "";
    const cont = /^\s*~/.test(raw),
      newWord = !cur || /^\s/.test(raw) || !word;
    const syl = raw.replace(/~/g, "").trim();
    if (!cur) cur = { t: t0, text: "", words: [] };
    if (!cont && (newWord || !word)) {
      word = { t: t0, w: syl };
      cur.words.push(word);
    } else if (!cont && word) word.w += syl;
    if (it.type !== "F" && it.type !== "R" && it.type !== "G")
      notes.push({
        midi: it.pitch + 60,
        pos: t0,
        end: t1,
        cut: cont ? "pitch" : newWord ? "silence" : "dip",
        gold: it.type === "*",
      });
  });
  flush();
  lines.forEach((l) => {
    l.words = l.words.filter((w) => w.w);
  });
  return {
    title: hdr.TITLE || "",
    artist: hdr.ARTIST || "",
    lines: lines.filter((l) => l.words.length),
    notes,
  };
}

// UltraStar charts often sit an octave or two away from the real voice: move them to where the vocal actually is
export function usNotesFor(entry, data) {
  if (!entry || !entry.us || !entry.us.length) return null;
  const off = entry.offset || 0;
  const ns = entry.us.map(([midi, pos, end, c]) => ({
    midi,
    pos: pos + off,
    end: end + off,
    cut: ["silence", "dip", "pitch"][c] || "pitch",
  }));
  const diffs = [];
  ns.forEach((n) => {
    for (
      let k = Math.round(n.pos / GRID);
      k < Math.round(n.end / GRID) && k < data.grid.length;
      k++
    )
      if (data.grid[k] === data.grid[k]) diffs.push(data.grid[k] - n.midi);
  });
  const sh = diffs.length > 20 ? 12 * Math.round(median(diffs) / 12) : 0;
  return ns.map((n) => ({ ...n, midi: n.midi + sh }));
}

export function toUltraStar({ title, artist, audio, instrumental, notes, spans }) {
  const spb = 0.05,
    gapMs = Math.max(0, Math.round((notes.length ? notes[0].pos : 0) * 1000));
  const beat = (t) => Math.max(0, Math.round((t - gapMs / 1000) / spb));
  const tl = looksTagalog(spans);
  const out = [
    "#VERSION:1.1.0",
    "#TITLE:" + (title || "Untitled"),
    "#ARTIST:" + (artist || "Unknown"),
  ];
  if (audio) {
    out.push("#MP3:" + audio, "#AUDIO:" + audio, "#VOCALS:" + audio);
  }
  if (instrumental) out.push("#INSTRUMENTAL:" + instrumental);
  out.push("#BPM:300", "#GAP:" + gapMs);
  let lastEnd = null;
  spans.forEach((l) => {
    const idx = [];
    notes.forEach((n, i) => {
      if (n.pos >= l.start - 0.08 && n.pos < l.end - 0.02) idx.push(i);
    });
    if (!idx.length || !l.text) return;
    let words;
    if (l.words && l.words.length)
      words = l.words.map((w, k) => {
        const e = k + 1 < l.words.length ? l.words[k + 1].t : l.end;
        return {
          w: w.w,
          idx: idx.filter(
            (i) => notes[i].pos >= w.t - 0.08 && notes[i].pos < e - 0.02,
          ),
        };
      });
    else {
      const m = wordsToNotes(
        l.text,
        idx.map((i) => notes[i]),
        tl,
      );
      words = m
        ? m.map((x) => ({ w: x.w, idx: x.idx.map((j) => idx[j]) }))
        : [];
    }
    if (lastEnd != null) out.push("- " + beat(lastEnd));
    let first = true,
      pending = "";
    words.forEach((w) => {
      // a word with no note of its own rides along with the next sung word, so no lyrics are lost
      if (!w.idx.length) {
        pending += (pending ? " " : "") + w.w;
        return;
      }
      w.idx.forEach((i, j) => {
        const n = notes[i],
          b = beat(n.pos),
          len = Math.max(1, Math.round((n.end - n.pos) / spb));
        const txt =
          j === 0
            ? (first ? "" : " ") + (pending ? pending + " " : "") + w.w
            : "~";
        out.push(": " + b + " " + len + " " + (n.midi - 60) + " " + txt);
        first = false;
        lastEnd = n.end;
        pending = "";
      });
    });
    if (pending && out.length && out[out.length - 1].startsWith(":"))
      out[out.length - 1] =
        out[out.length - 1].replace(/ ~$/, " ~") + " " + pending;
  });
  out.push("E");
  return out.join("\n") + "\n";
}

/* ---------- karaoke ---------- */

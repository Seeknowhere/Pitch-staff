import htm from "htm";
import React from "react";
import ReactDOM from "react-dom/client";
import { BtTags } from "./components/BtTags.js";
import { Dial } from "./components/Dial.js";
import { Icon } from "./components/Icon.js";
import { Keyboard } from "./components/Keyboard.js";
import { MelodyMap } from "./components/MelodyMap.js";
import { RangeKeys } from "./components/RangeKeys.js";
import { Sheet } from "./components/Sheet.js";
import { TryPanel, TryChart, BreathTimingView } from "./components/TryPanel.js";
import { UploadSlot } from "./components/UploadSlot.js";
import { aiCachePut, aiCacheGet, snapToKey, aiNotes } from "./lib/ai-notes.js";
import { guideBySyllables, detectKeyAndOffset, warpTake, trackPitch, scheduleGuide, SESS_KEY, decodeFile, mapTime, fixedMap, GRID, loadSessions, invTime, compare } from "./lib/analysis.js";
import { chromaOf, saveBlob, playPiano, playChime } from "./lib/audio.js";
import { cssVar } from "./lib/css.js";
import { sortSongFiles, driveList, driveFile, DRIVE_KEY, DRIVE_FOLDER } from "./lib/drive.js";
import { onsetEnvelope, autoSync, keyGap, KARA_SYNC_KEY } from "./lib/karaoke-sync.js";
import { loadLyricsStore, saveLyricsFor, cleanSongName, lyricSpans, parseLrc, wordsToNotes, songTitle, findLyrics, looksTagalog, bestLyricShift } from "./lib/lyrics.js";
import { median } from "./lib/math.js";
import { NAMES, midiInfo, freqToMidi, pretty, fmt, signed } from "./lib/music.js";
import { buildPhrases, keyName, KEY_MAJ, KEY_MIN, estimateKey, SOLFEGE, scorePhrase } from "./lib/phrases.js";
import { detectPitch } from "./lib/pitch.js";
import { savePlan, makePlan, loadPlan } from "./lib/plan.js";
import { comfyOf, RANGE_KEY, loadRanges } from "./lib/range.js";
import { scoreTone, analyzeRun, loadLastRun, saveLastRun, addRun, loadRuns, lineHistory, dayLabel } from "./lib/runs.js";
import { SETTINGS, saveSettings, micGate, getMicStream } from "./lib/settings.js";
import { cancelSplit, splitSong, hasWebGPU, canSplitSongs, wavFile } from "./lib/split.js";
import { loadJSON, saveJSON, MATCH_KEY } from "./lib/storage.js";
import { technique } from "./lib/technique.js";
import { loadTries, saveTries, btInfo, tryStats } from "./lib/tries.js";
import { parseUltraStar, usNotesFor, toUltraStar } from "./lib/ultrastar.js";
import { pianoKeys, howMuch } from "./lib/wording.js";
import { Karaoke } from "./tabs/karaoke/Karaoke.js";
import { Lessons, FlowHead } from "./tabs/lessons/Lessons.js";
import { lessonRange } from "./tabs/lessons/data.js";
import { Exercise } from "./tabs/lessons/exercises.js";
import { useLessonMic } from "./tabs/lessons/hooks.js";

(function () {
  const { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } =
    React;
  const html = htm.bind(React.createElement);

  /* ---------- storage ---------- */
  const KEY = "pitchstaff.history.v1";
  const THEME_KEY = "pitchstaff.theme";
  function loadHistory() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }
  function saveHistory(h) {
    try {
      localStorage.setItem(KEY, JSON.stringify(h));
    } catch (e) {}
  }

  /* ---------- staff ---------- */

  const MIX_KEY = "pitchstaff.mix.v1";
  function RollChart({
    orig,
    take,
    result,
    cursor,
    onSeek,
    themeKey,
    lyrics,
    loop,
  }) {
    const canvasRef = useRef(null),
      boxRef = useRef(null);
    const dur = orig.duration;
    const pps = Math.min(50, 12000 / Math.max(1, dur));
    const W = Math.ceil(dur * pps),
      MH = 250,
      H = result.dev ? 296 : 250;
    const range = useMemo(() => {
      let lo = Infinity,
        hi = -Infinity;
      orig.grid.forEach((v) => {
        if (v === v) {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      });
      for (let k = 0; k < orig.grid.length; k++) {
        const j = result.map[k];
        if (j >= 0 && j < take.grid.length) {
          const v = take.grid[j] - result.shift;
          if (v === v) {
            lo = Math.min(lo, v);
            hi = Math.max(hi, v);
          }
        }
      }
      if (!isFinite(lo)) {
        lo = 55;
        hi = 79;
      }
      lo = Math.floor(lo) - 2;
      hi = Math.ceil(hi) + 2;
      if (hi - lo < 14) {
        const mid = (hi + lo) / 2;
        lo = Math.floor(mid - 7);
        hi = Math.ceil(mid + 7);
      }
      return { lo, hi };
    }, [orig, take, result]);
    const yOfM = (m) =>
      MH - 16 - ((m - range.lo) / (range.hi - range.lo)) * (MH - 30);

    useEffect(() => {
      const cv = canvasRef.current;
      if (!cv) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = W * dpr;
      cv.height = H * dpr;
      cv.style.width = W + "px";
      cv.style.height = H + "px";
      const g = cv.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const col = {
        line: cssVar("--line"),
        muted: cssVar("--muted"),
        fg: cssVar("--fg"),
        accent: cssVar("--accent"),
        good: cssVar("--good"),
        warn: cssVar("--warn"),
        bad: cssVar("--bad"),
      };
      // outside the part you sang
      if (result.range && !result.range.whole) {
        g.fillStyle = col.muted;
        g.globalAlpha = 0.12;
        g.fillRect(0, 0, result.range.start * pps, H);
        g.fillRect(
          result.range.end * pps,
          0,
          Math.max(0, W - result.range.end * pps),
          H,
        );
      }
      // trouble spots
      g.fillStyle = col.bad;
      g.globalAlpha = 0.09;
      result.spots.forEach((s) =>
        g.fillRect(s.start * pps, 0, (s.end - s.start) * pps, H),
      );
      g.globalAlpha = 1;
      // semitone grid with C labels
      for (let m = range.lo; m <= range.hi; m++) {
        const y = yOfM(m),
          isC = ((m % 12) + 12) % 12 === 0;
        g.strokeStyle = isC ? col.muted : col.line;
        g.globalAlpha = isC ? 0.5 : 0.45;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(W, y);
        g.stroke();
        if (isC) {
          g.globalAlpha = 0.9;
          g.fillStyle = col.muted;
          g.font = "10px " + cssVar("--font-mono");
          for (let x = 4; x < W; x += 8 * pps)
            g.fillText("C" + (Math.floor(m / 12) - 1), x, y - 3);
        }
      }
      g.globalAlpha = 1;
      // seconds ticks
      g.fillStyle = col.muted;
      g.font = "10px " + cssVar("--font-mono");
      for (let s = 0; s < dur; s += 5) g.fillText(fmt(s), s * pps + 3, MH - 3);
      // original melody
      g.strokeStyle = col.fg;
      g.globalAlpha = 0.28;
      g.lineWidth = 6;
      g.lineCap = "round";
      g.lineJoin = "round";
      const a = orig.grid;
      g.beginPath();
      let pen = false;
      for (let k = 0; k < a.length; k++) {
        const v = a[k];
        if (v !== v) {
          pen = false;
          continue;
        }
        if (pen && Math.abs(v - a[k - 1]) > 1.5) pen = false;
        const x = k * GRID * pps,
          y = yOfM(v);
        if (!pen) {
          g.moveTo(x, y);
          pen = true;
        } else g.lineTo(x, y);
      }
      g.stroke();
      g.globalAlpha = 1;
      // your take, colored by accuracy
      g.lineWidth = 2.4;
      const b = take.grid;
      for (let k = 1; k < a.length; k++) {
        const j = result.map[k],
          j0 = result.map[k - 1];
        if (j < 0 || j >= b.length || j0 < 0 || j0 >= b.length) continue;
        const v0 = b[j0],
          v1 = b[j];
        if (v0 !== v0 || v1 !== v1 || Math.abs(v1 - v0) > 1.5) continue;
        const dk = result.d[k];
        g.strokeStyle =
          dk !== dk
            ? col.accent
            : Math.abs(dk) <= 0.25
              ? col.good
              : Math.abs(dk) <= 0.5
                ? col.warn
                : col.bad;
        g.beginPath();
        g.moveTo((k - 1) * GRID * pps, yOfM(v0 - result.shift));
        g.lineTo(k * GRID * pps, yOfM(v1 - result.shift));
        g.stroke();
      }
      // note names: the song's note above its line; where you sang another note, yours in its colour
      const nm = (m) => pretty(NAMES[((m % 12) + 12) % 12]);
      g.font = "600 10px " + cssVar("--font-mono");
      g.textBaseline = "alphabetic";
      const rowOf = new Map(result.rows.map((r) => [r.n, r]));
      let lastX = -99;
      orig.notes.forEach((n) => {
        const x = n.pos * pps + 1,
          r = rowOf.get(n),
          lab = nm(n.midi);
        if (x < lastX + 16) return;
        lastX = x + lab.length * 6;
        const y = yOfM(n.midi) - 7;
        g.fillStyle = col.fg;
        g.globalAlpha = 0.75;
        g.fillText(lab, x, y);
        g.globalAlpha = 1;
        if (!r || r.missed) return;
        if (r.tone === "warn") {
          g.fillStyle = col.warn;
          g.fillText(r.cents > 0 ? "↑" : "↓", x + lab.length * 6 + 1, y);
        } else if (r.tone === "bad") {
          const yr = r.yours - result.shift;
          g.fillStyle = col.bad;
          g.fillText(nm(yr), x, yOfM(yr) + 15);
        }
      });
      if (result.dev) {
        const y0 = MH + 23;
        g.strokeStyle = col.line;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(0, y0);
        g.lineTo(W, y0);
        g.stroke();
        g.fillStyle = col.muted;
        g.font = "10px " + cssVar("--font-mono");
        for (let x = 4; x < W; x += 8 * pps) {
          g.fillText("late", x, MH + 10);
          g.fillText("early", x, H - 2);
        }
        for (let k = 0; k < a.length; k += 5) {
          if (a[k] !== a[k]) continue;
          const dv = result.dev[k],
            h = Math.max(-1, Math.min(1, dv / 0.5)) * 18;
          g.fillStyle =
            Math.abs(dv) < 0.1
              ? col.good
              : Math.abs(dv) < 0.25
                ? col.warn
                : col.bad;
          g.fillRect(
            k * GRID * pps,
            h > 0 ? y0 - h : y0,
            Math.max(1, 5 * GRID * pps - 1),
            Math.max(1, Math.abs(h)),
          );
        }
      }
    }, [orig, take, result, range, W, H, pps, themeKey]);

    // keep the playhead in view
    useEffect(() => {
      const box = boxRef.current;
      if (!box || cursor == null) return;
      const x = cursor * pps;
      if (x < box.scrollLeft + 30 || x > box.scrollLeft + box.clientWidth - 60)
        box.scrollLeft = Math.max(0, x - 60);
    }, [cursor, pps]);

    return html`<div
      ref=${boxRef}
      style=${{
        overflowX: "auto",
        position: "relative",
        borderRadius: 10,
        background: "var(--surface-2)",
        border: "1px solid var(--line)",
      }}
    >
      <div style=${{ position: "relative", width: W }}>
        ${lyrics &&
        lyrics.length > 0 &&
        html`<div class="lyr-band">
          ${lyrics.map(
            (l, i) =>
              html`<div
                key=${i}
                class=${"lyr" +
                (cursor != null && cursor >= l.start && cursor < l.end
                  ? " on"
                  : "")}
                style=${{
                  left: l.start * pps,
                  width: Math.max(8, (l.end - l.start) * pps - 2),
                }}
                title=${l.text}
                onClick=${() => onSeek(l.start)}
              >
                ${l.text}
              </div>`,
          )}
        </div>`}
        <canvas
          ref=${canvasRef}
          style=${{ display: "block", cursor: "pointer" }}
          onClick=${(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            onSeek(Math.max(0, (e.clientX - r.left) / pps));
          }}
        ></canvas>
        ${loop &&
        html`<div
          style=${{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: loop.a * pps,
            width: (loop.b - loop.a) * pps,
            background: "color-mix(in srgb, var(--accent) 12%, transparent)",
            borderLeft: "1px solid var(--accent)",
            borderRight: "1px solid var(--accent)",
            pointerEvents: "none",
          }}
        ></div>`}
        ${cursor != null &&
        html`<div
          style=${{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: cursor * pps,
            width: 2,
            marginLeft: -1,
            background: "var(--accent)",
            pointerEvents: "none",
          }}
        ></div>`}
      </div>
    </div>`;
  }

  function Spark({ vals, w = 74, h = 22, tone }) {
    if (!vals || vals.length < 2) return null;
    const pts = vals.map((v, i) => [
      3 + (i * (w - 6)) / (vals.length - 1),
      h - 3 - (v / 100) * (h - 6),
    ]);
    const c = "var(--" + (tone || scoreTone(vals[vals.length - 1])) + ")";
    return html`<svg
      width=${w}
      height=${h}
      viewBox=${"0 0 " + w + " " + h}
      aria-hidden="true"
      style=${{ flexShrink: 0 }}
    >
      <polyline
        points=${pts
          .map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1))
          .join(" ")}
        fill="none"
        stroke=${c}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      ></polyline>
      <circle
        cx=${pts[pts.length - 1][0].toFixed(1)}
        cy=${pts[pts.length - 1][1].toFixed(1)}
        r="2.6"
        fill=${c}
      ></circle>
    </svg>`;
  }
  function HistChart({ pts }) {
    if (!pts.length) return html`<p class="text-xs muted">No scores yet.</p>`;
    const W = 300,
      H = 90,
      xs = pts.map((_, i) =>
        pts.length === 1 ? W / 2 : 18 + (i * (W - 36)) / (pts.length - 1),
      ),
      y = (v) => H - 16 - (v / 100) * (H - 26);
    let lastDay = "";
    return html`<svg
      viewBox=${"0 0 " + W + " " + H}
      style=${{ width: "100%", height: "auto", display: "block" }}
      role="img"
      aria-label="Scores for this line over time"
    >
      <line
        x1="0"
        x2=${W}
        y1=${y(80).toFixed(1)}
        y2=${y(80).toFixed(1)}
        stroke="var(--good)"
        strokeDasharray="3 4"
        opacity="0.5"
      ></line>
      <text
        x=${W - 2}
        y=${(y(80) - 4).toFixed(1)}
        fill="var(--good)"
        fontSize="9"
        textAnchor="end"
      >
        good
      </text>
      ${pts.length > 1 &&
      html`<polyline
        points=${pts
          .map((p, i) => xs[i].toFixed(1) + "," + y(p.s).toFixed(1))
          .join(" ")}
        fill="none"
        stroke="var(--line)"
        strokeWidth="1.5"
      ></polyline>`}
      ${pts.map((p, i) =>
        p.kind === "run"
          ? html`<circle
              key=${"p" + i}
              cx=${xs[i].toFixed(1)}
              cy=${y(p.s).toFixed(1)}
              r="4.5"
              fill="var(--accent)"
            ></circle>`
          : html`<circle
              key=${"p" + i}
              cx=${xs[i].toFixed(1)}
              cy=${y(p.s).toFixed(1)}
              r="3.5"
              fill="var(--surface)"
              stroke="var(--you)"
              strokeWidth="2"
            ></circle>`,
      )}
      ${pts.map((p, i) => {
        const d = dayLabel(p.at);
        if (d === lastDay) return null;
        lastDay = d;
        return html`<text
          key=${"d" + i}
          x=${xs[i].toFixed(1)}
          y=${H - 2}
          fill="var(--muted)"
          fontSize="9"
          textAnchor="middle"
          >${d}</text
        >`;
      })}
    </svg>`;
  }
  function SongTrend({ runs }) {
    const vals = runs.slice(-8);
    if (vals.length < 2)
      return html`<p class="text-sm muted">
        Sing the whole song a couple of times (Karaoke works) to see your trend
        here.
      </p>`;
    const W = 300,
      H = 110,
      lo = Math.max(0, Math.min(...vals.map((r) => r.score)) - 15),
      xs = vals.map((_, i) => 14 + (i * (W - 28)) / (vals.length - 1)),
      y = (v) => H - 18 - ((v - lo) / (100 - lo)) * (H - 30);
    const line = vals
      .map((r, i) => xs[i].toFixed(1) + "," + y(r.score).toFixed(1))
      .join(" ");
    return html`<svg
      viewBox=${"0 0 " + W + " " + H}
      style=${{ width: "100%", height: "auto", display: "block" }}
      role="img"
      aria-label="Whole-song score over time"
    >
      <polygon
        points=${xs[0].toFixed(1) +
        "," +
        (H - 18) +
        " " +
        line +
        " " +
        xs[xs.length - 1].toFixed(1) +
        "," +
        (H - 18)}
        fill="var(--accent)"
        opacity="0.12"
      ></polygon>
      <polyline
        points=${line}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      ></polyline>
      ${vals.map(
        (r, i) =>
          html`<g key=${i}
            ><circle
              cx=${xs[i].toFixed(1)}
              cy=${y(r.score).toFixed(1)}
              r="3.5"
              fill="var(--accent)"
            ></circle>
            <text
              x=${xs[i].toFixed(1)}
              y=${(y(r.score) - 8).toFixed(1)}
              fill="var(--fg)"
              fontSize="10"
              textAnchor="middle"
              fontFamily="var(--font-mono)"
              >${r.score}</text
            >
            <text
              x=${xs[i].toFixed(1)}
              y=${H - 3}
              fill="var(--muted)"
              fontSize="9"
              textAnchor="middle"
              >${dayLabel(r.at)}</text
            ></g
          >`,
      )}
    </svg>`;
  }
  function AnalyzeView({
    songName,
    notes,
    phrases,
    spans,
    run,
    runs,
    tries,
    canHear,
    onHearMe,
    onHearSong,
    onPractise,
    planDraft,
    onPlan,
  }) {
    const [view, setView] = useState("run");
    const [order, setOrder] = useState("weak");
    const [open, setOpen] = useState(null);
    const [dtab, setDtab] = useState("notes");
    useEffect(() => setOpen(null), [run]);
    useEffect(() => setDtab("notes"), [open]);
    const textOf = (ph) => {
      let best = null,
        bo = 0;
      spans.forEach((l) => {
        const o = Math.min(l.end, ph.end) - Math.max(l.start, ph.start);
        if (o > bo) {
          bo = o;
          best = l;
        }
      });
      return best ? best.text : "";
    };
    const items = phrases.map((ph, i) => ({
      i,
      ph,
      text: textOf(ph),
      rec: run && run.lines ? run.lines[i] : null,
      hist: lineHistory(i, runs, tries),
    }));
    const sungItems = items.filter((x) => x.rec);
    const shown =
      order === "weak"
        ? [...sungItems].sort((a, b) => a.rec.score - b.rec.score)
        : sungItems;
    const good = sungItems.filter((x) => x.rec.score >= 80).length,
      weak = sungItems.filter((x) => x.rec.score < 55).length;
    const breathLines = sungItems.filter(
        (x) => x.rec.bt && x.rec.bt.breaths.length,
      ).length,
      cutLines = sungItems.filter((x) => x.rec.bt && x.rec.bt.cut).length;
    const prev = runs.length >= 2 ? runs[runs.length - 2] : null;
    const diff =
      run && prev && run.at === runs[runs.length - 1].at
        ? run.score - prev.score
        : null;
    const latest = (x) => (x.hist.length ? x.hist[x.hist.length - 1].s : null);
    const improved = items
      .filter((x) => x.hist.length >= 2 && latest(x) - x.hist[0].s >= 10)
      .sort((a, b) => latest(b) - b.hist[0].s - (latest(a) - a.hist[0].s))
      .slice(0, 3);
    const tricky = items
      .filter((x) => x.hist.length && latest(x) < 60)
      .sort((a, b) => latest(a) - latest(b))
      .slice(0, 3);
    const lineTries = Object.values(tries || {}).reduce(
      (s, t) => s + (t && t.hist ? t.hist.length : t && t.last ? 1 : 0),
      0,
    );
    const linesGood = items.filter(
      (x) => latest(x) != null && latest(x) >= 80,
    ).length;
    const openItem = open != null ? items[open] : null;
    const openInfo = openItem && openItem.rec ? tryStats(openItem.rec) : null;
    const runPts = openItem
        ? openItem.hist.filter((p) => p.kind === "run")
        : [],
      tryPts = openItem ? openItem.hist.filter((p) => p.kind === "try") : [];
    const avg = (a) => Math.round(a.reduce((s, p) => s + p.s, 0) / a.length);
    const insight =
      openItem && runPts.length && tryPts.length >= 2
        ? avg(tryPts.slice(-3)) - runPts[runPts.length - 1].s >= 10
          ? "Better when you practise it alone (" +
            avg(tryPts.slice(-3)) +
            "%) than in the full song (" +
            runPts[runPts.length - 1].s +
            "%). Try singing the line before it too, so you're ready when it comes."
          : runPts[runPts.length - 1].s - avg(tryPts.slice(-3)) >= 10
            ? "You sing it better in the full song than alone. The music around it helps you find the notes."
            : null
        : null;
    const prow = (x, a, b) =>
      html`<button
        key=${x.i}
        onClick=${() => onPractise(x.ph)}
        class="flex items-center gap-3"
        style=${{
          width: "100%",
          padding: "9px 0",
          borderTop: "1px solid var(--line)",
          background: "none",
          border: 0,
          borderTopStyle: "solid",
          borderTopWidth: 1,
          borderTopColor: "var(--line)",
          color: "var(--fg)",
          font: "inherit",
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <span class="mono text-xs muted" style=${{ width: 20 }}
          >${String(x.i + 1).padStart(2, "0")}</span
        >
        <span
          class="text-sm font-semibold"
          style=${{
            flex: 1,
            minWidth: 0,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          >${x.text || "Phrase " + (x.i + 1)}</span
        >
        <${Spark} vals=${x.hist.map((p) => p.s)} w=${56} h=${20} />
        <span class="mono text-xs" style=${{ whiteSpace: "nowrap" }}
          ><span class="muted">${a}</span> →
          <b style=${{ color: "var(--" + scoreTone(b) + ")" }}>${b}</b></span
        >
      </button>`;
    return html`<div class="flex flex-col gap-3">
      <div
        class="seg"
        role="group"
        aria-label="Analyze view"
        style=${{ display: "grid", gridTemplateColumns: "1fr 1fr" }}
      >
        <button
          aria-pressed=${view === "run" ? "true" : "false"}
          onClick=${() => setView("run")}
        >
          This run
        </button>
        <button
          aria-pressed=${view === "progress" ? "true" : "false"}
          onClick=${() => setView("progress")}
        >
          Progress
        </button>
      </div>
      ${view === "run" &&
      (!run
        ? html`<p class="text-sm muted">
            No whole-song run for this song yet. Sing it in Karaoke, or upload a
            recording above, and every line gets checked here.
          </p>`
        : html`<${React.Fragment}>
            <section class="panel p-4 flex items-center gap-3">
              <span
                class="flex flex-col gap-1"
                style=${{ flex: 1, minWidth: 0 }}
              >
                <span class="label"
                  >${(run.src || "Your run") + " · " + dayLabel(run.at)}</span
                >
                <span
                  class="display font-bold"
                  style=${{
                    fontSize: 28,
                    color: "var(--" + scoreTone(run.score) + ")",
                  }}
                  >${run.score}%${diff
                    ? html` <span
                        style=${{
                          fontSize: 14,
                          color: diff > 0 ? "var(--good)" : "var(--muted)",
                        }}
                        >${diff > 0 ? "▲ " + diff : "▼ " + -diff}</span
                      >`
                    : ""}</span
                >
                <span class="text-xs muted"
                  >${good} of ${sungItems.length} lines
                  good${weak
                    ? " · " + weak + " to work on"
                    : ""}${sungItems.length < phrases.length
                    ? " · " + (phrases.length - sungItems.length) + " not sung"
                    : ""}</span
                >
                ${(breathLines > 0 || cutLines > 0) &&
                html`<span class="text-xs muted"
                  >${[
                    breathLines
                      ? breathLines +
                        " line" +
                        (breathLines > 1 ? "s" : "") +
                        " with a mid-line breath"
                      : "",
                    cutLines ? cutLines + " ended short" : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}</span
                >`}
              </span>
              <${Spark} vals=${runs.map((r) => r.score)} w=${96} h=${40} />
            </section>
            ${planDraft &&
            html`<button
              class="link-btn text-sm"
              style=${{ alignSelf: "flex-start", textDecoration: "none" }}
              onClick=${onPlan}
            >
              ${planDraft.drills.length}
              drill${planDraft.drills.length > 1 ? "s" : ""} made from this run
              →
            </button>`}
            <div class="flex items-center justify-between">
              <span class="label"
                >${order === "weak"
                  ? "Work on these first"
                  : "Every line"}</span
              >
              <button
                class="link-btn text-xs"
                style=${{ textDecoration: "none", color: "var(--muted)" }}
                onClick=${() => setOrder(order === "weak" ? "song" : "weak")}
              >
                ${order === "weak" ? "Weakest first ▾" : "Song order ▾"}
              </button>
            </div>
            ${shown.map((x) => {
              const info = tryStats(x.rec);
              return html`<section
                key=${x.i}
                class="panel"
                style=${{
                  padding: "12px 14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  borderColor:
                    x.rec.score < 55
                      ? "color-mix(in srgb, var(--bad) 40%, var(--line))"
                      : undefined,
                }}
              >
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="mono text-xs muted"
                    >${String(x.i + 1).padStart(2, "0")} ·
                    ${fmt(x.ph.start)}</span
                  >
                  ${x.ph.tags.slice(0, 2).map(
                    (t) =>
                      html`<span
                        key=${t}
                        class="text-xs"
                        style=${{
                          padding: "2px 8px",
                          borderRadius: 999,
                          background: "var(--surface-2)",
                          color: "var(--muted)",
                          fontWeight: 600,
                        }}
                        >${t}</span
                      >`,
                  )}
                  <span
                    class="display font-bold"
                    style=${{
                      marginLeft: "auto",
                      fontSize: 20,
                      color: "var(--" + scoreTone(x.rec.score) + ")",
                    }}
                    >${x.rec.score}%</span
                  >
                </div>
                ${x.text &&
                html`<b style=${{ fontSize: 15, lineHeight: 1.3 }}
                  >${x.text}</b
                >`}
                <div
                  style=${{
                    padding: "6px 8px",
                    borderRadius: 10,
                    background: "var(--surface-2)",
                    border: "1px solid var(--line)",
                  }}
                >
                  <${TryChart} rec=${x.rec} notes=${notes} />
                </div>
                <${BtTags} tags=${btInfo(x.rec, notes, x.text).tags} />
                <div class="flex items-center gap-2">
                  <span class="text-xs" style=${{ flex: 1 }}>${info.tip}</span
                  ><${Spark} vals=${x.hist.map((p) => p.s)} />
                </div>
                <div class="flex items-center gap-2 flex-wrap">
                  <button
                    class="btn"
                    style=${{
                      padding: "5px 10px",
                      fontSize: 12,
                      color: "var(--you)",
                    }}
                    disabled=${!canHear}
                    onClick=${() => onHearMe(x.rec)}
                    title=${canHear
                      ? ""
                      : "The recording isn't kept after you leave"}
                  >
                    ▶ Me
                  </button>
                  <button
                    class="btn"
                    style=${{ padding: "5px 10px", fontSize: 12 }}
                    onClick=${() => onHearSong(x.ph)}
                  >
                    ▶ Song
                  </button>
                  <button
                    class="btn"
                    style=${{ padding: "5px 10px", fontSize: 12 }}
                    onClick=${() => setOpen(x.i)}
                  >
                    Details
                  </button>
                  <button
                    class="btn btn-primary"
                    style=${{
                      padding: "5px 10px",
                      fontSize: 12,
                      marginLeft: "auto",
                    }}
                    onClick=${() => onPractise(x.ph)}
                  >
                    Practise this line →
                  </button>
                </div>
              </section>`;
            })}
            ${!canHear &&
            html`<p class="text-xs muted">
              This is your last saved run. Recordings aren't kept after you
              leave, but the scores are.
            </p>`}
          <//>`)}
      ${view === "progress" &&
      html`<${React.Fragment}>
        <section class="panel p-4 flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <span class="label">Whole song</span>${runs.length >= 2 &&
            html`<span
              class="text-xs font-semibold"
              style=${{
                color:
                  runs[runs.length - 1].score >= runs[0].score
                    ? "var(--good)"
                    : "var(--muted)",
              }}
              >${runs[runs.length - 1].score >= runs[0].score
                ? "▲ "
                : "▼ "}${Math.abs(runs[runs.length - 1].score - runs[0].score)}
              since your first run</span
            >`}
          </div>
          <${SongTrend} runs=${runs} />
          <div class="grid grid-cols-3 gap-2" style=${{ marginTop: 4 }}>
            ${[
              ["Runs", runs.length, ""],
              ["Line tries", lineTries, ""],
              ["Lines good", linesGood + "/" + phrases.length, "good"],
            ].map(
              ([l, v, t]) =>
                html`<div
                  key=${l}
                  style=${{
                    padding: "8px 10px",
                    borderRadius: 12,
                    background: "var(--surface-2)",
                  }}
                >
                  <div class="label" style=${{ fontSize: 10 }}>${l}</div>
                  <b
                    class="display"
                    style=${{
                      fontSize: 18,
                      color: t ? "var(--" + t + ")" : undefined,
                    }}
                    >${v}</b
                  >
                </div>`,
            )}
          </div>
        </section>
        <section class="panel" style=${{ padding: "12px 14px 4px" }}>
          <div class="flex justify-between" style=${{ paddingBottom: 6 }}>
            <span class="label">Most improved</span
            ><span class="text-xs muted">first → now</span>
          </div>
          ${improved.length
            ? improved.map((x) => prow(x, x.hist[0].s, latest(x)))
            : html`<p class="text-xs muted" style=${{ paddingBottom: 10 }}>
                Lines that get 10+ points better show up here.
              </p>`}
        </section>
        <section class="panel" style=${{ padding: "12px 14px 4px" }}>
          <div class="flex justify-between" style=${{ paddingBottom: 6 }}>
            <span class="label">Still tricky</span>${tricky.length > 0 &&
            html`<button
              class="link-btn text-xs"
              style=${{ textDecoration: "none" }}
              onClick=${() => onPractise(tricky[0].ph)}
            >
              Practise ${tricky.length > 1 ? "the first one" : "it"} →
            </button>`}
          </div>
          ${tricky.length
            ? tricky.map((x) => prow(x, x.hist[0].s, latest(x)))
            : html`<p class="text-xs muted" style=${{ paddingBottom: 10 }}>
                No lines under 60% right now. Nice.
              </p>`}
        </section>
      <//>`}
      <${Sheet}
        open=${!!(openItem && openInfo)}
        title=${openItem
          ? openItem.text
            ? "“" + openItem.text + "”"
            : "Phrase " + (openItem.i + 1)
          : ""}
        onClose=${() => setOpen(null)}
      >
        ${openItem &&
        openInfo &&
        html`<div class="flex flex-col gap-3">
          <span class="text-sm muted"
            >Line ${openItem.i + 1} · this run ${openItem.rec.score}%</span
          >
          <div
            class="seg"
            role="group"
            aria-label="Details"
            style=${{ display: "grid", gridTemplateColumns: "1fr 1.4fr 1fr" }}
          >
            ${[
              ["notes", "Notes"],
              ["bt", "Breath & timing"],
              ["time", "Over time"],
            ].map(
              ([k, l]) =>
                html`<button
                  key=${k}
                  aria-pressed=${dtab === k ? "true" : "false"}
                  onClick=${() => setDtab(k)}
                >
                  ${l}
                </button>`,
            )}
          </div>
          ${dtab === "bt" &&
          html`<${BreathTimingView}
            rec=${openItem.rec}
            notes=${notes}
            text=${openItem.text}
          />`}
          ${dtab === "notes" &&
          html`<${React.Fragment}>
            <div
              style=${{
                padding: 10,
                borderRadius: 14,
                background: "var(--surface-2)",
                border: "1px solid var(--line)",
              }}
            >
              <${TryChart} rec=${openItem.rec} notes=${notes} />
              <div
                class="flex gap-4 text-xs muted"
                style=${{ padding: "4px 4px 0" }}
              >
                <span class="flex items-center gap-1"
                  ><span
                    style=${{
                      width: 14,
                      height: 6,
                      borderRadius: 3,
                      background: "var(--accent)",
                      opacity: 0.6,
                    }}
                  ></span
                  >Song</span
                >
                <span class="flex items-center gap-1"
                  ><span
                    style=${{
                      width: 14,
                      height: 3,
                      borderRadius: 2,
                      background: "var(--you)",
                    }}
                  ></span
                  >You</span
                >
              </div>
            </div>
            <div class="grid grid-cols-2 gap-2">
              ${openInfo.stats.map(
                (st) =>
                  html`<div
                    key=${st.label}
                    style=${{
                      padding: "10px 12px",
                      borderRadius: 12,
                      background: "var(--surface-2)",
                    }}
                  >
                    <div class="label" style=${{ fontSize: 10 }}>
                      ${st.label}
                    </div>
                    <div
                      class="display font-bold"
                      style=${{ fontSize: 18, color: "var(--" + st.tone + ")" }}
                    >
                      ${st.value}
                    </div>
                    <div class="text-xs muted">${st.note}</div>
                  </div>`,
              )}
            </div>
            <div
              class="flex items-start gap-2 text-sm"
              style=${{
                padding: "12px 14px",
                borderRadius: 14,
                background: "color-mix(in srgb, var(--accent) 8%, transparent)",
                border:
                  "1px solid color-mix(in srgb, var(--accent) 28%, transparent)",
              }}
            >
              <span aria-hidden="true">🎯</span
              ><span><b>Tip:</b> ${openInfo.tip}</span>
            </div>
          <//>`}
          ${dtab === "time" &&
          html`<div
            class="flex flex-col gap-2"
            style=${{
              padding: "12px 14px",
              borderRadius: 14,
              background: "var(--surface-2)",
              border: "1px solid var(--line)",
            }}
          >
            <div class="flex items-center justify-between flex-wrap gap-2">
              <span class="label">This line over time</span
              ><span class="text-xs muted"
                ><span style=${{ color: "var(--accent)" }}>●</span> whole-song
                runs <span style=${{ color: "var(--you)" }}>○</span> practice
                tries</span
              >
            </div>
            <${HistChart} pts=${openItem.hist} />
            ${insight && html`<span class="text-xs">${insight}</span>`}
          </div>`}
          <div class="grid grid-cols-2 gap-2">
            <button
              class="btn"
              style=${{ justifyContent: "center", minHeight: 46 }}
              disabled=${!canHear}
              onClick=${() => onHearMe(openItem.rec)}
            >
              ▶ Hear me
            </button>
            <button
              class="btn btn-primary"
              style=${{ justifyContent: "center", minHeight: 46 }}
              onClick=${() => {
                setOpen(null);
                onPractise(openItem.ph);
              }}
            >
              Practise this line →
            </button>
          </div>
        </div>`}
      <//>
    </div>`;
  }

  function Analyst({
    themeKey,
    active,
    orig,
    onPickOrig,
    lyrics,
    updateLyrics,
    incomingTake,
    lastTake,
    onUseTake,
    onPractice,
    onGo,
    inst,
    onPickInst,
    sync,
    keyWarn,
  }) {
    const [sub, setSub] = useState("overview");
    const [optOpen, setOptOpen] = useState(false);
    const [take, setTake] = useState(null);
    const [off, setOff] = useState(0);
    const [octaveFree, setOctaveFree] = useState(true);
    const [warp, setWarp] = useState(() =>
      loadJSON("pitchstaff.warp.v1", false),
    );
    useEffect(() => saveJSON("pitchstaff.warp.v1", warp), [warp]);
    const [keyFree, setKeyFree] = useState(false); // judge against the song's own key, like Practice does
    const [ks, setKs] = useState(0);
    const [plain, setPlain] = useState(() => {
      try {
        return localStorage.getItem("pitchstaff.plain") !== "0";
      } catch (e) {
        return true;
      }
    });
    const choosePlain = (v) => {
      setPlain(v);
      try {
        localStorage.setItem("pitchstaff.plain", v ? "1" : "0");
      } catch (e) {}
    };
    const [mix, setMix] = useState(() => {
      try {
        const v = JSON.parse(localStorage.getItem(MIX_KEY) || "null");
        if (v && typeof v.o === "number") return { m: 0, ...v };
      } catch (e) {}
      return { o: 0.8, g: 0, t: 0.9, m: 0 };
    });
    const mixRef = useRef(mix);
    const [loop, setLoop] = useState(null);
    const loopRef = useRef(null);
    const [playing, setPlaying] = useState(false);
    const [cursor, setCursor] = useState(null);
    const [sessions, setSessions] = useState(loadSessions);
    const [saved, setSaved] = useState(false);
    const [confirmClear, setConfirmClear] = useState(false);
    const play = useRef({
      ctx: null,
      origSrc: null,
      takeSrc: null,
      startCtx: 0,
      t0: 0,
      takeT0: 0,
      takeStart: 0,
      raf: 0,
      lastCt: 0,
    });
    const jobs = useRef({ orig: 0, take: 0 });

    useEffect(() => {
      try {
        localStorage.setItem(SESS_KEY, JSON.stringify(sessions));
      } catch (e) {}
    }, [sessions]);

    const stopPlay = useCallback(() => {
      const p = play.current;
      cancelAnimationFrame(p.raf);
      [p.origSrc, p.takeSrc, p.musicSrc, ...(p.guide || [])].forEach((s) => {
        if (s) {
          s.onended = null;
          try {
            s.stop();
          } catch (e) {}
        }
      });
      [p.gO, p.gG, p.gT, p.gM].forEach((g) => {
        if (g) {
          try {
            g.disconnect();
          } catch (e) {}
        }
      });
      p.origSrc = null;
      p.takeSrc = null;
      p.musicSrc = null;
      p.guide = [];
      p.gO = p.gG = p.gT = p.gM = null;
      setPlaying(false);
    }, []);
    useEffect(
      () => () => {
        stopPlay();
        if (play.current.ctx) play.current.ctx.close().catch(() => {});
      },
      [stopPlay],
    );

    const pick = useCallback(
      async (which, file) => {
        const setter = setTake;
        const job = ++jobs.current[which];
        stopPlay();
        setCursor(null);
        setSaved(false);
        setter({ name: file.name, busy: true, progress: 0 });
        let buffer, data;
        try {
          buffer = await decodeFile(file);
        } catch (e) {
          if (jobs.current[which] === job)
            setter({
              name: file.name,
              error:
                "That file couldn't be read as audio. Try an MP3, M4A or WAV.",
            });
          return;
        }
        data = await trackPitch(
          buffer,
          (pr) => {
            if (jobs.current[which] === job)
              setter((s) => (s ? { ...s, progress: pr } : s));
          },
          () => jobs.current[which] !== job,
        );
        if (!data || jobs.current[which] !== job) return;
        setter({ name: file.name, buffer, data });
      },
      [stopPlay],
    );
    // a take recorded in Karaoke arrives already as audio
    useEffect(() => {
      if (!incomingTake) return;
      const job = ++jobs.current.take;
      stopPlay();
      setCursor(null);
      setSaved(false);
      setTake({ name: incomingTake.name, busy: true, progress: 0 });
      (async () => {
        const data = await trackPitch(
          incomingTake.buffer,
          (pr) => {
            if (jobs.current.take === job)
              setTake((s) => (s ? { ...s, progress: pr } : s));
          },
          () => jobs.current.take !== job,
        );
        if (!data || jobs.current.take !== job) return;
        setTake({ name: incomingTake.name, buffer: incomingTake.buffer, data });
      })();
    }, [incomingTake && incomingTake.id]);

    const ready = orig && orig.data && take && take.data;

    // auto-align whenever a new pair is ready
    const realign = useCallback(() => {
      if (!ready) return;
      const r = detectKeyAndOffset(orig.data, take.data, keyFree);
      setKs(r.ks);
      setOff(r.off);
    }, [ready, orig, take, keyFree]);
    useEffect(() => {
      realign();
    }, [realign]);
    useEffect(() => {
      loopRef.current = null;
      setLoop(null);
    }, [orig, take]);
    useEffect(() => {
      stopPlay();
      setCursor(null);
      setSaved(false);
    }, [orig, stopPlay]);
    useEffect(() => {
      if (!active) stopPlay();
    }, [active, stopPlay]);

    const alignment = useMemo(() => {
      if (!ready) return null;
      const w = warp ? warpTake(orig.data, take.data, off, ks) : null;
      return { map: w || fixedMap(orig.data.grid.length, off), warped: !!w };
    }, [ready, orig, take, warp, off, ks]);
    const result = useMemo(
      () =>
        alignment
          ? compare(
              orig.data,
              take.data,
              alignment.map,
              octaveFree,
              alignment.warped,
              off,
              ks,
            )
          : null,
      [alignment, octaveFree, ks],
    );
    const phraseStarts = useMemo(() => {
      if (!ready) return [];
      const a = orig.data.grid,
        out = [];
      let sil = 99;
      for (let k = 0; k < a.length; k++) {
        if (a[k] !== a[k]) sil++;
        else {
          if (sil >= 12) out.push(k * GRID);
          sil = 0;
        }
      }
      return out;
    }, [ready, orig]);
    useEffect(() => setSaved(false), [off, octaveFree, warp, ks]);

    const startPlay = (t) => {
      if (!result) return;
      stopPlay();
      const p = play.current,
        mx = mixRef.current,
        loop = loopRef.current;
      if (!p.ctx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        p.ctx = new Ctx();
      }
      const ctx = p.ctx;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const hasMusic = !!(inst && inst.buffer);
      const map = result.map,
        takeOnly = mx.o === 0 && mx.g === 0 && !(hasMusic && (mx.m || 0) > 0);
      let end = takeOnly
        ? invTime(map, take.data.duration)
        : orig.data.duration;
      if (loop) {
        end = Math.min(end, loop.b);
        if (t < loop.a - 0.5 || t >= loop.b) t = loop.a - 0.3;
      }
      if (t >= end - 0.05 || t < 0) t = loop ? Math.max(0, loop.a - 0.3) : 0;
      const now = ctx.currentTime + 0.05;
      const bus = (v) => {
        const g = ctx.createGain();
        g.gain.value = v;
        g.connect(ctx.destination);
        return g;
      };
      p.gO = bus(mx.o);
      p.gG = bus(mx.g);
      p.gT = bus(mx.t);
      p.gM = bus(mx.m || 0);
      const make = (buf, at, when, dest) => {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(dest);
        if (at >= 0) src.start(when, at);
        else src.start(when - at, 0);
        return src;
      };
      const startTake = (at, when) => {
        if (p.takeSrc) {
          try {
            p.takeSrc.stop();
          } catch (e) {}
        }
        p.takeSrc = make(take.buffer, at, when, p.gT);
        p.takeT0 = at;
        p.takeStart = when;
      };
      if (!takeOnly) {
        p.origSrc = make(orig.buffer, t, now, p.gO);
        if (hasMusic)
          p.musicSrc = make(inst.buffer, t + (sync || 0), now, p.gM);
        p.guide = scheduleGuide(
          ctx,
          p.gG,
          orig.data.notes,
          t,
          end,
          now,
          result.shift,
        );
      }
      startTake(mapTime(map, t), now);
      p.startCtx = now;
      p.t0 = t;
      p.lastCt = t;
      p.takeOnly = takeOnly;
      setPlaying(true);
      const tick = () => {
        const ct = takeOnly
          ? invTime(map, p.takeT0 + Math.max(0, ctx.currentTime - p.takeStart))
          : p.t0 + Math.max(0, ctx.currentTime - p.startCtx);
        if (ct >= end) {
          if (loopRef.current) {
            startPlay(Math.max(0, loopRef.current.a - 0.3));
            return;
          }
          stopPlay();
          setCursor(end);
          return;
        }
        // keep your take in step with the original: re-sync at each phrase start
        if (!takeOnly && result.dev) {
          for (const ps of phraseStarts) {
            if (ps > p.lastCt && ps <= ct) {
              const exp = mapTime(map, ct),
                act = p.takeT0 + (ctx.currentTime - p.takeStart);
              if (Math.abs(exp - act) > 0.08) startTake(exp, ctx.currentTime);
              break;
            }
          }
        }
        p.lastCt = ct;
        setCursor(Math.max(0, ct));
        p.raf = requestAnimationFrame(tick);
      };
      tick();
    };
    const seek = (t) => {
      setCursor(t);
      if (playing) startPlay(t);
    };
    const setVol = (key, v) => {
      const next = { ...mixRef.current, [key]: v };
      const wasTakeOnly = play.current.takeOnly;
      mixRef.current = next;
      setMix(next);
      try {
        localStorage.setItem(MIX_KEY, JSON.stringify(next));
      } catch (e) {}
      const p = play.current,
        node = { o: p.gO, g: p.gG, t: p.gT, m: p.gM }[key];
      if (node && p.ctx) node.gain.setTargetAtTime(v, p.ctx.currentTime, 0.02);
      const hasMusic = !!(inst && inst.buffer);
      if (
        playing &&
        (next.o === 0 && next.g === 0 && !(hasMusic && (next.m || 0) > 0)) !==
          wasTakeOnly
      )
        startPlay(cursor || 0);
    };
    const startLoop = (a, b) => {
      const lp = { a: Math.max(0, a), b };
      loopRef.current = lp;
      setLoop(lp);
      setCursor(Math.max(0, a - 0.3));
      startPlay(Math.max(0, a - 0.3));
    };
    const clearLoop = () => {
      loopRef.current = null;
      setLoop(null);
    };
    const nudge = (frames) => {
      setOff((o) => o + frames);
      if (playing) stopPlay();
    };

    const saveAttempt = () => {
      if (!result) return;
      setSessions((s) =>
        [
          {
            id: Date.now(),
            t: Date.now(),
            song: orig.name,
            take: take.name,
            score: result.score,
            inTune: result.inTune,
            tendency: result.tendency,
            timing: result.timing,
            drift: result.drift,
            coverage: result.coverage,
          },
          ...s,
        ].slice(0, 200),
      );
      setSaved(true);
    };

    const spans = useMemo(
      () => (orig && orig.data ? lyricSpans(lyrics, orig.data.duration) : []),
      [lyrics, orig],
    );
    const curLine =
      cursor != null
        ? spans.findIndex((l) => cursor >= l.start && cursor < l.end)
        : -1;
    const nextLine =
      cursor != null ? spans.find((l) => l.start > (cursor || 0)) : spans[0];
    const linesIn = (a, b) =>
      spans.filter((l) => l.start < b && l.end > a).map((l) => l.text);
    const planDraft = useMemo(
      () =>
        result && orig && orig.data
          ? makePlan(
              result.rows,
              orig.data.notes,
              spans,
              buildPhrases(orig.data.notes, spans, orig.data.grid),
              "take",
            )
          : null,
      [result, spans],
    );
    // ---- line-by-line runs ----
    const songName = orig && orig.data ? orig.name : null;
    const phrasesA = useMemo(
      () =>
        orig && orig.data
          ? buildPhrases(orig.data.notes, spans, orig.data.grid)
          : [],
      [orig, spans],
    );
    const liveRun = useMemo(
      () =>
        ready && alignment
          ? analyzeRun(orig.data, phrasesA, take.data, alignment.map)
          : null,
      [ready, alignment, phrasesA],
    );
    const [runs, setRuns] = useState([]);
    const [lastRun, setLastRun] = useState(null);
    const [triesA, setTriesA] = useState({});
    const [runMeta, setRunMeta] = useState(null);
    useEffect(() => {
      setRuns(loadRuns(songName));
      setLastRun(loadLastRun(songName));
      setTriesA(loadTries(songName));
    }, [songName, active]);
    const savedRunFor = useRef(null);
    useEffect(() => {
      if (!liveRun || !songName || !take || !take.data) return;
      const key = songName + "|" + take.name + "|" + take.data.duration;
      if (savedRunFor.current === key) return;
      savedRunFor.current = key;
      const meta = {
        at: Date.now(),
        src: /^Karaoke take/.test(take.name) ? "Karaoke run" : "Your recording",
      };
      const lines = {};
      liveRun.lines.forEach((r, i) => {
        if (r) lines[i] = r.score;
      });
      if (!Object.keys(lines).length) return;
      setRuns(addRun(songName, { ...meta, score: liveRun.score, lines }));
      const full = { ...meta, score: liveRun.score, lines: liveRun.lines };
      saveLastRun(songName, full);
      setLastRun(full);
      setRunMeta(meta);
    }, [liveRun, songName]);
    const shownRun =
      liveRun && runMeta
        ? { ...runMeta, score: liveRun.score, lines: liveRun.lines }
        : lastRun;
    const playClip = (buffer, a, b) => {
      if (!buffer) return;
      stopPlay();
      const p = play.current;
      if (!p.ctx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        p.ctx = new Ctx();
      }
      if (p.ctx.state === "suspended") p.ctx.resume().catch(() => {});
      const src = p.ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(p.ctx.destination);
      const st = Math.max(0, a);
      src.start(0, st, Math.max(0.2, Math.min(b, buffer.duration) - st));
      p.origSrc = src;
      setPlaying(true);
      src.onended = () => {
        if (p.origSrc === src) {
          p.origSrc = null;
          setPlaying(false);
        }
      };
    };
    const hasInst = !!(inst && inst.buffer);
    const listenMode =
      mix.t > 0 && mix.o === 0 && !(mix.m > 0)
        ? "me"
        : mix.t === 0
          ? "song"
          : "both";
    const chooseListen = (k) => {
      const next =
        k === "me"
          ? { o: 0, g: 0, t: 1, m: 0 }
          : k === "song"
            ? { o: 0.85, g: 0, t: 0, m: hasInst ? 0.8 : 0 }
            : { o: hasInst ? 0 : 0.45, g: 0, t: 1, m: hasInst ? 0.7 : 0 };
      mixRef.current = next;
      setMix(next);
      try {
        localStorage.setItem(MIX_KEY, JSON.stringify(next));
      } catch (e) {}
      if (playing) startPlay(cursor || 0);
    };

    const offSec = off * GRID;
    const past = orig ? sessions.filter((s) => s.song === orig.name) : sessions;
    const bestScore = past.reduce((m, s) => Math.max(m, s.score), -1);
    const curNote =
      result && cursor != null
        ? result.rows.find((r) => cursor >= r.n.pos && cursor < r.n.end)
        : null;
    const tech = useMemo(
      () => (result ? technique(orig.data, take.data, result) : []),
      [result],
    );

    const subs = [
      ["overview", "Overview"],
      ["chart", "Chart"],
      ["notes", "Notes"],
      ["technique", "Technique"],
      ["history", "History"],
    ];
    const takeIsFromKaraoke =
      take && take.name && /^Karaoke take/.test(take.name);
    return html`<div class="flex flex-col gap-4">
      ${!(take && (take.data || take.busy))
        ? html`<section class="flex flex-col gap-3">
            <div class="empty-hero">
              <h2 class="display text-2xl font-bold">Check a whole-song run</h2>
              <p class="muted text-sm">
                Use your last Karaoke take or upload a recording of you singing
                this song. Every line gets checked, weakest first.
              </p>
            </div>
            ${lastTake &&
            html`<button
              class="file-row"
              style=${{
                cursor: "pointer",
                textAlign: "left",
                color: "var(--fg)",
                font: "inherit",
              }}
              onClick=${() => onUseTake && onUseTake(lastTake)}
            >
              <span class="song-ico"><${Icon} name="mic" /></span>
              <span class="flex flex-col min-w-0" style=${{ flex: 1 }}
                ><span class="font-semibold">Use my last Karaoke take</span
                ><span class="text-xs muted"
                  >${lastTake.name.replace(
                    /^Karaoke take · /,
                    "Recorded ",
                  )}</span
                ></span
              >
              <span
                class="btn btn-primary"
                style=${{ padding: "6px 14px", fontSize: 13 }}
                >Use</span
              >
            </button>`}
            <div class="grid gap-4">
              <${UploadSlot}
                id="take-file"
                step=${lastTake ? "or" : "1"}
                title="Upload a recording"
                hint="A recording of you singing the same part, like a Voice Memo. Record somewhere quiet, ideally with headphones so the music isn't picked up."
                slot=${take}
                onPick=${(f) => pick("take", f)}
              />
            </div>
            ${!lastTake &&
            html`<p class="text-xs muted">
              Tip: sing in Karaoke with headphones and your take comes straight
              here.
            </p>`}
          </section>`
        : html`<div class="flex items-center gap-3">
            <span class="song-ico"><${Icon} name="mic" /></span>
            <span class="flex flex-col min-w-0" style=${{ flex: 1 }}>
              <span
                class="font-semibold text-sm"
                style=${{ overflowWrap: "anywhere" }}
                >${take.name}</span
              >
              <span class="text-xs muted"
                >${take.busy
                  ? "Analyzing " + Math.round((take.progress || 0) * 100) + "%"
                  : result && result.range && !result.range.whole
                    ? "Sung " +
                      fmt(result.range.start) +
                      "–" +
                      fmt(result.range.end)
                    : "Your singing"}</span
              >
            </span>
            <button
              class="btn"
              style=${{ padding: "7px 14px", fontSize: 13 }}
              onClick=${() => {
                stopPlay();
                setTake(null);
              }}
            >
              Change take
            </button>
          </div>`}
      ${ready &&
      result &&
      html`<section class="flex flex-col gap-2">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <span class="label">Whole take</span>
          <div class="seg" role="group" aria-label="Listen to">
            ${[
              ["me", "Me"],
              ["song", "Song"],
              ["both", "Both"],
            ].map(
              ([k, l]) =>
                html`<button
                  key=${k}
                  aria-pressed=${listenMode === k ? "true" : "false"}
                  onClick=${() => chooseListen(k)}
                >
                  ${l}
                </button>`,
            )}
          </div>
        </div>
        <${RollChart}
          orig=${orig.data}
          take=${take.data}
          result=${result}
          cursor=${cursor}
          onSeek=${seek}
          themeKey=${themeKey}
          lyrics=${spans}
          loop=${loop}
        />
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs muted">
          <span class="flex items-center gap-1"
            ><span
              style=${{
                display: "inline-block",
                width: 16,
                height: 6,
                borderRadius: 3,
                background: "var(--fg)",
                opacity: 0.3,
              }}
            ></span
            >Song</span
          >
          <span class="flex items-center gap-1"
            ><span
              style=${{
                display: "inline-block",
                width: 16,
                height: 3,
                background: "var(--good)",
              }}
            ></span
            >You, right</span
          >
          <span class="flex items-center gap-1"
            ><span
              style=${{
                display: "inline-block",
                width: 16,
                height: 3,
                background: "var(--warn)",
              }}
            ></span
            >A bit off ↑↓</span
          >
          <span class="flex items-center gap-1"
            ><span
              style=${{
                display: "inline-block",
                width: 16,
                height: 3,
                background: "var(--bad)",
              }}
            ></span
            >Other note (yours in red)</span
          >
          <span>Tap the chart to jump there.</span>
        </div>
        <div class="playbar">
          <button
            class="round-btn primary"
            onClick=${() => (playing ? stopPlay() : startPlay(cursor || 0))}
            aria-label=${playing ? "Pause" : "Play"}
          >
            <${Icon} name=${playing ? "pause" : "play"} />
          </button>
          <span class="flex flex-col gap-1 min-w-0" style=${{ flex: 1 }}>
            <input
              id="an-seek"
              type="range"
              min="0"
              max=${orig.data.duration}
              step="0.1"
              value=${cursor || 0}
              onChange=${(e) => seek(parseFloat(e.target.value))}
              aria-label="Position in the song"
            />
            <span class="flex justify-between gap-2 mono text-xs muted"
              ><span>${fmt(cursor || 0)} / ${fmt(orig.data.duration)}</span
              ><span
                >${listenMode === "me"
                  ? "Just me"
                  : listenMode === "song"
                    ? "The song"
                    : "Me + the song"}</span
              ></span
            >
          </span>
        </div>
      </section>`}
      ${orig &&
      orig.data &&
      html`<${AnalyzeView}
        songName=${songName}
        notes=${orig.data.notes}
        phrases=${phrasesA}
        spans=${spans}
        run=${shownRun}
        runs=${runs}
        tries=${triesA}
        canHear=${!!(liveRun && runMeta && take && take.buffer)}
        onHearMe=${(rec) =>
          take && rec.clip && playClip(take.buffer, rec.clip[0], rec.clip[1])}
        onHearSong=${(ph) =>
          playClip(orig.buffer, ph.start - 0.3, ph.end + 0.3)}
        onPractise=${(ph) => {
          stopPlay();
          onPractice && onPractice(ph.start, ph.end, true);
        }}
        planDraft=${liveRun ? planDraft : null}
        onPlan=${() => {
          stopPlay();
          savePlan(orig.name, planDraft);
          onGo && onGo("learn");
        }}
      />`}
    </div>`;
  }

  /* ---------- shared song pieces ---------- */
  function LyricsCard({ orig, lyrics, updateLyrics, count, hint, musicName }) {
    const [find, setFind] = useState(null); // { q, busy, results, msg }
    const [lineMsg, setLineMsg] = useState("");
    const [err, setErr] = useState("");
    const ref = useRef(null);
    const origName = orig && orig.data ? orig.name : null;
    useEffect(() => {
      setErr("");
      setLineMsg("");
      setFind(null);
    }, [origName]);
    const dur = orig && orig.data ? orig.data.duration : 0;
    const runFind = async (q) => {
      if (!q) return;
      setFind({ q, busy: true });
      try {
        const r = await findLyrics(q, dur);
        setFind({
          q,
          results: r.synced,
          msg: r.synced.length
            ? ""
            : r.plainOnly
              ? "Found lyrics, but without timing. Tono needs timed lyrics. Try another search or upload a file."
              : "No timed lyrics found. Try fewer words, like just the title, or upload a file.",
        });
      } catch (e) {
        setFind({
          q,
          results: [],
          msg: "Couldn't reach the lyrics library. Check your connection, or upload a lyrics file.",
        });
      }
    };
    // search once by itself when a new song has no lyrics yet
    useEffect(() => {
      if (origName && !lyrics) runFind(cleanSongName(origName));
    }, [origName]);
    const useFound = (x) => {
      const lines = parseLrc(x.syncedLyrics || "");
      if (!lines.filter((l) => l.text).length) {
        setErr("Those lyrics couldn't be read.");
        return;
      }
      const sh =
        orig && orig.data ? bestLyricShift(lines, orig.data.notes) : null;
      const offset = sh && sh.sure ? sh.off : 0;
      updateLyrics({
        name: x.trackName + " · " + x.artistName,
        lines,
        offset,
        from: "lrclib",
      });
      setFind(null);
      setLineMsg(
        offset
          ? "Lined up with the singing (shifted " +
              signed(offset.toFixed(2)) +
              " s). Nudge below if it's still off."
          : "Added. Check the timing in Practice; nudge below if it's off.",
      );
    };
    const lineUp = () => {
      if (!lyrics || !orig || !orig.data) return;
      const sh = bestLyricShift(lyrics.lines, orig.data.notes);
      if (sh && Math.abs(sh.off - lyrics.offset) < 0.2)
        setLineMsg("These lyrics already line up with the singing.");
      else if (sh && sh.sure) {
        updateLyrics({ ...lyrics, offset: sh.off });
        setLineMsg(
          "Lined up with the singing (shift " +
            signed(sh.off.toFixed(2)) +
            " s).",
        );
      } else
        setLineMsg(
          "Couldn't find a clear match. These lyrics may be from a different version. Use the shift buttons.",
        );
    };
    const pickLyrics = async (file) => {
      setErr("");
      let text = "";
      try {
        text = await file.text();
      } catch (e) {
        setErr("That file couldn't be read.");
        return;
      }
      if (/^\s*#(TITLE|ARTIST|BPM|GAP|MP3|AUDIO|VERSION)\s*:/im.test(text)) {
        const us = parseUltraStar(text);
        if (!us || !us.lines.length) {
          setErr(
            "This looks like an UltraStar file, but no notes were found in it.",
          );
          return;
        }
        updateLyrics({
          name: file.name,
          lines: us.lines,
          offset: 0,
          us: us.notes.map((n) => [
            n.midi,
            Math.round(n.pos * 1000) / 1000,
            Math.round(n.end * 1000) / 1000,
            { silence: 0, dip: 1, pitch: 2 }[n.cut],
          ]),
        });
        return;
      }
      const lines = parseLrc(text);
      if (!lines.filter((l) => l.text).length) {
        setErr(
          "No timed lines found. Use an .lrc file (lines like [00:12.30] followed by the words) or an UltraStar .txt file.",
        );
        return;
      }
      updateLyrics({ name: file.name, lines, offset: 0 });
    };
    const [expMsg, setExpMsg] = useState("");
    const exportUs = async () => {
      if (!orig || !orig.data) return;
      const spans = lyricSpans(lyrics, orig.data.duration);
      const base =
        (orig.name || "song")
          .replace(/\.[^.]+$/, "")
          .replace(/[\\/:*?"<>|]+/g, "")
          .trim() || "song";
      const parts = base.split(/\s+-\s+/);
      const txt = toUltraStar({
        title: parts.length > 1 ? parts.slice(1).join(" - ") : base,
        artist: parts.length > 1 ? parts[0] : "",
        audio: orig.name,
        instrumental: musicName,
        notes: orig.data.notes,
        spans,
      });
      try {
        await saveBlob(new Blob([txt], { type: "text/plain" }), base + ".txt");
        setExpMsg("Saved.");
      } catch (e) {
        setExpMsg(
          e && e.code === "declined"
            ? "Save cancelled."
            : "Saving isn't available here.",
        );
      }
    };
    const btn = { padding: "5px 10px", fontSize: 13 };
    return html`<div class="panel p-4 flex flex-wrap items-center gap-3">
      <div class="flex-1 min-w-0" style=${{ minWidth: 200 }}>
        <span class="label">Optional</span>
        <h3 class="display text-lg font-bold">
          Timed lyrics (.lrc or UltraStar .txt)
        </h3>
        ${lyrics
          ? html`<p class="text-sm" style=${{ overflowWrap: "anywhere" }}>
              <b>${lyrics.name}</b>
              <span class="muted mono text-xs"
                >· ${count}
                lines${lyrics.us ? " · exact notes from the chart" : ""} · saved
                for this song</span
              >
            </p>`
          : html`<p class="muted text-sm">
              ${origName
                ? hint
                : "Upload the song first, then add its lyrics file."}
            </p>`}
        ${err &&
        html`<p class="text-sm" style=${{ color: "var(--bad)" }}>${err}</p>`}
        ${lyrics &&
        orig &&
        orig.data &&
        html`<p class="text-xs muted" style=${{ marginTop: 4 }}>
          <button class="link-btn" onClick=${exportUs}>
            Save as UltraStar file</button
          >${expMsg
            ? " · " + expMsg
            : " · plays in UltraStar and other karaoke games"}
        </p>`}
        ${lyrics &&
        orig &&
        orig.data &&
        !lyrics.us &&
        html`<p class="text-xs muted" style=${{ marginTop: 4 }}>
          <button class="link-btn" onClick=${lineUp}>
            Line up with the singing</button
          >${lineMsg ? " · " + lineMsg : ""}
        </p>`}
      </div>
      ${lyrics &&
      html`<div class="flex items-center gap-2">
        <button
          class="btn"
          style=${btn}
          onClick=${() =>
            updateLyrics({
              ...lyrics,
              offset: Math.round((lyrics.offset - 0.25) * 100) / 100,
            })}
        >
          −0.25 s
        </button>
        <span
          class="mono text-xs"
          style=${{ minWidth: 92, textAlign: "center" }}
          >${lyrics.offset === 0
            ? "No shift"
            : "Shift " + signed(lyrics.offset.toFixed(2)) + " s"}</span
        >
        <button
          class="btn"
          style=${btn}
          onClick=${() =>
            updateLyrics({
              ...lyrics,
              offset: Math.round((lyrics.offset + 0.25) * 100) / 100,
            })}
        >
          +0.25 s
        </button>
        <button
          class="btn btn-ghost"
          style=${btn}
          onClick=${() => updateLyrics(null)}
        >
          Remove
        </button>
      </div>`}
      <button
        class=${"btn" + (lyrics ? "" : " btn-primary")}
        disabled=${!origName}
        onClick=${() => runFind(find ? find.q : cleanSongName(origName))}
      >
        Find lyrics
      </button>
      <button
        class="btn"
        disabled=${!origName}
        onClick=${() => ref.current && ref.current.click()}
      >
        ${lyrics ? "Replace with a file" : "Upload a file"}
      </button>
      ${find &&
      html`<div class="flex flex-col gap-2" style=${{ flexBasis: "100%" }}>
        <form
          class="flex gap-2"
          onSubmit=${(e) => {
            e.preventDefault();
            runFind(e.target.elements.q.value.trim());
          }}
        >
          <input
            name="q"
            class="input"
            aria-label="Search lyrics"
            defaultValue=${find.q}
            key=${find.q}
            style=${{
              flex: 1,
              minWidth: 0,
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid var(--line)",
              background: "var(--surface-2)",
              color: "var(--fg)",
            }}
          />
          <button class="btn" type="submit" disabled=${find.busy}>
            ${find.busy ? "Searching…" : "Search"}
          </button>
        </form>
        ${find.msg && html`<p class="text-xs muted">${find.msg}</p>`}
        ${(find.results || []).map((x) => {
          const d = dur && x.duration ? x.duration - dur : null;
          return html`<div
            key=${x.id}
            class="file-row"
            style=${{ padding: "8px 12px" }}
          >
            <span class="flex flex-col min-w-0" style=${{ flex: 1 }}>
              <span
                class="text-sm font-semibold"
                style=${{ overflowWrap: "anywhere" }}
                >${x.trackName}</span
              >
              <span class="text-xs muted" style=${{ overflowWrap: "anywhere" }}
                >${x.artistName}${x.duration
                  ? " · " + fmt(x.duration)
                  : ""}${d == null
                  ? ""
                  : Math.abs(d) <= 3
                    ? " · same length as your song"
                    : " · " +
                      Math.round(Math.abs(d)) +
                      " s " +
                      (d > 0 ? "longer" : "shorter")}</span
              >
            </span>
            <button
              class="btn"
              style=${{ padding: "5px 12px", fontSize: 13 }}
              onClick=${() => useFound(x)}
            >
              Use
            </button>
          </div>`;
        })}
        ${!find.busy &&
        html`<p class="text-xs muted">
          Timed lyrics from
          <a
            href="https://lrclib.net"
            target="_blank"
            rel="noopener"
            style=${{ color: "var(--accent)" }}
            >LRCLIB</a
          >, a free community library.
        </p>`}
      </div>`}
      <input
        ref=${ref}
        type="file"
        class="hidden"
        onChange=${(e) => {
          const f = e.target.files && e.target.files[0];
          e.target.value = "";
          if (f) pickLyrics(f);
        }}
      />
    </div>`;
  }

  /* ---------- sing-back scoring (Learn) ---------- */
  const BEST_KEY = "pitchstaff.phrasebest.v1";
  const LEARNED_KEY = "pitchstaff.learned.v1";

  // ---- Practice: song sheet, the notes for every lyric line ----
  function lineTags(ln, songLo, songHi) {
    const g = ln.notes,
      tags = [];
    if (!g.length) return tags;
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
    const wide = songHi - songLo >= 7;
    if (wide && g.some((n) => n.midi >= songHi - 1)) tags.push("High note");
    if (wide && g.some((n) => n.midi <= songLo + 1)) tags.push("Low note");
    if (g.some((n) => n.end - n.pos >= 1.5)) tags.push("Long hold");
    return tags;
  }
  function SongSheet({
    notes,
    spans,
    phrases,
    tr,
    nameOf,
    names,
    onNames,
    cursor,
    curIdx,
    playing,
    onPlayLine,
    onLoop,
    loop,
    lineInfo,
    onMe,
    you,
    onAnalyze,
    onPlayRange,
    onSaveWords,
    scrollLine,
  }) {
    const [open, setOpen] = useState(-1);
    const timeRef = useRef(0);
    timeRef.current = cursor || 0;
    const refs = useRef({});
    useEffect(() => {
      if (!scrollLine || scrollLine.k < 0) return;
      const el = refs.current[scrollLine.k];
      if (el && el.scrollIntoView)
        setTimeout(
          () => el.scrollIntoView({ block: "center", behavior: "smooth" }),
          60,
        );
    }, [scrollLine && scrollLine.id]);
    const short = (m) => nameOf(m).replace(/-?\d+$/, "");
    const tl = useMemo(() => looksTagalog(spans), [spans]);
    const lines = useMemo(() => {
      const src = spans.length
        ? spans
        : phrases.map((p) => ({
            start: p.start,
            end: p.end,
            text: "",
            words: null,
          }));
      return src.map((l, li) => {
        const idx = [];
        notes.forEach((n, i) => {
          if (n.pos >= l.start - 0.08 && n.pos < l.end - 0.02) idx.push(i);
        });
        const ln = { ...l, li, idx, notes: idx.map((i) => notes[i]) };
        if (!(l.words && l.words.length) && l.text && idx.length) {
          const m = wordsToNotes(
            l.text,
            idx.map((i) => notes[i]),
            tl,
          );
          if (m) {
            ln.wordNotes = m.map((x) => ({
              w: x.w,
              idx: x.idx.map((j) => idx[j]),
            }));
            ln.guessed = true;
          }
        }
        // real word timing from the lyrics file (or your taps) wins
        if (l.words && l.words.length && idx.length) {
          ln.wordNotes = l.words.map((w, k) => {
            const end = k + 1 < l.words.length ? l.words[k + 1].t : l.end;
            const mine = idx.filter(
              (i) => notes[i].pos >= w.t - 0.08 && notes[i].pos < end - 0.02,
            );
            return { w: w.w, idx: mine };
          });
        }
        return ln;
      });
    }, [notes, spans, phrases, tl]);
    let songLo = 999,
      songHi = 0;
    notes.forEach((n) => {
      songLo = Math.min(songLo, n.midi);
      songHi = Math.max(songHi, n.midi);
    });
    const cur =
      cursor != null
        ? lines.findIndex((l) => cursor >= l.start - 0.05 && cursor < l.end)
        : -1;
    useEffect(() => {
      if (!playing || cur < 0) return;
      const el = refs.current[cur];
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.top < 90 || r.bottom > window.innerHeight - 170) {
        try {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
        } catch (e) {}
      }
    }, [cur, playing]);
    const youChip = (i) => {
      const r = you && you[i];
      if (!r)
        return html`<span
          class="mono"
          style=${{
            fontSize: 12,
            padding: "3px 6px",
            color: "var(--muted)",
            minWidth: 18,
            textAlign: "center",
          }}
        >
        </span>`;
      const st =
        r.c == null
          ? "miss"
          : Math.abs(r.c) <= 25
            ? "good"
            : Math.abs(r.c) <= 50
              ? "warn"
              : "bad";
      const label =
        r.c == null
          ? "–"
          : st === "bad"
            ? short(r.m + Math.round(r.c / 100))
            : short(r.m) + (st === "warn" ? (r.c < 0 ? "↓" : "↑") : "");
      const col = st === "miss" ? "var(--muted)" : "var(--" + st + ")";
      const tip =
        r.c == null
          ? "Not heard"
          : "You sang " +
            pretty(midiInfo(r.m + Math.round(r.c / 100)).label) +
            (Math.abs(r.c - 100 * Math.round(r.c / 100)) > 10
              ? ", " +
                Math.abs(r.c - 100 * Math.round(r.c / 100)) +
                "¢ " +
                (r.c - 100 * Math.round(r.c / 100) < 0 ? "flat" : "sharp")
              : "") +
            ". The song has " +
            pretty(midiInfo(r.m).label) +
            ".";
      return html`<span
        class="mono"
        title=${tip}
        aria-label=${tip}
        style=${{
          fontSize: 12,
          fontWeight: 700,
          padding: "3px 6px",
          borderRadius: 6,
          minWidth: 18,
          textAlign: "center",
          whiteSpace: "nowrap",
          color: col,
          background:
            st === "miss"
              ? "var(--surface-2)"
              : "color-mix(in srgb, " + col + " 15%, transparent)",
        }}
        >${label}</span
      >`;
    };
    const chip = (i, label) =>
      html`<span
        class="mono"
        style=${{
          fontSize: 12,
          fontWeight: 600,
          padding: "3px 6px",
          borderRadius: 6,
          background:
            i === curIdx
              ? "var(--accent)"
              : "color-mix(in srgb, var(--accent) 15%, transparent)",
          color: i === curIdx ? "var(--accent-ink)" : "var(--accent)",
          whiteSpace: "nowrap",
        }}
        >${label}</span
      >`;
    if (!notes.length)
      return html`<p class="muted text-sm">
        No melody found in this vocal yet.
      </p>`;
    return html`<div class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="seg" role="group" aria-label="Note names">
          <button
            aria-pressed=${names !== "solfege" ? "true" : "false"}
            onClick=${() => onNames("letters")}
          >
            Letters
          </button>
          <button
            aria-pressed=${names === "solfege" ? "true" : "false"}
            onClick=${() => onNames("solfege")}
          >
            Do re mi
          </button>
        </div>
      </div>
      ${!spans.length &&
      html`<p class="text-xs muted" style=${{ margin: 0 }}>
        No lyrics for this song yet, so lines follow the melody's phrases. Add
        an .lrc file under Change to see the words.
      </p>`}
      ${lines.map((l, k) => {
        const isCur = k === cur,
          isOpen = k === open,
          tags = lineTags(l, songLo, songHi);
        const info = lineInfo ? lineInfo(l) : {};
        const hasYou = !!(you && l.idx.some((i) => you[i]));
        const scoreTag = (lbl, v) =>
          v == null
            ? null
            : html`<span
                class=${"tag tag-" +
                (v >= 80 ? "good" : v >= 50 ? "warn" : "bad")}
                >${lbl} ${v}%</span
              >`;
        const looping = loop && Math.abs(loop.a - Math.max(0, l.start)) < 0.05;
        let lo = 999,
          hi = 0,
          jump = 0;
        l.notes.forEach((n, j) => {
          lo = Math.min(lo, n.midi);
          hi = Math.max(hi, n.midi);
          if (j) jump = Math.max(jump, Math.abs(n.midi - l.notes[j - 1].midi));
        });
        return html`<section
          key=${k}
          ref=${(el) => {
            refs.current[k] = el;
          }}
          class="panel"
          style=${{
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            borderColor: isCur
              ? "color-mix(in srgb, var(--accent) 55%, transparent)"
              : undefined,
            borderRadius: 16,
          }}
        >
          <div class="flex items-center gap-2">
            <button
              class="flex items-center gap-2 min-w-0"
              style=${{
                flex: 1,
                background: "none",
                border: 0,
                padding: 0,
                color: "inherit",
                font: "inherit",
                cursor: "pointer",
                textAlign: "left",
              }}
              onClick=${() => setOpen(isOpen ? -1 : k)}
              aria-expanded=${isOpen ? "true" : "false"}
            >
              ${info.learned &&
              html`<span
                title="Learned: 85% or more twice in a row"
                aria-label="Learned"
                style=${{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  flexShrink: 0,
                  display: "grid",
                  placeItems: "center",
                  background: "var(--good)",
                  color: "var(--bg)",
                  fontSize: 11,
                  fontWeight: 800,
                }}
                >✓</span
              >`}
              <span class="mono text-xs muted"
                >${String(k + 1).padStart(2, "0")} ·
                ${fmt(Math.max(0, l.start))}</span
              >
              <span class="flex flex-wrap gap-1"
                >${tags.map(
                  (t) =>
                    html`<span
                      key=${t}
                      class="tag"
                      style=${{
                        color: "var(--muted)",
                        background: "var(--surface-2)",
                      }}
                      >${t}</span
                    >`,
                )}${scoreTag("Last", info.last)}${scoreTag(
                  "Best",
                  info.best,
                )}</span
              >
            </button>
          </div>
          ${l.wordNotes
            ? html`<div
                class="flex flex-wrap"
                style=${{ gap: "10px 8px" }}
                onClick=${() => setOpen(isOpen ? -1 : k)}
              >
                ${l.wordNotes.map(
                  (w, j) =>
                    html`<span
                      key=${j}
                      class="flex flex-col items-center"
                      style=${{ gap: 3 }}
                    >
                      <span class="flex gap-1" style=${{ minHeight: 22 }}
                        >${w.idx.length
                          ? w.idx
                              .slice(0, 3)
                              .map((i) => chip(i, short(notes[i].midi)))
                          : html`<span class="mono text-xs muted">·</span>`}${w
                          .idx.length > 3
                          ? html`<span class="text-xs muted">…</span>`
                          : ""}</span
                      >
                      ${hasYou &&
                      html`<span class="flex gap-1" style=${{ minHeight: 22 }}
                        >${w.idx
                          .slice(0, 3)
                          .map(
                            (i) => html`<span key=${i}>${youChip(i)}</span>`,
                          )}</span
                      >`}
                      <span style=${{ fontSize: 15, fontWeight: 600 }}
                        >${w.w}</span
                      >
                    </span>`,
                )}
              </div>`
            : html`<div
                class="flex flex-col gap-2"
                onClick=${() => setOpen(isOpen ? -1 : k)}
              >
                ${hasYou
                  ? html`<div class="flex gap-2 items-start">
                      <span
                        class="flex flex-col"
                        style=${{
                          gap: 4,
                          fontSize: 10,
                          fontWeight: 600,
                          letterSpacing: ".08em",
                          textTransform: "uppercase",
                          color: "var(--muted)",
                          paddingTop: 3,
                        }}
                        ><span style=${{ height: 20 }}>Song</span
                        ><span style=${{ height: 20, color: "var(--you)" }}
                          >You</span
                        ></span
                      >
                      <div class="flex flex-wrap" style=${{ gap: "6px 4px" }}>
                        ${l.idx.map(
                          (i) =>
                            html`<span
                              key=${i}
                              class="flex flex-col items-center"
                              style=${{ gap: 4 }}
                              >${chip(i, short(notes[i].midi))}${youChip(
                                i,
                              )}</span
                            >`,
                        )}
                      </div>
                    </div>`
                  : html`<div class="flex flex-wrap gap-1">
                      ${l.idx.map(
                        (i) =>
                          html`<span key=${i}
                            >${chip(i, short(notes[i].midi))}</span
                          >`,
                      )}
                    </div>`}
                ${l.text &&
                html`<span
                  style=${{ fontSize: 16, fontWeight: 600, lineHeight: 1.35 }}
                  >${l.text}</span
                >`}
              </div>`}
          <div class="flex flex-wrap gap-2">
            <button
              class="btn"
              style=${{ padding: "5px 10px", fontSize: 12 }}
              onClick=${() => onPlayLine(l)}
              aria-label=${"Play line " + (k + 1)}
            >
              ▶ Play
            </button>
            ${info.me &&
            html`<button
              class="btn"
              style=${{
                padding: "5px 10px",
                fontSize: 12,
                color: "var(--you)",
              }}
              onClick=${() => onMe && onMe(l)}
              aria-label=${"Hear your last try at line " + (k + 1)}
            >
              ▶ Me
            </button>`}
            <button
              class="btn"
              style=${{
                padding: "5px 10px",
                fontSize: 12,
                color: looping ? "var(--accent)" : undefined,
                borderColor: looping ? "var(--accent)" : undefined,
              }}
              onClick=${() => onLoop(l)}
              aria-label=${"Loop line " + (k + 1)}
            >
              ↻ ${looping ? "Looping" : "Loop"}
            </button>
            ${info.analyze &&
            html`<button
              class="btn"
              style=${{
                padding: "5px 10px",
                fontSize: 12,
                color: "var(--accent)",
                borderColor:
                  "color-mix(in srgb, var(--accent) 45%, transparent)",
              }}
              onClick=${() => onAnalyze && onAnalyze(l)}
              aria-label=${"Analyze your try at line " + (k + 1)}
            >
              Analyze
            </button>`}
          </div>
          ${isOpen &&
          l.notes.length > 0 &&
          html`<${React.Fragment}>
            <svg
              viewBox="0 0 300 50"
              preserveAspectRatio="none"
              style=${{ width: "100%", height: 50, display: "block" }}
              aria-hidden="true"
            >
              ${(() => {
                const a = l.notes[0].pos,
                  b = Math.max(a + 0.5, l.notes[l.notes.length - 1].end),
                  L = lo - 1,
                  H = hi + 1;
                return l.notes.map(
                  (n, j) =>
                    html`<rect
                      key=${j}
                      x=${((300 * (n.pos - a)) / (b - a)).toFixed(1)}
                      y=${(44 - ((n.midi - L) / (H - L)) * 38).toFixed(1)}
                      width=${Math.max(
                        4,
                        (300 * (n.end - n.pos)) / (b - a) - 2,
                      ).toFixed(1)}
                      height="6"
                      rx="3"
                      fill=${l.idx[j] === curIdx
                        ? "var(--fg)"
                        : "var(--accent)"}
                    ></rect>`,
                );
              })()}
            </svg>
            <div
              class="flex flex-wrap items-center justify-between gap-2 text-xs muted"
            >
              <span
                >Range
                ${pretty(midiInfo(lo + tr).label)}–${pretty(
                  midiInfo(hi + tr).label,
                )}</span
              >
              <span>Biggest jump ${jump} key${jump === 1 ? "" : "s"}</span>
            </div>
          <//>`}
        </section>`;
      })}
    </div>`;
  }

  function Learn({
    themeKey,
    active,
    orig,
    onPickOrig,
    lyrics,
    updateLyrics,
    focus,
    onGo,
    inst,
    sync,
  }) {
    const data = orig && orig.data ? orig.data : null;
    const notes = data ? data.notes : [];
    const [playing, setPlaying] = useState(false);
    const [cursor, setCursor] = useState(null);
    const [mix, setMix] = useState(() => ({
      m: 0.6,
      ...loadJSON("pitchstaff.learnmix.v1", { o: 0.8, g: 0.45 }),
    }));
    const instRef = useRef(null),
      syncRef2 = useRef(0);
    instRef.current = inst && inst.buffer ? inst : null;
    syncRef2.current = sync || 0;
    const [speed, setSpeed] = useState(1);
    const [tr, setTr] = useState(0);
    const [names, setNames] = useState(() =>
      loadJSON("pitchstaff.names.v1", "letters"),
    );
    const [mode, setModeState] = useState("play");
    const [view, setViewState] = useState(() =>
      loadJSON("pitchstaff.pview.v1", "sheet"),
    );
    const chooseView = (v) => {
      setViewState(v);
      saveJSON("pitchstaff.pview.v1", v);
    };
    const [loop, setLoop] = useState(null);
    const [turn, setTurn] = useState(null);
    const [learned, setLearned] = useState([]);
    const [optOpen, setOptOpen] = useState(false);
    const [listen, setListen] = useState(false);
    const [micMsg, setMicMsg] = useState("");
    const [mastery, setMastery] = useState(() =>
      loadJSON("pitchstaff.mastery.v1", false),
    );
    const [moreTime, setMoreTime] = useState(() =>
      loadJSON("pitchstaff.moretime.v1", 0),
    );
    const [liveLine, setLiveLine] = useState(null);
    const [attempt, setAttempt] = useState(null);
    const [review, setReview] = useState(null);
    const [scoring, setScoring] = useState(false);
    const [best, setBest] = useState({});
    const [toast, setToast] = useState("");
    const listenRef = useRef(false),
      masteryRef = useRef(mastery),
      moreTimeRef = useRef(moreTime);
    const mic = useRef({}),
      rec = useRef({ on: false, chunks: [], live: [], t0: 0 }),
      flow = useRef(0),
      streak = useRef({}),
      lastTake = useRef(null);
    const coachRef = useRef(null);
    const [pending, setPending] = useState(null); // after a try: { next, again, after, scored }
    const takesRef = useRef({});
    const [lastScores, setLastScores] = useState({});
    const [showDetails, setShowDetails] = useState(false);
    const [plan, setPlanState] = useState(null);
    const [planRun, setPlanRun] = useState(null);
    const attemptsRef = useRef({});
    const [tries, setTries] = useState({});
    const [panel, setPanel] = useState(null);
    const [tempPlan, setTempPlan] = useState(null);
    // keep the coach card in view whenever it changes step
    useEffect(() => {
      const el = coachRef.current;
      if (!el || !active) return;
      const r = el.getBoundingClientRect();
      if (r.top < 70 || r.top > window.innerHeight * 0.45) {
        try {
          el.scrollIntoView({ block: "start", behavior: "smooth" });
          window.scrollBy(0, -12);
        } catch (e) {}
      }
    }, [
      turn ? turn.idx : -1,
      attempt ? attempt.idx + ":" + attempt.score : "",
    ]);
    useEffect(() => setShowDetails(false), [attempt]);
    useEffect(() => {
      const p = loadPlan(orig && orig.data ? orig.name : null);
      if (p && p.fresh && active) {
        p.fresh = false;
        p.hidden = false;
        savePlan(orig.name, p);
        modeRef.current = "play";
        setModeState("play");
        chooseView("sheet");
      }
      setPlanState(p);
    }, [orig, active]);
    const mixRef = useRef(mix),
      speedRef = useRef(1),
      trRef = useRef(0),
      modeRef = useRef("play"),
      loopRef = useRef(null);
    const play = useRef({
      ctx: null,
      origSrc: null,
      guide: [],
      gO: null,
      gG: null,
      raf: 0,
    });
    const fileRef = useRef(null);

    const key = useMemo(
      () => (notes.length ? estimateKey(notes) : null),
      [notes],
    );
    const spans = useMemo(
      () => (data ? lyricSpans(lyrics, data.duration) : []),
      [lyrics, data],
    );
    const phrases = useMemo(
      () => buildPhrases(notes, spans, data && data.grid),
      [notes, spans, data],
    );
    const songName = data ? orig.name : null;

    const nameOf = useCallback(
      (m) => {
        if (names === "solfege" && key)
          return SOLFEGE[(((m - key.doPc) % 12) + 12) % 12];
        return pretty(midiInfo(m + tr).label);
      },
      [names, key, tr],
    );

    const killSources = () => {
      const p = play.current;
      cancelAnimationFrame(p.raf);
      [p.origSrc, p.musicSrc, p.replay, ...(p.guide || [])].forEach((s) => {
        if (s) {
          try {
            s.stop();
          } catch (e) {}
        }
      });
      [p.gO, p.gG, p.gM].forEach((g) => {
        if (g) {
          try {
            g.disconnect();
          } catch (e) {}
        }
      });
      p.origSrc = null;
      p.musicSrc = null;
      p.replay = null;
      p.guide = [];
      p.gO = p.gG = p.gM = null;
    };
    const stopAll = useCallback(() => {
      flow.current++;
      rec.current.on = false;
      killSources();
      setPlaying(false);
      setTurn(null);
      setReview(null);
    }, []);

    // ---- microphone (only works where the page is allowed to use it) ----
    const closeMic = useCallback(() => {
      const m = mic.current;
      if (m.stream) m.stream.getTracks().forEach((t) => t.stop());
      [m.src, m.an, m.proc, m.sink].forEach((n) => {
        if (n) {
          try {
            n.disconnect();
          } catch (e) {}
        }
      });
      if (m.proc) m.proc.onaudioprocess = null;
      mic.current = {};
    }, []);
    const openMic = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
        throw new Error("unsupported");
      const ctx = ensureCtx();
      const stream = await getMicStream();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 2048;
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      const sink = ctx.createGain();
      sink.gain.value = 0;
      src.connect(an);
      src.connect(proc);
      proc.connect(sink);
      sink.connect(ctx.destination);
      proc.onaudioprocess = (e) => {
        const r = rec.current;
        if (r.on)
          r.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };
      mic.current = { stream, src, an, proc, sink };
    };
    const MIC_BLOCKED =
      "The microphone is blocked on this page, so listening is off. It works when you open the Tono file in Chrome on your computer, or put the file on a website (https) to use it on your phone.";
    const ensureMic = async () => {
      if (mic.current.stream) return true;
      try {
        await openMic();
        return true;
      } catch (e) {
        closeMic();
        listenRef.current = false;
        setListen(false);
        setMicMsg(MIC_BLOCKED);
        return false;
      }
    };
    const toggleListen = async () => {
      if (listenRef.current) {
        listenRef.current = false;
        setListen(false);
        closeMic();
        return;
      }
      setMicMsg("");
      const ok = await ensureMic();
      if (ok) {
        listenRef.current = true;
        setListen(true);
      }
    };
    useEffect(() => {
      if (!active) {
        stopAll();
        closeMic();
      }
    }, [active, stopAll, closeMic]);
    useEffect(
      () => () => {
        killSources();
        closeMic();
        if (play.current.ctx) play.current.ctx.close().catch(() => {});
      },
      [],
    );
    useEffect(() => {
      stopAll();
      setCursor(null);
      loopRef.current = null;
      setLoop(null);
      setAttempt(null);
      setLiveLine(null);
      streak.current = {};
      lastTake.current = null;
      takesRef.current = {};
      setLastScores({});
      setPending(null);
      attemptsRef.current = {};
      setTries(loadTries(songName));
      setPanel(null);
      setLearned(songName ? loadJSON(LEARNED_KEY, {})[songName] || [] : []);
      setBest(songName ? loadJSON(BEST_KEY, {})[songName] || {} : {});
    }, [data, songName, stopAll]);

    const ensureCtx = () => {
      const p = play.current;
      if (!p.ctx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        p.ctx = new Ctx();
      }
      if (p.ctx.state === "suspended") p.ctx.resume().catch(() => {});
      return p.ctx;
    };
    const bus = (ctx, v) => {
      const g = ctx.createGain();
      g.gain.value = v;
      g.connect(ctx.destination);
      return g;
    };

    // play the song from t to end, then call onDone
    const playRange = (t, end, onDone) => {
      killSources();
      const p = play.current,
        ctx = ensureCtx();
      const mx = mixRef.current,
        sp = speedRef.current;
      const now = ctx.currentTime + 0.05;
      p.gO = bus(ctx, mx.o);
      p.gG = bus(ctx, mx.g);
      p.gM = bus(ctx, mx.m || 0);
      if (sp === 1) {
        const s = ctx.createBufferSource();
        s.buffer = orig.buffer;
        s.connect(p.gO);
        s.start(now, Math.max(0, t));
        p.origSrc = s;
        const ib = instRef.current;
        if (ib) {
          const m = ctx.createBufferSource();
          m.buffer = ib.buffer;
          m.connect(p.gM);
          const at = t + syncRef2.current;
          if (at >= 0) m.start(now, at);
          else m.start(now - at, 0);
          p.musicSrc = m;
        }
      }
      p.guide = scheduleGuide(ctx, p.gG, notes, t, end, now, trRef.current, sp);
      setPlaying(true);
      const tick = () => {
        const ct = t + Math.max(0, ctx.currentTime - now) * sp;
        if (ct >= end) {
          killSources();
          setCursor(Math.min(end, data.duration));
          onDone();
          return;
        }
        setCursor(ct);
        p.raf = requestAnimationFrame(tick);
      };
      tick();
    };

    const phraseAt = (t) => {
      const i = phrases.findIndex((p) => p.end > t);
      return i < 0 ? 0 : i;
    };

    const addLearned = (i) => {
      setLearned((prev) => {
        if (prev.includes(i)) return prev;
        const next = [...prev, i];
        const all = loadJSON(LEARNED_KEY, {});
        all[songName] = next;
        saveJSON(LEARNED_KEY, all);
        return next;
      });
    };
    const flash = (msg) => {
      setToast(msg);
      setTimeout(() => setToast((t) => (t === msg ? "" : t)), 3500);
    };

    // after a phrase: short pause showing the result, then the next phrase (or the same one again)
    // after a phrase: stop and wait for the singer to tap Play / Next
    const nextAfter = (idx, token, res) => {
      if (flow.current !== token) return;
      let next = idx + 1,
        again = false;
      if (loopRef.current) {
        next = idx;
        again = true;
      } else if (res && masteryRef.current && res.score < 80) {
        next = idx;
        again = true;
      }
      killSources();
      setPlaying(false);
      setTurn(null);
      setReview(null);
      setPending(
        next >= phrases.length
          ? { next: -1, again: false, after: idx, scored: !!res }
          : { next, again, after: idx, scored: !!res },
      );
    };

    const finishAttempt = async (idx, token) => {
      const ctx = play.current.ctx,
        chunks = rec.current.chunks;
      const len = chunks.reduce((n, c) => n + c.length, 0);
      if (len < ctx.sampleRate * 0.3) {
        nextAfter(idx, token, null);
        return;
      }
      const pcm = new Float32Array(len);
      let o = 0;
      chunks.forEach((c) => {
        pcm.set(c, o);
        o += c.length;
      });
      const sr = ctx.sampleRate;
      const ab = ctx.createBuffer(1, len, sr);
      ab.getChannelData(0).set(pcm);
      lastTake.current = { idx, buffer: ab };
      takesRef.current[idx] = ab;
      setScoring(true);
      const her = await trackPitch(
        {
          getChannelData: () => pcm,
          numberOfChannels: 1,
          sampleRate: sr,
          duration: len / sr,
        },
        () => {},
        () => flow.current !== token,
      );
      setScoring(false);
      if (!her || flow.current !== token) return;
      const res = scorePhrase(
        phrases[idx],
        her,
        speedRef.current,
        trRef.current,
      );
      setAttempt({ ...res, idx });
      attemptsRef.current[idx] = res.rows;
      {
        const rec = {
          score: res.score,
          at: Date.now(),
          speed: speedRef.current,
          start: phrases[idx].start,
          trace: res.trace,
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
        setTries((t) => {
          const cur = t[idx] || {};
          const hist = [
            ...(cur.hist || []),
            { at: rec.at, s: rec.score },
          ].slice(-30);
          const next = {
            ...t,
            [idx]: {
              last: rec,
              best: !cur.best || rec.score >= cur.best.score ? rec : cur.best,
              hist,
            },
          };
          saveTries(songName, next);
          return next;
        });
      }
      setLastScores((x) => ({ ...x, [idx]: res.score }));
      if (songName) {
        const all = loadJSON(BEST_KEY, {}),
          sb = all[songName] || {};
        if (!(sb[idx] >= res.score)) {
          sb[idx] = res.score;
          all[songName] = sb;
          saveJSON(BEST_KEY, all);
          setBest({ ...sb });
        }
      }
      streak.current[idx] =
        res.score >= 85 ? (streak.current[idx] || 0) + 1 : 0;
      if (streak.current[idx] >= 2) {
        addLearned(idx);
        if (streak.current[idx] === 2)
          flash(
            "Phrase " + (idx + 1) + " marked learned: two good tries in a row.",
          );
      }
      nextAfter(idx, token, res);
    };

    // your turn: silence (and listening, if on) for as long as the phrase lasted
    const turnPhase = (idx, token) => {
      if (flow.current !== token) return;
      const ph = phrases[idx],
        p = play.current,
        ctx = p.ctx,
        sp = speedRef.current;
      const total = (ph.end - ph.start) / sp + 0.8 + moreTimeRef.current;
      const until = ctx.currentTime + total;
      const an = listenRef.current ? mic.current.an : null;
      const r = rec.current;
      const buf = an ? new Float32Array(an.fftSize) : null;
      const tgtMed = median(ph.notes.map((n) => n.midi + trRef.current));
      if (an) {
        r.on = true;
        r.chunks = [];
        r.live = [];
        r.t0 = ctx.currentTime;
        setLiveLine({ start: ph.start, speed: sp, oct: 0, points: [] });
      }
      let frame = 0;
      setPlaying(true);
      const wait = () => {
        if (flow.current !== token) return;
        const left = until - ctx.currentTime;
        if (an) {
          an.getFloatTimeDomainData(buf);
          const d = detectPitch(buf, ctx.sampleRate, micGate());
          r.live.push({
            t: ctx.currentTime - r.t0,
            m: d.freq > 0 ? 69 + 12 * Math.log2(d.freq / SETTINGS.a4) : NaN,
          });
          if (++frame % 3 === 0) {
            const ms = r.live.filter((x) => x.m === x.m).map((x) => x.m);
            setLiveLine({
              start: ph.start,
              speed: sp,
              oct: ms.length ? 12 * Math.round((median(ms) - tgtMed) / 12) : 0,
              points: r.live.slice(),
            });
          }
        }
        if (left <= 0) {
          setTurn(null);
          if (an) {
            r.on = false;
            finishAttempt(idx, token);
            return;
          }
          nextAfter(idx, token, null);
          return;
        }
        setTurn({ idx, left, total, listening: !!an });
        p.raf = requestAnimationFrame(wait);
      };
      wait();
    };

    const runRepeat = async (idx) => {
      const ph = phrases[idx];
      if (!ph) {
        stopAll();
        return;
      }
      const token = ++flow.current;
      setTurn(null);
      setReview(null);
      setPending(null);
      if (listenRef.current) {
        await ensureMic();
        if (flow.current !== token) return;
      }
      playRange(Math.max(0, ph.start - 0.2), ph.end + 0.15, () =>
        turnPhase(idx, token),
      );
    };

    const startPlay = (t) => {
      if (!data) return;
      if (modeRef.current === "repeat") {
        runRepeat(
          pending && pending.next >= 0
            ? pending.next
            : pending
              ? 0
              : phraseAt(t),
        );
        return;
      }
      const lp = loopRef.current;
      let from = Math.max(0, t),
        end = data.duration;
      if (lp) {
        end = lp.b;
        if (from < lp.a - 0.5 || from >= lp.b) from = Math.max(0, lp.a - 0.3);
      }
      if (from >= end - 0.05) from = lp ? Math.max(0, lp.a - 0.3) : 0;
      flow.current++;
      playRange(from, end, () => {
        if (loopRef.current) startPlay(Math.max(0, loopRef.current.a - 0.3));
        else stopAll();
      });
    };
    const restartIfPlaying = () => {
      if (playing) startPlay(turn ? phrases[turn.idx].start : cursor || 0);
    };

    const setVol = (k, v) => {
      const next = { ...mixRef.current, [k]: v };
      mixRef.current = next;
      setMix(next);
      saveJSON("pitchstaff.learnmix.v1", next);
      const p = play.current,
        node = k === "o" ? p.gO : k === "m" ? p.gM : p.gG;
      if (node && p.ctx) node.gain.setTargetAtTime(v, p.ctx.currentTime, 0.02);
    };
    const chooseSpeed = (s) => {
      speedRef.current = s;
      setSpeed(s);
      restartIfPlaying();
    };
    const shiftKey = (d) => {
      const v = Math.max(-7, Math.min(7, trRef.current + d));
      trRef.current = v;
      setTr(v);
      restartIfPlaying();
    };
    const resetKey = () => {
      trRef.current = 0;
      setTr(0);
      restartIfPlaying();
    };
    const chooseMode = (m) => {
      modeRef.current = m;
      setModeState(m);
      setLiveLine(null);
      setPending(null);
      if (playing) {
        stopAll();
      }
    };
    const chooseNames = (n) => {
      setNames(n);
      saveJSON("pitchstaff.names.v1", n);
    };
    const toggleMastery = () => {
      const v = !masteryRef.current;
      masteryRef.current = v;
      setMastery(v);
      saveJSON("pitchstaff.mastery.v1", v);
    };
    const chooseMoreTime = (v) => {
      moreTimeRef.current = v;
      setMoreTime(v);
      saveJSON("pitchstaff.moretime.v1", v);
    };
    const [scrollLine, setScrollLine] = useState(null);
    const startLoop = (a, b) => {
      const lp = { a: Math.max(0, a), b };
      loopRef.current = lp;
      setLoop(lp);
      startPlay(Math.max(0, a - 0.3));
    };
    const clearLoop = () => {
      loopRef.current = null;
      setLoop(null);
    };
    // sent here from Karaoke or the Analyst: get that part ready to loop
    useEffect(() => {
      if (!focus || !data) return;
      stopAll();
      if (focus.repeat) {
        // sent from Analyze: get Repeat after me ready on that line
        modeRef.current = "repeat";
        setModeState("repeat");
        chooseView("sheet");
        clearLoop();
        let k = -1,
          bo = 0;
        spans.forEach((l, i) => {
          const o = Math.min(l.end, focus.b) - Math.max(l.start, focus.a);
          if (o > bo) {
            bo = o;
            k = i;
          }
        });
        setScrollLine({ k, id: focus.id });
        setCursor(Math.max(0, focus.a - 0.3));
        setToast(
          "Ready on this line. Tap ▶ Play on it to hear it, then sing it back.",
        );
        setTimeout(() => setToast(""), 5000);
        return;
      }
      modeRef.current = "play";
      setModeState("play");
      const lp = { a: Math.max(0, focus.a), b: focus.b };
      loopRef.current = lp;
      setLoop(lp);
      setCursor(Math.max(0, focus.a - 0.3));
      setToast("That part is set to loop. Tap play when you're ready.");
      setTimeout(() => setToast(""), 4000);
    }, [focus && focus.id]);
    const seek = (t) => {
      setCursor(t);
      if (playing) startPlay(t);
    };
    const tapNote = (n) => {
      setCursor(n.pos);
      if (playing) {
        startPlay(n.pos);
        return;
      }
      const ctx = ensureCtx(),
        p = play.current;
      killSources();
      p.gG = bus(ctx, Math.max(0.35, mixRef.current.g || 0.6));
      p.guide = scheduleGuide(
        ctx,
        p.gG,
        [{ ...n, end: n.pos + Math.min(1.2, Math.max(0.4, n.end - n.pos)) }],
        n.pos,
        n.pos + 1.3,
        ctx.currentTime + 0.02,
        trRef.current,
        1,
      );
    };
    const hearSelf = () => {
      const lt = lastTake.current;
      if (!lt) return;
      stopAll();
      const ctx = ensureCtx(),
        p = play.current;
      const s = ctx.createBufferSource();
      s.buffer = lt.buffer;
      s.connect(ctx.destination);
      s.start();
      p.replay = s;
    };
    const hearTake = (idx) => {
      const b = takesRef.current[idx];
      if (!b) return;
      stopAll();
      const ctx = ensureCtx(),
        p = play.current;
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start();
      p.replay = s;
    };
    const hearPhrase = (idx) => {
      stopAll();
      const ph = phrases[idx];
      flow.current++;
      playRange(Math.max(0, ph.start - 0.2), ph.end + 0.15, () => stopAll());
    };
    const tryAgain = (idx) => {
      stopAll();
      runRepeat(idx);
    };
    const toggleLearned = (i) => {
      const next = learned.includes(i)
        ? learned.filter((x) => x !== i)
        : [...learned, i];
      setLearned(next);
      const all = loadJSON(LEARNED_KEY, {});
      all[songName] = next;
      saveJSON(LEARNED_KEY, all);
    };
    const sungName = (m, ks) => {
      if (names === "solfege" && key)
        return SOLFEGE[(((m - trRef.current - ks - key.doPc) % 12) + 12) % 12];
      return pretty(midiInfo(m).label);
    };

    if (!data) {
      return html`<div class="grid gap-4 sm:grid-cols-2">
        <${UploadSlot}
          id="learn-file"
          step="1"
          title="Song to learn"
          hint="Upload the acapella (vocal only) of the song you want to learn. It's shared with Karaoke and the Singing Analyst, so you only upload it once."
          slot=${orig}
          onPick=${onPickOrig}
        />
        <div class="panel p-5 flex flex-col gap-2">
          <h3 class="display text-lg font-bold">How Practice works</h3>
          <p class="muted text-sm" style=${{ maxWidth: "62ch" }}>
            You'll see the melody as note bars with their names, split into
            phrases. Play it through or use Repeat after me, which plays a line
            and then leaves a gap for you to sing it back. Slow the guide notes
            down, move them into your key, loop the hard parts, and tick off
            phrases as you learn them. When you're ready, record yourself and
            check it in the Singing Analyst.
          </p>
        </div>
      </div>`;
    }

    const curIdx =
      cursor != null
        ? notes.findIndex((n) => cursor >= n.pos && cursor < n.end)
        : -1;
    const nextNotes = (() => {
      const from = cursor || 0;
      return notes.filter((n) => n.pos > from).slice(0, 5);
    })();
    const curPh = turn
      ? turn.idx
      : cursor != null
        ? phrases.findIndex(
            (p) => cursor >= p.start - 0.2 && cursor < p.end + 0.3,
          )
        : -1;
    const curLine =
      cursor != null
        ? spans.findIndex((l) => cursor >= l.start && cursor < l.end)
        : -1;
    let lo = Infinity,
      hi = -Infinity;
    notes.forEach((n) => {
      lo = Math.min(lo, n.midi);
      hi = Math.max(hi, n.midi);
    });
    const span = hi - lo;
    const spanText =
      span >= 12
        ? Math.floor(span / 12) +
          " octave" +
          (span >= 24 ? "s" : "") +
          (span % 12 ? " + " + pianoKeys(span % 12) : "")
        : pianoKeys(span);
    const linesIn = (a, b) =>
      spans.filter((l) => l.start < b && l.end > a).map((l) => l.text);
    const btn = { padding: "5px 10px", fontSize: 13 };

    const setPlan = (p) => {
      setPlanState(p);
      savePlan(songName, p);
    };
    if (planRun != null && tempPlan)
      return html`<${PlanFlow}
        plan=${tempPlan}
        songTitle=${(songName || "").replace(/\.[^.]+$/, "")}
        buffer=${orig && orig.buffer}
        start=${planRun}
        onClose=${() => {
          setPlanRun(null);
          setTempPlan(null);
        }}
        onUpdate=${setTempPlan}
        onKaraoke=${() => {
          setPlanRun(null);
          setTempPlan(null);
          onGo && onGo("karaoke");
        }}
      />`;
    if (planRun != null && plan)
      return html`<${PlanFlow}
        plan=${plan}
        songTitle=${(songName || "").replace(/\.[^.]+$/, "")}
        buffer=${orig && orig.buffer}
        start=${planRun}
        onClose=${() => setPlanRun(null)}
        onUpdate=${setPlan}
        onKaraoke=${() => {
          setPlanRun(null);
          onGo && onGo("karaoke");
        }}
      />`;
    // each lyric line maps to the phrase it overlaps most (scores and takes are kept per phrase)
    const phraseFor = (l) => {
      let bi = 0,
        bo = -1;
      phrases.forEach((p, i) => {
        const o = Math.min(p.end, l.end) - Math.max(p.start, l.start);
        if (o > bo) {
          bo = o;
          bi = i;
        }
      });
      return bi;
    };
    const lineInfo = (l) => {
      const pi = phraseFor(l);
      const tr0 = tries[pi];
      return {
        last:
          mode === "repeat"
            ? lastScores[pi] != null
              ? lastScores[pi]
              : tr0
                ? tr0.last.score
                : null
            : null,
        best: best[pi],
        learned: learned.includes(pi),
        me: mode === "repeat" && !!takesRef.current[pi],
        analyze: mode === "repeat" && !!tr0,
      };
    };
    const youMap = (() => {
      if (mode !== "repeat") return null;
      const byPos = {};
      notes.forEach((n, i) => {
        byPos[Math.round(n.pos * 1000)] = i;
      });
      const m = {};
      Object.values(tries).forEach((t) =>
        t.last.rows.forEach((r) => {
          const i = byPos[Math.round(r.p * 1000)];
          if (i != null) m[i] = r;
        }),
      );
      return m;
    })();
    // your taps (or Clear) become word timing in this song's lyrics
    const saveWords = (src, words) => {
      if (!lyrics || !lyrics.lines || !updateLyrics) return;
      const off = lyrics.offset || 0;
      updateLyrics({
        ...lyrics,
        lines: lyrics.lines.map((ln, i) =>
          i === src
            ? {
                ...ln,
                words: words
                  ? words.map((w) => ({
                      t: Math.max(0, Math.round((w.t - off) * 100) / 100),
                      w: w.w,
                    }))
                  : null,
              }
            : ln,
        ),
      });
      flash(
        words ? "Word timing saved for this line." : "Word timing cleared.",
      );
    };
    const drillLine = (l, pi, rec, info) => {
      const ms = rec.rows.map((r) => r.m),
        wi = info.worst ? info.worst.i : 0;
      const a = Math.max(0, Math.min(ms.length - 5, wi - 2)),
        fixed = ms.slice(a, a + 5);
      const p = {
        at: Date.now(),
        source: "repeat",
        fresh: false,
        done: {},
        after: null,
        drills: [
          {
            id: "line" + pi,
            kind: "line",
            title: "Drill this line",
            why: "Five notes around the tricky spot, slow then at song speed",
            detail: info.tip,
            tip: info.tip,
            line: null,
            spec: {
              type: "pattern",
              fixed: fixed.length >= 2 ? fixed : ms.slice(0, 5),
              rounds: 2,
              steps: [700, 520],
              stages: ["Slow", "Song speed"],
              tol: 0.5,
            },
          },
        ],
        checks: [
          {
            li: null,
            start: phrases[pi].start,
            end: phrases[pi].end,
            text: l.text,
            before: rec.score,
            notes: ms.slice(0, 12),
          },
        ],
      };
      setPanel(null);
      stopAll();
      setTempPlan(p);
      setPlanRun(0);
    };
    const weakRepeat =
      Object.values(lastScores).some((v) => v < 80) &&
      Object.keys(attemptsRef.current).length > 0;
    const lo2 = notes.length
        ? notes.reduce((m, n) => Math.min(m, n.midi), 999)
        : 0,
      hi2 = notes.length ? notes.reduce((m, n) => Math.max(m, n.midi), 0) : 0;
    return html`<div class="flex flex-col gap-4">
      <div class="flex gap-2">
        <div
          class="mode-seg"
          role="group"
          aria-label="Practice mode"
          style=${{ flex: 1 }}
        >
          <button
            aria-pressed=${mode === "play" ? "true" : "false"}
            onClick=${() => chooseMode("play")}
          >
            Listen
          </button>
          <button
            aria-pressed=${mode === "repeat" ? "true" : "false"}
            onClick=${() => chooseMode("repeat")}
          >
            Repeat after me
          </button>
        </div>
        ${mode === "repeat" &&
        html`<button
          class=${"mic-btn" + (listen ? " on" : "")}
          aria-pressed=${listen ? "true" : "false"}
          onClick=${toggleListen}
          aria-label=${listen
            ? "Listen to me is on. Tap to practice without scoring"
            : "Turn on Listen to me to get scored"}
        >
          <${Icon} name="mic" size=${22} />
        </button>`}
      </div>
      ${mode === "repeat" &&
      html`<p class="text-xs muted">
        ${listen
          ? "Mic on: each try gets scored. Tap the mic to practice without scoring."
          : "Plays a phrase, then gives you time to sing it back. Tap the mic to get scored."}
      </p>`}
      ${micMsg &&
      mode === "repeat" &&
      html`<div class="notice" role="alert">${micMsg}</div>`}
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs muted"
          >${key ? keyName(key, tr) : ""}${notes.length
            ? " · " +
              pretty(midiInfo(lo2 + tr).label) +
              "–" +
              pretty(midiInfo(hi2 + tr).label)
            : ""}</span
        >
        <div class="seg" role="group" aria-label="View">
          <button
            aria-pressed=${view === "chart" ? "true" : "false"}
            onClick=${() => chooseView("chart")}
            aria-label="Chart view"
            title="Chart"
          >
            <${Icon} name="bars" size=${18} />
          </button>
          <button
            aria-pressed=${view === "sheet" ? "true" : "false"}
            onClick=${() => chooseView("sheet")}
            aria-label="Song sheet view"
            title="Song sheet"
          >
            <${Icon} name="list" size=${18} />
          </button>
        </div>
      </div>

      ${view === "sheet" &&
      toast &&
      html`<div class="notice" role="status">${toast}</div>`}
      ${mode === "play" &&
      plan &&
      !plan.hidden &&
      html`<${PlanCard}
        plan=${plan}
        onStart=${(k) => {
          stopAll();
          setPlanRun(k);
        }}
        onHide=${() => setPlan({ ...plan, hidden: true })}
        onClear=${() => setPlan(null)}
      />`}
      ${mode === "play" &&
      plan &&
      plan.hidden &&
      html`<button
        class="link-btn text-sm"
        style=${{ alignSelf: "flex-start" }}
        onClick=${() => setPlan({ ...plan, hidden: false })}
      >
        Show your plan
        (${plan.drills.filter((d) => plan.done[d.id] != null).length} of
        ${plan.drills.length} done)
      </button>`}
      ${mode === "play" &&
      !plan &&
      weakRepeat &&
      html`<div
        class="panel p-3 flex items-center gap-3"
        style=${{ borderStyle: "dashed" }}
      >
        <span class="text-sm muted" style=${{ flex: 1 }}
          >Make a practice plan from your Repeat after me tries.</span
        >
        <button
          class="btn btn-primary"
          style=${{ padding: "6px 12px", fontSize: 13, whiteSpace: "nowrap" }}
          onClick=${() => {
            const rows = Object.values(attemptsRef.current).flat();
            const p = makePlan(rows, notes, spans, phrases, "repeat");
            if (p) {
              p.fresh = false;
              setPlan(p);
            } else flash("Nothing big to fix yet. Nice!");
          }}
        >
          Make plan
        </button>
      </div>`}
      ${view === "sheet" && mode === "play"
        ? html`<${SongSheet}
            scrollLine=${scrollLine}
            notes=${notes}
            spans=${spans}
            phrases=${phrases}
            tr=${tr}
            nameOf=${nameOf}
            names=${names}
            onNames=${chooseNames}
            cursor=${cursor}
            curIdx=${curIdx}
            playing=${playing}
            loop=${loop}
            lineInfo=${lineInfo}
            onMe=${(l) => {
              const pi = phraseFor(l);
              if (takesRef.current[pi]) hearTake(pi);
            }}
            you=${youMap}
            onAnalyze=${(l) => setPanel({ l, pi: phraseFor(l) })}
            onPlayRange=${(l) => {
              clearLoop();
              playRange(Math.max(0, l.start - 0.8), l.end + 0.3, () =>
                stopAll(),
              );
            }}
            onSaveWords=${saveWords}
            onPlayLine=${(l) => {
              clearLoop();
              playRange(Math.max(0, l.start - 0.2), l.end + 0.15, () =>
                stopAll(),
              );
            }}
            onLoop=${(l) => {
              if (loop && Math.abs(loop.a - Math.max(0, l.start)) < 0.05) {
                clearLoop();
                stopAll();
              } else startLoop(l.start, l.end + 0.3);
            }}
          />`
        : html`<${React.Fragment}>
            <section
              class="panel p-4 flex flex-col gap-3 min-w-0 coach"
              ref=${coachRef}
              style=${view === "sheet"
                ? {
                    position: "sticky",
                    top: 8,
                    zIndex: 15,
                    boxShadow: "0 8px 24px rgba(0,0,0,.25)",
                  }
                : undefined}
            >
              <div
                class="flex items-center justify-between gap-2 text-xs muted"
              >
                <span
                  >${key ? keyName(key, tr) : ""}${notes.length
                    ? " · " +
                      pretty(midiInfo(lo2 + tr).label) +
                      "–" +
                      pretty(midiInfo(hi2 + tr).label)
                    : ""}</span
                >
              </div>
              ${(() => {
                const showResult =
                  mode === "repeat" &&
                  !turn &&
                  (scoring ||
                    (!playing &&
                      attempt &&
                      pending &&
                      pending.scored &&
                      attempt.idx === pending.after));
                const showReady =
                  mode === "repeat" &&
                  !turn &&
                  !playing &&
                  pending &&
                  !pending.scored;
                if (turn)
                  return html`<div class="flex flex-col gap-1 min-w-0">
                    <span class="label"
                      >Your turn · phrase ${turn.idx + 1}</span
                    >
                    ${html`<div class="flex flex-col gap-2">
                      <p
                        class="display font-bold"
                        style=${{
                          fontSize: 30,
                          lineHeight: 1.1,
                          color: "var(--accent)",
                        }}
                      >
                        Sing it
                        back${turn.listening
                          ? html` <span
                              class="rec-dot"
                              style=${{
                                display: "inline-block",
                                verticalAlign: "middle",
                              }}
                            ></span>`
                          : ""}
                      </p>
                      <div class="level" style=${{ height: 6 }}>
                        <div
                          style=${{
                            width:
                              Math.max(0, (100 * turn.left) / turn.total) + "%",
                          }}
                        ></div>
                      </div>
                      <p class="text-xs muted">
                        Phrase
                        ${turn.idx + 1}${linesIn(
                          phrases[turn.idx].start,
                          phrases[turn.idx].end,
                        ).length
                          ? " · “" +
                            linesIn(
                              phrases[turn.idx].start,
                              phrases[turn.idx].end,
                            ).join(" / ") +
                            "”"
                          : ""}
                      </p>
                    </div>`}
                  </div>`;
                if (showResult) {
                  if (scoring || !attempt)
                    return html`<div class="flex flex-col gap-1">
                      <span class="label">Your try</span>
                      <p class="display text-xl font-bold muted">Checking…</p>
                    </div>`;
                  const a = attempt,
                    wrong = a.rows.filter((r) => !r.ok);
                  const tone =
                    a.score >= 80 ? "good" : a.score >= 50 ? "warn" : "bad";
                  const nextIdx = pending ? pending.next : a.idx + 1;
                  const again = pending && pending.again;
                  return html`<div class="flex flex-col gap-3">
                    <div class="flex items-start justify-between gap-3">
                      <div class="flex flex-col">
                        <span class="label"
                          >Your try · phrase ${a.idx + 1}</span
                        >
                        <span class="display text-xl font-bold"
                          >${a.score >= 85
                            ? "Great! "
                            : a.score >= 60
                              ? ""
                              : ""}${a.right}
                          of ${a.rows.length} notes right</span
                        >
                      </div>
                      <span
                        class="display font-bold"
                        style=${{
                          fontSize: 36,
                          lineHeight: 1,
                          color: "var(--" + tone + ")",
                        }}
                        >${a.score}%</span
                      >
                    </div>
                    <div class="flex flex-wrap gap-1">
                      ${a.rows.map(
                        (r, i) =>
                          html`<span
                            key=${i}
                            class=${"nchip " +
                            (r.missed ? "miss" : r.ok ? "ok" : "bad")}
                            >${nameOf(r.n.midi)}
                            ${r.missed ? "–" : r.ok ? "✓" : "✗"}</span
                          >`,
                      )}
                    </div>
                    ${wrong.length > 0 &&
                    !showDetails &&
                    html`<p class="text-sm">
                      <b>${nameOf(wrong[0].n.midi)}</b>:
                      ${wrong[0].missed
                        ? "I couldn't hear this one."
                        : "you sang " +
                          sungName(wrong[0].sung, a.keyShift) +
                          ", " +
                          howMuch(wrong[0].cents) +
                          " too " +
                          (wrong[0].cents > 0 ? "high" : "low") +
                          "."}${wrong.length > 1 ||
                      Math.abs(a.lean) >= 15 ||
                      a.keyShift !== 0
                        ? html` <button
                            class="link-btn"
                            onClick=${() => setShowDetails(true)}
                          >
                            Details
                          </button>`
                        : ""}
                    </p>`}
                    ${showDetails &&
                    html`<div class="flex flex-col gap-2">
                      <ul
                        class="text-sm flex flex-col gap-1"
                        style=${{ listStyle: "none", padding: 0, margin: 0 }}
                      >
                        ${wrong
                          .slice(0, 4)
                          .map(
                            (r, i) =>
                              html`<li key=${i}>
                                <b>${nameOf(r.n.midi)}</b>:
                                ${r.missed
                                  ? "I couldn't hear this one."
                                  : "you sang " +
                                    sungName(r.sung, a.keyShift) +
                                    ", " +
                                    howMuch(r.cents) +
                                    " too " +
                                    (r.cents > 0 ? "high" : "low") +
                                    "."}
                              </li>`,
                          )}
                      </ul>
                      ${Math.abs(a.lean) >= 15 &&
                      html`<p class="text-sm muted">
                        Overall you were ${howMuch(a.lean)}
                        ${a.lean > 0 ? "high (sharp)" : "low (flat)"} on this
                        phrase.
                      </p>`}
                      ${a.keyShift !== 0 &&
                      html`<div
                        class="notice"
                        style=${{
                          borderColor: "var(--line)",
                          background: "var(--surface)",
                        }}
                      >
                        You sang this ${pianoKeys(Math.abs(a.keyShift))}
                        ${a.keyShift > 0 ? "higher" : "lower"} than the guide,
                        which is fine.
                        <button
                          class="btn"
                          style=${{
                            padding: "4px 10px",
                            fontSize: 12,
                            marginLeft: 8,
                          }}
                          onClick=${() => {
                            stopAll();
                            shiftKey(a.keyShift);
                          }}
                        >
                          Move the guide to my key
                        </button>
                      </div>`}
                      <button
                        class="link-btn"
                        style=${{ alignSelf: "flex-start" }}
                        onClick=${() => setShowDetails(false)}
                      >
                        Hide details
                      </button>
                    </div>`}
                    <div class="coach-actions">
                      ${again
                        ? html`<button
                            class="btn"
                            onClick=${() => hearPhrase(a.idx)}
                          >
                            ▶ Phrase
                          </button>`
                        : html`<button
                            class="btn"
                            onClick=${() => tryAgain(a.idx)}
                          >
                            ↻ Try again
                          </button>`}
                      <button
                        class="btn"
                        onClick=${() => hearTake(a.idx)}
                        disabled=${!takesRef.current[a.idx]}
                      >
                        ▶ Hear me
                      </button>
                      ${again
                        ? html`<button
                            class="btn btn-primary"
                            onClick=${() => tryAgain(a.idx)}
                          >
                            ↻ Try again
                          </button>`
                        : nextIdx >= 0 && nextIdx < phrases.length
                          ? html`<button
                              class="btn btn-primary"
                              onClick=${() => {
                                setShowDetails(false);
                                runRepeat(nextIdx);
                              }}
                            >
                              Next →
                            </button>`
                          : html`<button
                              class="btn btn-primary"
                              onClick=${() => onGo && onGo("karaoke")}
                            >
                              Karaoke →
                            </button>`}
                    </div>
                    ${again &&
                    html`<p class="text-xs muted">
                      ${loop
                        ? "Looping this phrase."
                        : "Get 80% or more to move on. You can skip ahead from the phrase list."}
                    </p>`}
                    ${!again &&
                    (nextIdx < 0 || nextIdx >= phrases.length) &&
                    html`<p class="text-xs muted">
                      That was the last phrase. Nice work!
                    </p>`}
                    ${review &&
                    html`<div class="flex items-center gap-3">
                      <div class="level" style=${{ flex: 1, height: 4 }}>
                        <div
                          style=${{
                            width: (100 * review.left) / review.total + "%",
                          }}
                        ></div>
                      </div>
                      <span class="text-xs muted"
                        >${review.again
                          ? "Same phrase again"
                          : "Phrase " + (review.next + 1) + " next"}</span
                      >
                      <button
                        class="btn btn-ghost"
                        style=${{ padding: "3px 10px", fontSize: 12 }}
                        onClick=${stopAll}
                      >
                        Pause
                      </button>
                    </div>`}
                  </div>`;
                }
                if (showReady)
                  return html`<div class="flex flex-col gap-2">
                    <span class="label">Phrase ${pending.after + 1} done</span>
                    <p class="display text-2xl font-bold">
                      ${pending.next >= 0
                        ? pending.again
                          ? "Ready to go again?"
                          : "Ready for phrase " + (pending.next + 1) + "?"
                        : "That was the last phrase"}
                    </p>
                    <div class="coach-actions">
                      <button
                        class="btn"
                        onClick=${() => tryAgain(pending.after)}
                      >
                        ↻ Again
                      </button>
                      <button
                        class="btn"
                        onClick=${() => hearPhrase(pending.after)}
                      >
                        ▶ Phrase
                      </button>
                      ${pending.next >= 0
                        ? html`<button
                            class="btn btn-primary"
                            onClick=${() => runRepeat(pending.next)}
                          >
                            ${pending.again ? "Go →" : "Next →"}
                          </button>`
                        : html`<button
                            class="btn btn-primary"
                            onClick=${() => onGo && onGo("karaoke")}
                          >
                            Karaoke →
                          </button>`}
                    </div>
                  </div>`;
                const listenPh = mode === "repeat" && playing && curPh >= 0;
                return html`<div class="flex flex-col gap-1 min-w-0">
                  <span class="flex items-center justify-between gap-2">
                    <span class="label"
                      >${listenPh
                        ? "Listen · phrase " + (curPh + 1)
                        : "Now singing"}</span
                    >
                    ${mode === "repeat" &&
                    attempt &&
                    html`<span
                      class=${"tag tag-" +
                      (attempt.score >= 80
                        ? "good"
                        : attempt.score >= 50
                          ? "warn"
                          : "bad")}
                      >Last try ${attempt.score}%</span
                    >`}
                  </span>
                  ${html`<div class="flex items-end gap-3 flex-wrap">
                    <span
                      class="display font-bold"
                      style=${{
                        fontSize: 48,
                        lineHeight: 1,
                        color: curIdx >= 0 ? "var(--accent)" : "var(--muted)",
                      }}
                      >${curIdx >= 0 ? nameOf(notes[curIdx].midi) : "—"}</span
                    >
                    ${nextNotes.length > 0 &&
                    html`<span class="text-sm muted pb-1"
                      >Coming up:
                      <span class="mono" style=${{ color: "var(--fg)" }}
                        >${nextNotes
                          .map((n) => nameOf(n.midi))
                          .join("  ")}</span
                      ></span
                    >`}
                  </div>`}
                  ${spans.length > 0 &&
                  html`<p
                    class="display font-bold"
                    style=${{ fontSize: 19, lineHeight: 1.3, marginTop: 4 }}
                  >
                    ${curLine >= 0 ? spans[curLine].text : "♪"}
                  </p>`}
                </div>`;
              })()}
            </section>
            ${toast &&
            html`<div
              class="notice"
              role="status"
              style=${{
                borderColor: "var(--good)",
                background:
                  "color-mix(in srgb, var(--good) 10%, var(--surface))",
              }}
            >
              ${toast}
            </div>`}
            ${view === "sheet"
              ? html`<${SongSheet}
                  scrollLine=${scrollLine}
                  notes=${notes}
                  spans=${spans}
                  phrases=${phrases}
                  tr=${tr}
                  nameOf=${nameOf}
                  names=${names}
                  onNames=${chooseNames}
                  cursor=${cursor}
                  curIdx=${curIdx}
                  playing=${playing}
                  loop=${loop}
                  lineInfo=${lineInfo}
                  onMe=${(l) => {
                    const pi = phraseFor(l);
                    if (takesRef.current[pi]) hearTake(pi);
                  }}
                  you=${youMap}
                  onAnalyze=${(l) => setPanel({ l, pi: phraseFor(l) })}
                  onPlayRange=${(l) => {
                    clearLoop();
                    playRange(Math.max(0, l.start - 0.8), l.end + 0.3, () =>
                      stopAll(),
                    );
                  }}
                  onSaveWords=${saveWords}
                  onPlayLine=${(l) => {
                    clearLoop();
                    runRepeat(phraseFor(l));
                  }}
                  onLoop=${(l) => {
                    if (
                      loop &&
                      Math.abs(loop.a - Math.max(0, l.start)) < 0.05
                    ) {
                      clearLoop();
                      stopAll();
                    } else startLoop(l.start, l.end + 0.3);
                  }}
                />`
              : html`<${MelodyMap}
                  data=${data}
                  notes=${notes}
                  tr=${tr}
                  nameOf=${nameOf}
                  phrases=${phrases}
                  lyrics=${spans}
                  loop=${loop}
                  cursor=${cursor}
                  curIdx=${curIdx}
                  onTapNote=${tapNote}
                  onSeek=${seek}
                  themeKey=${themeKey}
                  overlay=${liveLine}
                />`}
            ${view === "chart" &&
            html`<${SongFit}
              notes=${notes}
              tr=${tr}
              phrases=${phrases}
              linesIn=${linesIn}
              nameOf=${nameOf}
              active=${active}
              onPractice=${(ph) => {
                clearLoop();
                if (modeRef.current === "repeat") runRepeat(ph.i);
                else startPlay(Math.max(0, ph.start - 0.2));
                try {
                  coachRef.current &&
                    coachRef.current.scrollIntoView({
                      block: "start",
                      behavior: "smooth",
                    });
                } catch (e) {}
              }}
              onFind=${() => {
                saveJSON(MATCH_KEY + ".mode", "range");
                onGo && onGo("live");
              }}
            />`}

            <div class="flex justify-center">
              <button class="btn" onClick=${() => onGo && onGo("karaoke")}>
                Ready? Try it in Karaoke →
              </button>
            </div>
          <//>`}

      <${TryPanel}
        open=${!!panel}
        line=${panel && panel.l}
        tries=${panel ? tries[panel.pi] : null}
        notes=${notes}
        onClose=${() => setPanel(null)}
        canHear=${!!(panel && takesRef.current[panel.pi])}
        onHear=${() => panel && hearTake(panel.pi)}
        onDrill=${(rec, info) => drillLine(panel.l, panel.pi, rec, info)}
      />
      <div class="playbar">
        <button
          class="round-btn primary"
          onClick=${() =>
            playing
              ? stopAll()
              : startPlay(turn ? phrases[turn.idx].start : cursor || 0)}
          aria-label=${playing ? "Pause" : "Play"}
        >
          <${Icon} name=${playing ? "pause" : "play"} />
        </button>
        <span class="flex flex-col gap-1 min-w-0" style=${{ flex: 1 }}>
          <input
            id="practice-seek"
            type="range"
            min="0"
            max=${data.duration}
            step="0.1"
            value=${cursor || 0}
            onChange=${(e) => seek(parseFloat(e.target.value))}
            aria-label="Position in the song"
          />
          <span class="flex justify-between gap-2 mono text-xs muted">
            <span>${fmt(cursor || 0)}</span>
            <span
              >${loop
                ? "Looping " + fmt(loop.a) + "–" + fmt(loop.b)
                : (speed < 1 ? Math.round(speed * 100) + "% speed" : "") +
                  (tr
                    ? (speed < 1 ? " · " : "") + "key " + signed(tr)
                    : "")}</span
            >
          </span>
        </span>
        ${loop &&
        html`<button
          class="icon-btn"
          onClick=${clearLoop}
          aria-label="Stop looping"
          style=${{ color: "var(--accent)", borderColor: "var(--accent)" }}
        >
          <${Icon} name="loop" />
        </button>`}
        <button
          class="icon-btn"
          onClick=${() => setOptOpen(true)}
          aria-label="Practice options"
        >
          <${Icon} name="sliders" />
        </button>
      </div>

      <${Sheet}
        open=${optOpen}
        title="Practice options"
        onClose=${() => setOptOpen(false)}
      >
        <div class="opt-group">
          <span class="label">Sound</span>
          <div class="mixer" style=${{ gridTemplateColumns: "1fr" }}>
            ${[
              ["o", "Original vocal"],
              ...(inst && inst.buffer ? [["m", "Music"]] : []),
              ["g", "Guide notes"],
            ].map(
              ([k, l]) =>
                html`<label key=${k} class="mix-row" for=${"lmix-" + k}>
                  <span class="text-xs font-semibold">${l}</span>
                  <input
                    id=${"lmix-" + k}
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value=${mix[k]}
                    onInput=${(e) => setVol(k, parseFloat(e.target.value))}
                    onChange=${(e) => setVol(k, parseFloat(e.target.value))}
                    style=${{ accentColor: "var(--accent)" }}
                  />
                  <span
                    class="mono text-xs muted"
                    style=${{ width: 34, textAlign: "right" }}
                    >${mix[k] === 0 ? "off" : Math.round(mix[k] * 100)}</span
                  >
                </label>`,
            )}
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-x-5 gap-y-3">
          <div class="flex items-center gap-2">
            <span class="label">Speed</span>
            <div class="seg" role="group" aria-label="Speed">
              ${[
                [0.5, "50%"],
                [0.75, "75%"],
                [1, "100%"],
              ].map(
                ([v, l]) =>
                  html`<button
                    key=${l}
                    aria-pressed=${speed === v ? "true" : "false"}
                    onClick=${() => chooseSpeed(v)}
                  >
                    ${l}
                  </button>`,
              )}
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="label">Guide key</span>
            <button
              class="btn"
              style=${btn}
              onClick=${() => shiftKey(-1)}
              aria-label="Lower the guide notes"
            >
              −
            </button>
            <span
              class="mono text-xs"
              style=${{ minWidth: 70, textAlign: "center" }}
              >${tr === 0
                ? "Original"
                : signed(tr) +
                  " " +
                  (Math.abs(tr) === 1 ? "key" : "keys")}</span
            >
            <button
              class="btn"
              style=${btn}
              onClick=${() => shiftKey(1)}
              aria-label="Raise the guide notes"
            >
              +
            </button>
            ${tr !== 0 &&
            html`<button class="btn btn-ghost" style=${btn} onClick=${resetKey}>
              Reset
            </button>`}
          </div>
          <div class="flex items-center gap-2">
            <span class="label">Names</span>
            <div class="seg" role="group" aria-label="Note names">
              <button
                aria-pressed=${names === "letters" ? "true" : "false"}
                onClick=${() => chooseNames("letters")}
              >
                C D E
              </button>
              <button
                aria-pressed=${names === "solfege" ? "true" : "false"}
                onClick=${() => chooseNames("solfege")}
              >
                Do Re Mi
              </button>
            </div>
          </div>
        </div>
        ${(speed < 1 || (tr !== 0 && mix.o > 0)) &&
        html`<p class="text-xs muted">
          ${speed < 1
            ? "Music and the original vocal only play at 100% speed, because slowing a recording down also makes it lower. The guide notes stay in tune at any speed. "
            : ""}${tr !== 0 && mix.o > 0
            ? "The original vocal stays in its own key; only the guide notes move."
            : ""}
        </p>`}
        ${names === "solfege" &&
        key &&
        html`<p class="text-xs muted">
          Do is
          ${(key.minor ? KEY_MIN : KEY_MAJ)[key.doPc % 12]}${key.minor
            ? ", so the song's home note is La"
            : ", the song's home note"}.
        </p>`}
        ${mode === "repeat" &&
        html`<div class="opt-group">
          <span class="label">Repeat after me</span>
          <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              class="switch"
              role="switch"
              aria-checked=${mastery ? "true" : "false"}
              onClick=${toggleMastery}
              style=${{ fontSize: 13 }}
              disabled=${!listen}
              title=${listen ? "" : "Turn on Listen to me first"}
            >
              <span class="track"><span class="knob"></span></span>Move on at
              80%+
            </button>
            <div class="flex items-center gap-2">
              <span class="label">Sing-back time</span>
              <div class="seg" role="group" aria-label="Sing-back time">
                ${[
                  [0, "Normal"],
                  [1, "+1 s"],
                  [2, "+2 s"],
                ].map(
                  ([v, l]) =>
                    html`<button
                      key=${l}
                      aria-pressed=${moreTime === v ? "true" : "false"}
                      onClick=${() => chooseMoreTime(v)}
                    >
                      ${l}
                    </button>`,
                )}
              </div>
            </div>
          </div>
          ${listen &&
          html`<p class="text-xs muted">
            The app listens only during "Sing it back" and scores each try. Your
            line shows in blue on the melody. Two tries of 85% or more in a row
            mark a phrase as learned.
          </p>`}
        </div>`}
      <//>
    </div>`;
  }

  /* ---------- note matching (Tuner tab) ---------- */
  const RANGES = {
    low: [40, 60, "Low"],
    mid: [48, 67, "Medium"],
    high: [55, 76, "High"],
  };
  const TOLS = { easy: 50, normal: 25, hard: 10 };
  const PIANO_QUIET = 2400; // ms the mic waits while the piano note rings out

  // typical ranges (MIDI) used to suggest a voice type
  const VOICES = [
    ["Bass", 40, 64],
    ["Baritone", 45, 69],
    ["Tenor", 48, 72],
    ["Alto", 53, 77],
    ["Mezzo-soprano", 57, 81],
    ["Soprano", 60, 84],
  ];
  function voiceType(lo, hi) {
    const mid = (lo + hi) / 2;
    let best = null,
      bd = Infinity;
    VOICES.forEach(([n, a, b]) => {
      const d = Math.abs(mid - (a + b) / 2) + 0.5 * Math.abs(lo - a);
      if (d < bd) {
        bd = d;
        best = n;
      }
    });
    return best;
  }
  function spanWords(lo, hi) {
    const n = hi - lo + 1,
      oct = Math.round(((hi - lo) / 12) * 2) / 2;
    const o =
      oct < 0.5
        ? ""
        : oct === 0.5
          ? "about half an octave"
          : "about " +
            String(Math.floor(oct)) +
            (oct % 1 ? "½" : "") +
            " octave" +
            (oct > 1 ? "s" : "");
    return n + " notes" + (o ? ", " + o : "");
  }
  const keyDot = (bg) =>
    html`<span
      style=${{
        width: 12,
        height: 12,
        borderRadius: 3,
        background: bg,
        flexShrink: 0,
      }}
    ></span>`;

  function RangeFinder({ feedRef, listening, onStartMic, onStopMic }) {
    const [history, setHistory] = useState(loadRanges);
    const [testing, setTesting] = useState(false);
    const [step, setStep] = useState("low");
    const [cur, setCur] = useState(null);
    const [hold, setHold] = useState(0);
    const [found, setFound] = useState({ low: null, high: null });
    const s = useRef({
      buf: [],
      cand: null,
      since: 0,
      quiet: 0,
      step: "low",
      low: null,
      high: null,
      hold: 0,
    });
    const ringC = 2 * Math.PI * 48;

    feedRef.current = (m, now) => {
      const st = s.current;
      if (!testing) return;
      if (m == null || m < 36 || m > 92) {
        if (!st.quiet) st.quiet = now;
        if (now - st.quiet > 150 && st.cand != null) {
          st.buf = [];
          st.cand = null;
          st.hold = 0;
          setCur(null);
          setHold(0);
        }
        return;
      }
      st.quiet = 0;
      st.buf.push(m);
      if (st.buf.length > 7) st.buf.shift();
      const med = [...st.buf].sort((a, b) => a - b)[
        Math.floor(st.buf.length / 2)
      ];
      const n = Math.round(med);
      if (n !== st.cand) {
        st.cand = n;
        st.since = now;
        setCur(n);
      }
      const h = Math.min(1, (now - st.since) / 500);
      if (Math.abs(h - st.hold) >= 0.05 || (h === 1 && st.hold !== 1)) {
        st.hold = h;
        setHold(h);
      }
      if (h >= 1) {
        if (st.step === "low" && (st.low == null || n < st.low)) {
          st.low = n;
          setFound((f) => ({ ...f, low: n }));
        }
        if (st.step === "high" && (st.high == null || n > st.high)) {
          st.high = n;
          setFound((f) => ({ ...f, high: n }));
        }
      }
    };
    useEffect(
      () => () => {
        feedRef.current = null;
      },
      [],
    );

    const begin = () => {
      s.current = {
        buf: [],
        cand: null,
        since: 0,
        quiet: 0,
        step: "low",
        low: null,
        high: null,
        hold: 0,
      };
      setFound({ low: null, high: null });
      setStep("low");
      setCur(null);
      setHold(0);
      setTesting(true);
      if (!listening) onStartMic();
    };
    const goHigh = () => {
      s.current.step = "high";
      s.current.cand = null;
      s.current.buf = [];
      setStep("high");
      setCur(null);
      setHold(0);
    };
    const finish = () => {
      const lo = s.current.low,
        hi = s.current.high;
      if (lo == null || hi == null) return;
      const r = { lo: Math.min(lo, hi), hi: Math.max(lo, hi), at: Date.now() };
      const next = [r, ...history].slice(0, 12);
      setHistory(next);
      saveJSON(RANGE_KEY, next);
      setTesting(false);
      onStopMic();
    };
    const cancel = () => {
      setTesting(false);
      onStopMic();
    };

    if (testing) {
      const best = step === "low" ? found.low : found.high;
      const center =
        cur != null ? cur : best != null ? best : step === "low" ? 57 : 67;
      const rows = [];
      for (let m = center + 6; m >= center - 6; m--) rows.push(m);
      return html`<${React.Fragment}>
        <div class="flex items-center gap-3">
          <span class="flex gap-1"
            ><span
              style=${{
                width: 26,
                height: 6,
                borderRadius: 3,
                background: step === "high" ? "var(--good)" : "var(--accent)",
              }}
            ></span
            ><span
              style=${{
                width: 26,
                height: 6,
                borderRadius: 3,
                background: step === "high" ? "var(--accent)" : "var(--line)",
              }}
            ></span
          ></span>
          <span class="text-sm muted">Step ${step === "low" ? 1 : 2} of 2</span>
        </div>
        <section
          class="tuner-card"
          style=${{
            alignItems: "stretch",
            justifyContent: "flex-start",
            flex: 1,
            gap: 14,
          }}
        >
          <div class="flex flex-col gap-1">
            <span class="display font-bold" style=${{ fontSize: 24 }}
              >${step === "low" ? "Slide down" : "Now slide up"}</span
            >
            <span class="text-sm muted"
              >${step === "low"
                ? "Start on a comfy note and glide down slowly. Stop when your voice gets croaky or breathy."
                : "Start on a comfy note and glide up slowly, like a siren. Stop when it strains. No need to push."}</span
            >
          </div>
          ${!listening
            ? html`<div class="flex justify-center py-4">
                <button
                  class="btn btn-primary"
                  style=${{ minHeight: 52, fontSize: 16, padding: "0 22px" }}
                  onClick=${onStartMic}
                >
                  <span class="flex items-center gap-2"
                    ><${Icon} name="mic" size=${20} />Tap to start
                    listening</span
                  >
                </button>
              </div>`
            : html` <div class="flex gap-3" style=${{ flex: 1, minHeight: 0 }}>
                <div
                  class="flex flex-col"
                  style=${{ flex: 1, gap: 3, minWidth: 0 }}
                  aria-hidden="true"
                >
                  ${rows.map((m) => {
                    const isCur = m === cur,
                      isBest = m === best;
                    const reached =
                      best != null && (step === "low" ? m >= best : m <= best);
                    return html`<div
                      key=${m}
                      class="mono flex items-center justify-between"
                      style=${{
                        height: 22,
                        padding: "0 10px",
                        borderRadius: 6,
                        fontSize: 11,
                        background: isCur
                          ? "var(--you)"
                          : reached
                            ? "color-mix(in srgb, var(--you) 14%, transparent)"
                            : "var(--surface-2)",
                        color: isCur
                          ? "var(--bg)"
                          : reached
                            ? "var(--fg)"
                            : "var(--muted)",
                        fontWeight: isCur ? 700 : 500,
                      }}
                    >
                      <span>${pretty(midiInfo(m).label)}</span
                      ><span
                        >${isCur
                          ? "you"
                          : isBest
                            ? step === "low"
                              ? "lowest"
                              : "highest"
                            : ""}</span
                      >
                    </div>`;
                  })}
                </div>
                <div
                  class="flex flex-col items-center justify-center gap-2"
                  style=${{ width: 118, flexShrink: 0 }}
                >
                  <span
                    style=${{ position: "relative", width: 108, height: 108 }}
                  >
                    <svg
                      width="108"
                      height="108"
                      viewBox="0 0 108 108"
                      role="img"
                      aria-label=${cur != null
                        ? "Holding " + pretty(midiInfo(cur).label)
                        : "Waiting for your voice"}
                    >
                      <circle
                        cx="54"
                        cy="54"
                        r="48"
                        fill="none"
                        stroke="var(--line)"
                        strokeWidth="6"
                      ></circle>
                      <circle
                        cx="54"
                        cy="54"
                        r="48"
                        fill="none"
                        stroke="var(--you)"
                        strokeWidth="6"
                        strokeLinecap="round"
                        strokeDasharray=${(ringC * hold).toFixed(1) +
                        " " +
                        ringC.toFixed(1)}
                        transform="rotate(-90 54 54)"
                      ></circle>
                    </svg>
                    <span
                      style=${{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <span class="label" style=${{ fontSize: 10 }}>Hold</span>
                      <span
                        class="display font-bold"
                        style=${{
                          fontSize: 32,
                          lineHeight: 1,
                          color: cur != null ? "var(--you)" : "var(--muted)",
                        }}
                        aria-live="polite"
                        >${cur != null
                          ? pretty(midiInfo(cur).label)
                          : "—"}</span
                      >
                    </span>
                  </span>
                  <span class="text-xs muted" style=${{ textAlign: "center" }}
                    >Hold a note steady for half a second to count it</span
                  >
                </div>
              </div>`}
          <div class="grid grid-cols-2 gap-2">
            <div
              style=${{
                padding: "10px 12px",
                borderRadius: 12,
                background: "var(--surface-2)",
              }}
            >
              <div class="label">Lowest</div>
              <div class="display font-bold" style=${{ fontSize: 20 }}>
                ${found.low != null
                  ? pretty(midiInfo(found.low).label)
                  : "—"}${found.low != null && step === "high"
                  ? html` <span style=${{ fontSize: 13, color: "var(--good)" }}
                      >✓</span
                    >`
                  : ""}
              </div>
            </div>
            <div
              style=${{
                padding: "10px 12px",
                borderRadius: 12,
                background: "var(--surface-2)",
              }}
            >
              <div class="label">Highest</div>
              <div class="display font-bold" style=${{ fontSize: 20 }}>
                ${found.high != null ? pretty(midiInfo(found.high).label) : "—"}
              </div>
            </div>
          </div>
        </section>
        <div class="grid grid-cols-2 gap-2">
          <button
            class="btn"
            style=${{ justifyContent: "center", minHeight: 46 }}
            onClick=${step === "low" ? cancel : begin}
          >
            ${step === "low" ? "Cancel" : "Start over"}
          </button>
          ${step === "low"
            ? html`<button
                class="btn btn-primary"
                style=${{ justifyContent: "center", minHeight: 46 }}
                onClick=${goHigh}
                disabled=${found.low == null}
              >
                Next: slide up
              </button>`
            : html`<button
                class="btn btn-primary"
                style=${{ justifyContent: "center", minHeight: 46 }}
                onClick=${finish}
                disabled=${found.high == null}
              >
                See my range
              </button>`}
        </div>
      <//>`;
    }

    if (!history.length)
      return html`<${React.Fragment}>
        <section class="tuner-card" style=${{ alignItems: "stretch", gap: 12 }}>
          <span class="display font-bold" style=${{ fontSize: 24 }}
            >Find your range</span
          >
          <p class="text-sm muted" style=${{ margin: 0 }}>
            A 1-minute test to find your lowest and highest notes. You'll slide
            down, then slide up, and Tono notes where your voice stays steady.
          </p>
          <ul
            class="text-sm flex flex-col gap-1"
            style=${{ margin: 0, paddingLeft: 18 }}
          >
            <li>Warm up a little first. Hum or sing something easy.</li>
            <li>
              Go slowly, and stop before it hurts. Straining doesn't count.
            </li>
            <li>A quiet room helps the mic hear you clearly.</li>
          </ul>
        </section>
        <div style=${{ marginTop: "auto" }}>
          <button
            class="btn btn-primary w-full"
            style=${{ justifyContent: "center", minHeight: 48, fontSize: 16 }}
            onClick=${begin}
          >
            Start the test
          </button>
        </div>
      <//>`;

    const r = history[0],
      comfy = comfyOf(r);
    const today = new Date().toDateString();
    const day = (t) =>
      new Date(t).toDateString() === today
        ? "Today"
        : new Date(t).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          });
    const change = (i) => {
      const a = history[i],
        b = history[i + 1];
      if (!b) return "First test";
      const up = a.hi - b.hi,
        down = b.lo - a.lo,
        parts = [];
      if (up) parts.push((up > 0 ? "+" : "−") + Math.abs(up) + " top");
      if (down) parts.push((down > 0 ? "+" : "−") + Math.abs(down) + " low");
      return parts.length ? parts.join(", ") : "Same";
    };
    return html`<${React.Fragment}>
      <section class="tuner-card" style=${{ alignItems: "stretch", gap: 14 }}>
        <div class="flex items-start justify-between gap-3">
          <div class="flex flex-col min-w-0">
            <span class="label">Your range</span>
            <span
              class="display font-bold"
              style=${{ fontSize: 40, lineHeight: 1.05 }}
              >${pretty(midiInfo(r.lo).label)} –
              ${pretty(midiInfo(r.hi).label)}</span
            >
            <span class="text-sm muted">${spanWords(r.lo, r.hi)}</span>
          </div>
          <span
            class="tag"
            style=${{
              background: "color-mix(in srgb, var(--accent) 16%, transparent)",
              color: "var(--accent)",
              fontSize: 13,
              padding: "5px 10px",
              whiteSpace: "nowrap",
            }}
            >${voiceType(r.lo, r.hi)}</span
          >
        </div>
        <${RangeKeys} lo=${r.lo} hi=${r.hi} comfy=${comfy} />
        <div class="flex flex-wrap gap-3 text-xs muted">
          <span class="flex items-center gap-2"
            >${keyDot("var(--accent)")}Comfortable
            ${pretty(midiInfo(comfy[0]).label)}–${pretty(
              midiInfo(comfy[1]).label,
            )}</span
          >
          <span class="flex items-center gap-2"
            >${keyDot(
              "color-mix(in srgb, var(--accent) 42%, #f7f7f4)",
            )}Reachable</span
          >
        </div>
        <p class="text-xs muted" style=${{ margin: 0 }}>
          Voice type is a rough guide from your range. Tone and where your voice
          feels easy matter too, and your range can grow as you practise.
        </p>
      </section>
      ${history.length > 1 &&
      html`<section class="panel p-4 flex flex-col gap-2">
        <span class="label">Past results</span>
        ${history.slice(0, 4).map(
          (h, i) =>
            html`<div
              key=${h.at}
              class="flex items-center justify-between gap-2 text-sm"
              style=${{ color: i ? "var(--muted)" : "var(--fg)" }}
            >
              <span style=${{ width: 64 }}>${day(h.at)}</span
              ><span class="mono" style=${{ fontSize: 13 }}
                >${pretty(midiInfo(h.lo).label)} –
                ${pretty(midiInfo(h.hi).label)}</span
              ><span
                class="text-xs"
                style=${{
                  width: 92,
                  textAlign: "right",
                  color:
                    i === 0 && /\+/.test(change(0)) ? "var(--good)" : undefined,
                }}
                >${change(i)}</span
              >
            </div>`,
        )}
      </section>`}
      <div style=${{ marginTop: "auto" }}>
        <button
          class="btn btn-primary w-full"
          style=${{ justifyContent: "center", minHeight: 48, fontSize: 16 }}
          onClick=${begin}
        >
          Test again
        </button>
      </div>
    <//>`;
  }

  // Practice: how the loaded song sits against the singer's saved range
  function SongFit({
    notes,
    tr,
    phrases,
    linesIn,
    nameOf,
    active,
    onPractice,
    onFind,
  }) {
    const mine = useMemo(() => loadRanges()[0] || null, [active]);
    if (!notes.length) return null;
    if (!mine)
      return html`<section
        class="panel p-4 flex items-center gap-3"
        style=${{ borderStyle: "dashed" }}
      >
        <span class="text-sm muted" style=${{ flex: 1 }}
          >No range yet? Take the 1-minute test in Tuner to see how songs fit
          you.</span
        >
        <button
          class="link-btn text-sm"
          style=${{ whiteSpace: "nowrap" }}
          onClick=${onFind}
        >
          Find my range
        </button>
      </section>`;
    let slo = 999,
      shi = 0;
    notes.forEach((n) => {
      slo = Math.min(slo, n.midi + tr);
      shi = Math.max(shi, n.midi + tr);
    });
    const highs = new Set(),
      lows = new Set();
    notes.forEach((n) => {
      const m = n.midi + tr;
      if (m > mine.hi) highs.add(m);
      if (m < mine.lo) lows.add(m);
    });
    const out = highs.size + lows.size;
    const status = !out
      ? ["Fits you", "good"]
      : highs.size && lows.size
        ? ["Wider than your range", "warn"]
        : highs.size
          ? [out <= 3 ? "A bit high" : "High for you", "warn"]
          : [out <= 3 ? "A bit low" : "Low for you", "warn"];
    const hard = phrases
      .map((ph) => {
        let top = null,
          bottom = null;
        ph.notes.forEach((n) => {
          const m = n.midi + tr;
          if (m > mine.hi && (top == null || m > top)) top = m;
          if (m < mine.lo && (bottom == null || m < bottom)) bottom = m;
        });
        return top != null || bottom != null
          ? { ph, m: top != null ? top : bottom }
          : null;
      })
      .filter(Boolean);
    const outNames = [...highs, ...lows];
    return html`<section class="panel p-4 flex flex-col gap-3">
      <div class="flex items-center justify-between gap-2">
        <h3 class="display text-lg font-bold">Song vs your range</h3>
        <span class=${"tag tag-" + status[1]}>${status[0]}</span>
      </div>
      <${RangeKeys}
        lo=${mine.lo}
        hi=${mine.hi}
        comfy=${comfyOf(mine)}
        song=${[slo, shi]}
      />
      <div class="flex flex-wrap gap-3 text-xs muted">
        <span class="flex items-center gap-2"
          ><span
            style=${{
              width: 14,
              height: 5,
              borderRadius: 3,
              background: "var(--you)",
            }}
          ></span
          >Song
          ${pretty(midiInfo(slo).label)}–${pretty(midiInfo(shi).label)}</span
        >
        <span class="flex items-center gap-2"
          >${keyDot("var(--accent)")}You
          ${pretty(midiInfo(mine.lo).label)}–${pretty(
            midiInfo(mine.hi).label,
          )}</span
        >
        ${out > 0 &&
        html`<span class="flex items-center gap-2"
          ><span
            style=${{
              width: 14,
              height: 5,
              borderRadius: 3,
              background: "var(--bad)",
            }}
          ></span
          >Outside your range</span
        >`}
      </div>
      ${!out
        ? html`<p class="text-sm" style=${{ margin: 0 }}>
            Every note is inside your range. Nice pick!
          </p>`
        : html`<p class="text-sm" style=${{ margin: 0 }}>
              <b>${out} note${out > 1 ? "s" : ""}</b> (${outNames
                .map((m) => pretty(midiInfo(m).label))
                .join(", ")})
              ${(highs.size && lows.size
                ? "go outside"
                : highs.size
                  ? "go above"
                  : "go below"
              ).replace(/^go/, out > 1 ? "go" : "goes")}
              your range, in
              <b>${hard.length} phrase${hard.length > 1 ? "s" : ""}</b>:
            </p>
            <div class="flex flex-col gap-2">
              ${hard.slice(0, 5).map(({ ph, m }) => {
                const w = linesIn(ph.start, ph.end);
                return html`<div
                  key=${ph.i}
                  class="flex items-center gap-3"
                  style=${{
                    padding: "8px 12px",
                    borderRadius: 12,
                    background: "var(--surface-2)",
                  }}
                >
                  <span class="mono text-xs muted">${fmt(ph.start)}</span>
                  <span
                    class="text-sm"
                    style=${{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    >${w.length ? w.join(" / ") : "Phrase " + (ph.i + 1)}</span
                  >
                  <span class="mono text-xs" style=${{ color: "var(--bad)" }}
                    >${pretty(midiInfo(m).label)}</span
                  >
                  <button
                    class="link-btn text-sm"
                    onClick=${() => onPractice(ph)}
                  >
                    Practise
                  </button>
                </div>`;
              })}
              ${hard.length > 5 &&
              html`<span class="text-xs muted"
                >…and ${hard.length - 5} more in the phrase list.</span
              >`}
            </div>
            <p class="text-xs muted" style=${{ margin: 0 }}>
              Tip:
              ${highs.size
                ? "sing the high notes lightly, or drop them an octave for now."
                : "sing the low notes softly, or take them up an octave for now."}${highs.size &&
              lows.size
                ? " Low ones can go up an octave."
                : ""}
            </p>`}
    </section>`;
  }

  function MatchTrainer({
    hookRef,
    listening,
    onStartMic,
    onStopMic,
    onTarget,
    onStatus,
    sung,
    live,
    level,
    error,
  }) {
    const [target, setTarget] = useState(null);
    const [tmode, setTmode] = useState(() =>
      loadJSON(MATCH_KEY + ".mode", "free"),
    );
    const [optOpen, setOptOpen] = useState(false);
    const [baseOct, setBaseOct] = useState(4);
    const [range, setRange] = useState(() =>
      loadJSON(MATCH_KEY + ".range", "mid"),
    );
    const [diff, setDiff] = useState(() =>
      loadJSON(MATCH_KEY + ".diff", "normal"),
    );
    const [anyOct, setAnyOct] = useState(() =>
      loadJSON(MATCH_KEY + ".anyoct", true),
    );
    const [autoNext, setAutoNext] = useState(() =>
      loadJSON(MATCH_KEY + ".auto", true),
    );
    const [phase, setPhase] = useState("idle"); // idle | listen | sing | hit
    const [cents, setCents] = useState(null);
    const [hold, setHold] = useState(0);
    const [streak, setStreak] = useState(0);
    const [lastTime, setLastTime] = useState(null);
    const [stats, setStats] = useState(() =>
      loadJSON(MATCH_KEY + ".stats", { hits: 0, best: null }),
    );
    const r = useRef({
      target: null,
      setAt: 0,
      holdStart: 0,
      ignoreUntil: 0,
      matched: false,
      ctx: null,
      timers: [],
    });
    const opts = useRef({});
    const rangeFeed = useRef(null);
    opts.current = { tol: TOLS[diff], anyOct, autoNext, range };

    const ctx = () => {
      const s = r.current;
      if (!s.ctx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        s.ctx = new Ctx();
      }
      if (s.ctx.state === "suspended") s.ctx.resume().catch(() => {});
      return s.ctx;
    };
    const later = (fn, ms) => {
      const id = setTimeout(fn, ms);
      r.current.timers.push(id);
    };
    useEffect(
      () => () => {
        hookRef.current = null;
        onTarget(null);
        onStatus && onStatus(null);
        r.current.timers.forEach(clearTimeout);
        if (r.current.ctx) r.current.ctx.close().catch(() => {});
      },
      [],
    );

    const choose = (midi) => {
      const s = r.current;
      s.timers.forEach(clearTimeout);
      s.timers = [];
      if (s.target != null && !s.matched) setStreak(0); // moved on without hitting it
      s.target = midi;
      s.matched = false;
      s.holdStart = 0;
      // ignore the mic while the piano rings, so the app doesn't "hear" its own note
      s.ignoreUntil = performance.now() + PIANO_QUIET;
      s.setAt = s.ignoreUntil;
      setTarget(midi);
      setCents(null);
      setHold(0);
      setPhase("listen");
      onTarget({ midi, matched: false });
      const oct = Math.floor(midi / 12) - 1;
      setBaseOct((b) =>
        midi >= 12 * (b + 1) && midi <= 12 * (b + 1) + 12
          ? b
          : Math.max(2, Math.min(5, oct)),
      );
      playPiano(ctx(), midi);
      later(() => setPhase((p) => (p === "listen" ? "sing" : p)), PIANO_QUIET);
    };
    const random = () => {
      const [lo, hi] = RANGES[opts.current.range];
      let m;
      do {
        m = lo + Math.floor(Math.random() * (hi - lo + 1));
      } while (m === r.current.target && hi > lo);
      choose(m);
    };
    const replay = () => {
      const s = r.current;
      if (s.target == null) return;
      s.ignoreUntil = performance.now() + PIANO_QUIET;
      s.holdStart = 0;
      setHold(0);
      if (!s.matched) {
        setPhase("listen");
        later(
          () => setPhase((p) => (p === "listen" ? "sing" : p)),
          PIANO_QUIET,
        );
      }
      playPiano(ctx(), s.target);
    };

    // called by the microphone loop on every frame: m = sung pitch (fractional MIDI) or null for silence
    hookRef.current = (m, now) => {
      if (tmode === "range") {
        if (rangeFeed.current) rangeFeed.current(m, now);
        return;
      }
      const s = r.current,
        o = opts.current;
      if (s.target == null || s.matched || now < s.ignoreUntil) return;
      if (m == null) {
        if (s.holdStart) {
          s.holdStart = 0;
          setHold(0);
        }
        setCents(null);
        return;
      }
      let d = m - s.target;
      if (o.anyOct) d -= 12 * Math.round(d / 12);
      const c = Math.round(d * 100);
      setCents(c);
      if (Math.abs(c) <= o.tol) {
        if (!s.holdStart) s.holdStart = now;
        const h = Math.min(1, (now - s.holdStart) / 500);
        setHold(h);
        if (h >= 1) {
          s.matched = true;
          setPhase("hit");
          onTarget({ midi: s.target, matched: true });
          playChime(ctx());
          const secs = Math.max(0, (now - s.setAt) / 1000);
          setLastTime(secs);
          setStreak((v) => v + 1);
          setStats((st) => {
            const next = {
              hits: st.hits + 1,
              best: st.best == null ? secs : Math.min(st.best, secs),
            };
            saveJSON(MATCH_KEY + ".stats", next);
            return next;
          });
          if (o.autoNext) later(random, 1400);
        }
      } else if (s.holdStart) {
        s.holdStart = 0;
        setHold(0);
      }
    };

    const tol = TOLS[diff];
    useEffect(() => {
      onStatus &&
        onStatus(
          target == null ? null : { midi: target, cents, hold, tol, phase },
        );
    }, [target, cents, hold, tol, phase]);
    let hint,
      tone = "muted";
    if (target == null)
      hint = "Pick a note on the keyboard, or tap Random note.";
    else if (phase === "hit") {
      hint = "Matched!";
      tone = "good";
    } else if (!listening) hint = "Tap Start listening, then sing the note.";
    else if (phase === "listen") hint = "Listen…";
    else if (cents == null) hint = "Your turn. Sing the note.";
    else if (Math.abs(cents) <= tol) {
      hint = "Hold it…";
      tone = "good";
    } else if (cents < 0) {
      hint = cents < -Math.max(2 * tol, 50) ? "Go up ↑" : "A little higher ↑";
      tone = "warn";
    } else {
      hint = cents > Math.max(2 * tol, 50) ? "Go down ↓" : "A little lower ↓";
      tone = "warn";
    }
    const save = (k, v) => saveJSON(MATCH_KEY + "." + k, v);
    const small = { padding: "5px 10px", fontSize: 13 };
    const tInfo = target != null ? midiInfo(target) : null;

    const switchMode = (m) => {
      setTmode(m);
      save("mode", m);
      if (m !== "match") {
        const st = r.current;
        st.timers.forEach(clearTimeout);
        st.timers = [];
        st.target = null;
        st.matched = false;
        setTarget(null);
        setPhase("idle");
        setCents(null);
        setHold(0);
        onTarget(null);
      }
    };
    const startBtn = html`<button
      class="btn btn-primary"
      style=${{
        minHeight: 52,
        fontSize: 16,
        padding: "0 22px",
        justifyContent: "center",
      }}
      onClick=${onStartMic}
    >
      <span class="flex items-center gap-2"
        ><${Icon} name="mic" size=${20} />Tap to start listening</span
      >
    </button>`;
    const freeTone = !live
      ? "muted"
      : Math.abs(live.cents) <= 10
        ? "good"
        : Math.abs(live.cents) <= 25
          ? "warn"
          : "bad";
    const lInfo = live ? midiInfo(live.midi) : null;
    const sungInfo = sung != null ? midiInfo(sung) : null;
    const ringC = 2 * Math.PI * 50;

    return html`<div class="tuner-screen">
      <div class="flex items-center gap-2">
        <div
          class="mode-seg"
          role="group"
          aria-label="Tuner mode"
          style=${{ flex: 1, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}
        >
          <button
            aria-pressed=${tmode === "free" ? "true" : "false"}
            onClick=${() => switchMode("free")}
          >
            Free
          </button>
          <button
            aria-pressed=${tmode === "match" ? "true" : "false"}
            onClick=${() => switchMode("match")}
          >
            Match a note
          </button>
          <button
            aria-pressed=${tmode === "range" ? "true" : "false"}
            onClick=${() => switchMode("range")}
          >
            My range
          </button>
        </div>
      </div>
      ${error && html`<div class="notice" role="alert">${error}</div>`}
      ${tmode === "range"
        ? html`<${RangeFinder}
            feedRef=${rangeFeed}
            listening=${listening}
            onStartMic=${onStartMic}
            onStopMic=${onStopMic}
          />`
        : tmode === "free"
          ? html`<${React.Fragment}>
              <section class="tuner-card" style=${{ flex: 1 }}>
                <${Dial}
                  cents=${live ? live.cents : null}
                  tol=${10}
                  tone=${freeTone}
                  lowLabel="−50¢"
                  highLabel="+50¢"
                />
                ${listening
                  ? html`<div class="flex flex-col items-center gap-1">
                      <span class="flex items-start gap-1">
                        <span
                          class="display font-bold"
                          style=${{
                            fontSize: 88,
                            lineHeight: 0.9,
                            color: lInfo
                              ? "var(--" + freeTone + ")"
                              : "var(--muted)",
                          }}
                          >${lInfo
                            ? lInfo.letter + (lInfo.sharp ? "♯" : "")
                            : "—"}</span
                        >
                        ${lInfo &&
                        html`<span
                          class="mono font-semibold"
                          style=${{ fontSize: 30, marginTop: 44 }}
                          >${lInfo.octave}</span
                        >`}
                      </span>
                      <span class="mono text-sm muted"
                        >${live
                          ? live.freq.toFixed(1) +
                            " Hz · " +
                            signed(live.cents) +
                            "¢"
                          : "Sing or play a note"}</span
                      >
                      ${live &&
                      html`<span
                        class=${"tag tag-" + freeTone}
                        style=${{ fontSize: 13, padding: "4px 12px" }}
                        >${Math.abs(live.cents) <= 10
                          ? "In tune"
                          : live.cents > 0
                            ? "A little sharp"
                            : "A little flat"}</span
                      >`}
                    </div>`
                  : html`<div class="flex flex-col items-center gap-3 py-2">
                      ${startBtn}<span class="text-xs muted"
                        >See which note you're singing, and how close you
                        are.</span
                      >
                    </div>`}
              </section>
              ${listening &&
              html`<div class="listen-bar">
                <span class="flex items-center gap-2 text-sm"
                  ><span class="rec-dot"></span>Listening</span
                >
                <span class="level" style=${{ flex: 1, height: 5 }}
                  ><div style=${{ width: level * 100 + "%" }}></div
                ></span>
                <button
                  class="btn"
                  style=${{ padding: "6px 12px", fontSize: 13 }}
                  onClick=${onStopMic}
                >
                  Stop
                </button>
              </div>`}
            <//>`
          : html`<${React.Fragment}>
              <div class="flex flex-wrap gap-2">
                <span class="chip"
                  ><span class="muted text-xs">Streak</span
                  ><b class="mono">${streak}</b></span
                >
                <span class="chip"
                  ><span class="muted text-xs">Last</span
                  ><b class="mono"
                    >${lastTime == null ? "—" : lastTime.toFixed(1) + " s"}</b
                  ></span
                >
                <span class="chip"
                  ><span class="muted text-xs">Best</span
                  ><b class="mono"
                    >${stats.best == null
                      ? "—"
                      : stats.best.toFixed(1) + " s"}</b
                  ></span
                >
              </div>
              <section class=${"tuner-card" + (phase === "hit" ? " hit" : "")}>
                <${Dial}
                  cents=${target != null && listening && phase !== "listen"
                    ? phase === "hit"
                      ? 0
                      : cents
                    : null}
                  tol=${tol}
                  tone=${phase === "hit" ||
                  (cents != null && Math.abs(cents) <= tol)
                    ? "good"
                    : "warn"}
                  lowLabel="too low"
                  highLabel="too high"
                  zoneSoft=${true}
                />
                <div
                  class="flex items-center justify-center gap-5"
                  style=${{ minHeight: 112 }}
                >
                  <span
                    style=${{
                      position: "relative",
                      width: 112,
                      height: 112,
                      flexShrink: 0,
                    }}
                  >
                    <svg
                      width="112"
                      height="112"
                      viewBox="0 0 112 112"
                      role="img"
                      aria-label=${"Hold progress " +
                      Math.round((phase === "hit" ? 1 : hold) * 100) +
                      " percent"}
                    >
                      <circle
                        cx="56"
                        cy="56"
                        r="50"
                        fill=${phase === "hit"
                          ? "color-mix(in srgb, var(--good) 18%, transparent)"
                          : "none"}
                        stroke="var(--line)"
                        strokeWidth="6"
                      ></circle>
                      <circle
                        cx="56"
                        cy="56"
                        r="50"
                        fill="none"
                        stroke="var(--good)"
                        strokeWidth="6"
                        strokeLinecap="round"
                        strokeDasharray=${(
                          ringC * (phase === "hit" ? 1 : hold)
                        ).toFixed(1) +
                        " " +
                        ringC.toFixed(1)}
                        transform="rotate(-90 56 56)"
                      ></circle>
                    </svg>
                    <span
                      style=${{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <span class="label" style=${{ fontSize: 10 }}
                        >Target</span
                      >
                      <span
                        class="display font-bold"
                        style=${{
                          fontSize: 38,
                          lineHeight: 1,
                          color:
                            phase === "hit"
                              ? "var(--good)"
                              : tInfo
                                ? "var(--fg)"
                                : "var(--muted)",
                        }}
                        >${tInfo ? pretty(tInfo.label) : "—"}</span
                      >
                    </span>
                  </span>
                  <span class="flex flex-col gap-1 min-w-0">
                    ${listening &&
                    target != null &&
                    phase !== "listen" &&
                    html`<span class="text-xs muted">You're singing</span>
                      <span
                        class="display font-bold"
                        style=${{ fontSize: 24, color: "var(--you)" }}
                        >${sungInfo ? pretty(sungInfo.label) : "—"}</span
                      >`}
                    <span
                      class="display font-bold"
                      style=${{
                        fontSize: 21,
                        lineHeight: 1.2,
                        color: "var(--" + tone + ")",
                      }}
                      aria-live="polite"
                      >${hint}</span
                    >
                  </span>
                </div>
                ${!listening &&
                target != null &&
                html`<div class="flex justify-center">${startBtn}</div>`}
              </section>

              <div class="tuner-actions">
                <button
                  class="btn btn-primary"
                  style=${{ justifyContent: "center", minHeight: 44 }}
                  onClick=${random}
                >
                  Random
                </button>
                <button
                  class="btn"
                  style=${{ justifyContent: "center", minHeight: 44 }}
                  onClick=${replay}
                  disabled=${target == null}
                >
                  Play again
                </button>
                <button
                  class=${"btn" + (listening ? "" : "")}
                  style=${{ justifyContent: "center", minHeight: 44 }}
                  onClick=${listening ? onStopMic : onStartMic}
                  aria-label=${listening ? "Stop listening" : "Start listening"}
                >
                  <span class="flex items-center gap-2"
                    >${listening
                      ? html`<span class="rec-dot"></span>On`
                      : html`<${Icon} name="mic" size=${18} />Off`}</span
                  >
                </button>
                <button
                  class="icon-btn"
                  onClick=${() => setOptOpen(true)}
                  aria-label="Tuner options"
                >
                  <${Icon} name="sliders" />
                </button>
              </div>

              <section
                class="flex flex-col gap-2"
                style=${{ marginTop: "auto" }}
                aria-label="Piano keyboard"
              >
                <div class="flex items-center justify-between">
                  <button
                    class="icon-btn"
                    style=${{ height: 36 }}
                    onClick=${() => setBaseOct((b) => Math.max(2, b - 1))}
                    disabled=${baseOct <= 2}
                    aria-label="Lower octave"
                  >
                    <${Icon} name="back" size=${18} />
                  </button>
                  <span class="mono text-xs muted"
                    >C${baseOct} – C${baseOct + 1}</span
                  >
                  <button
                    class="icon-btn"
                    style=${{ height: 36, transform: "scaleX(-1)" }}
                    onClick=${() => setBaseOct((b) => Math.min(5, b + 1))}
                    disabled=${baseOct >= 5}
                    aria-label="Higher octave"
                  >
                    <${Icon} name="back" size=${18} />
                  </button>
                </div>
                <${Keyboard}
                  baseOct=${baseOct}
                  target=${target}
                  matched=${phase === "hit"}
                  sung=${sung}
                  onKey=${choose}
                />
              </section>
            <//>`}

      <${Sheet}
        open=${optOpen}
        title="Tuner options"
        onClose=${() => setOptOpen(false)}
      >
        <div class="opt-group">
          <span class="label">How close counts</span>
          <div class="seg" role="group" aria-label="Difficulty">
            ${[
              ["easy", "Easy"],
              ["normal", "Normal"],
              ["hard", "Hard"],
            ].map(
              ([k, l]) =>
                html`<button
                  key=${k}
                  aria-pressed=${diff === k ? "true" : "false"}
                  onClick=${() => {
                    setDiff(k);
                    save("diff", k);
                  }}
                >
                  ${l}
                </button>`,
            )}
          </div>
          <p class="text-xs muted">
            ${diff === "easy"
              ? "Easy: within half a piano key."
              : diff === "normal"
                ? "Normal: within a quarter of a piano key."
                : "Hard: within a tenth of a piano key."}
            Hold it for half a second to count.
          </p>
        </div>
        <div class="opt-group">
          <span class="label">Random notes from</span>
          <div
            class="seg"
            role="group"
            aria-label="Voice range for random notes"
          >
            ${Object.entries(RANGES).map(
              ([k, v]) =>
                html`<button
                  key=${k}
                  aria-pressed=${range === k ? "true" : "false"}
                  onClick=${() => {
                    setRange(k);
                    save("range", k);
                  }}
                >
                  ${v[2]} voice
                </button>`,
            )}
          </div>
        </div>
        <div class="opt-group">
          <button
            class="switch"
            role="switch"
            aria-checked=${anyOct ? "true" : "false"}
            onClick=${() => {
              setAnyOct(!anyOct);
              save("anyoct", !anyOct);
            }}
            style=${{ fontSize: 14, alignSelf: "flex-start" }}
          >
            <span class="track"><span class="knob"></span></span>Any octave
            counts
          </button>
          <button
            class="switch"
            role="switch"
            aria-checked=${autoNext ? "true" : "false"}
            onClick=${() => {
              setAutoNext(!autoNext);
              save("auto", !autoNext);
            }}
            style=${{ fontSize: 14, alignSelf: "flex-start" }}
          >
            <span class="track"><span class="knob"></span></span>Auto next note
          </button>
          <p class="text-xs muted">
            Total hits: ${stats.hits}. The app ignores the mic while the piano
            note rings, so it never hears itself.
          </p>
        </div>
      <//>
    </div>`;
  }

// semicircle tuner dial: needle at -50..+50 cents, green zone of +/- tol
  /* ---------- app-wide settings ---------- */
  function SettingsPanel({ listening, level, onClose, onMicChange, onChange }) {
    const [devices, setDevices] = useState([]);
    const [, force] = useState(0);
    useEffect(() => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices)
        return;
      navigator.mediaDevices
        .enumerateDevices()
        .then((d) => setDevices(d.filter((x) => x.kind === "audioinput")))
        .catch(() => {});
    }, [listening]);
    const set = (k, v) => {
      SETTINGS[k] = v;
      saveSettings();
      force((n) => n + 1);
      onChange && onChange();
    };
    const small = { padding: "5px 10px", fontSize: 13 };
    return html`<section class="panel p-4 sm:p-5 flex flex-col gap-4">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h2 class="display text-lg font-bold">Settings</h2>
          <p class="text-xs muted">
            These apply to the whole app and are saved on this device.
          </p>
        </div>
        <button class="btn btn-ghost" style=${small} onClick=${onClose}>
          Done
        </button>
      </div>
      <div class="flex flex-col gap-2">
        <span class="label">Tuning reference (A4)</span>
        <div class="flex flex-wrap items-center gap-2">
          <div class="seg" role="group" aria-label="A4 presets">
            ${[432, 440, 442].map(
              (v) =>
                html`<button
                  key=${v}
                  aria-pressed=${SETTINGS.a4 === v ? "true" : "false"}
                  onClick=${() => set("a4", v)}
                >
                  ${v} Hz
                </button>`,
            )}
          </div>
          <button
            class="btn"
            style=${small}
            onClick=${() => set("a4", Math.max(415, SETTINGS.a4 - 1))}
            aria-label="Lower A4 by 1 hertz"
          >
            −
          </button>
          <span class="mono text-sm">A4 = ${SETTINGS.a4} Hz</span>
          <button
            class="btn"
            style=${small}
            onClick=${() => set("a4", Math.min(466, SETTINGS.a4 + 1))}
            aria-label="Raise A4 by 1 hertz"
          >
            +
          </button>
        </div>
        <p class="text-xs muted">
          440 Hz is standard. Change it only if your instrument or song is tuned
          differently. It shifts the piano, guide notes and note detection
          together; songs you already uploaded keep the setting they were
          analyzed with.
        </p>
      </div>
      <div class="flex flex-col gap-2">
        <label class="label" for="sens">Mic sensitivity</label>
        <div class="flex items-center gap-3">
          <span class="text-xs muted">Less</span>
          <input
            id="sens"
            type="range"
            min="1"
            max="10"
            step="1"
            value=${SETTINGS.sens}
            onInput=${(e) => set("sens", parseInt(e.target.value, 10))}
            onChange=${(e) => set("sens", parseInt(e.target.value, 10))}
            style=${{ flex: 1, accentColor: "var(--accent)" }}
          />
          <span class="text-xs muted">More</span>
          <span class="mono text-xs" style=${{ width: 20, textAlign: "right" }}
            >${SETTINGS.sens}</span
          >
        </div>
        ${listening &&
        html`<div class="level" style=${{ height: 6 }} title="Input level">
          <div style=${{ width: level * 100 + "%" }}></div>
        </div>`}
        <p class="text-xs muted">
          Turn it up if the app misses your voice. Turn it down if it reacts to
          background noise.
        </p>
      </div>
      <div class="flex flex-col gap-2">
        <label class="label" for="mic-pick">Microphone</label>
        ${devices.length > 1
          ? html`<select
              id="mic-pick"
              class="btn"
              style=${{ justifyContent: "flex-start", maxWidth: "100%" }}
              value=${SETTINGS.micId}
              onChange=${(e) => {
                set("micId", e.target.value);
                onMicChange && onMicChange();
              }}
            >
              <option value="">System default</option>
              ${devices.map(
                (d, i) =>
                  html`<option key=${d.deviceId || i} value=${d.deviceId}>
                    ${d.label || "Microphone " + (i + 1)}
                  </option>`,
              )}
            </select>`
          : html`<p class="text-sm muted">
              Using the default
              microphone.${devices.length === 0
                ? " Other microphones show up here after you allow mic access."
                : ""}
            </p>`}
      </div>
      <div class="flex flex-col gap-2">
        <span class="label">Note detection</span>
        <button
          class="switch"
          role="switch"
          aria-checked=${SETTINGS.ai ? "true" : "false"}
          onClick=${() => set("ai", !SETTINGS.ai)}
          style=${{ fontSize: 14, alignSelf: "flex-start" }}
        >
          <span class="track"><span class="knob"></span></span>High-accuracy
          notes (AI)
        </button>
        <p class="text-xs muted">
          Experimental. Uses Spotify's Basic Pitch model on this device to split
          notes where it hears a new syllable starting on the same pitch. It
          helps a little with fast lines, can add a few extra notes, takes a
          while on slower phones, and is a one-time 2.5 MB download. The result
          is saved per song. Applies to the next song you load.
        </p>
      </div>
      <div class="flex flex-col gap-1">
        <span class="label">Credits</span>
        <p class="text-xs muted">
          Splitting songs into voice and music uses an MDX-Net model from
          <a
            href="https://github.com/Anjok07/ultimatevocalremovergui"
            target="_blank"
            rel="noopener"
            style=${{ color: "var(--accent)" }}
            >Ultimate Vocal Remover</a
          >
          (MIT licence), run with ONNX Runtime. Thanks to UVR and its
          developers.
        </p>
      </div>
    </section>`;
  }

  /* ---------- AI note detection (Spotify Basic Pitch, runs on this device) ---------- */
  function SongLibrary({ onLoad, current, inline }) {
    const [songs, setSongs] = useState(null);
    const [err, setErr] = useState("");
    const [busy, setBusy] = useState(null); // { id, step }
    const [open, setOpen] = useState(!!inline);
    const blockedHere = !DRIVE_KEY || !/github\.io$/.test(location.hostname);
    useEffect(() => {
      if (!open || songs || blockedHere) return;
      driveList(DRIVE_FOLDER)
        .then((fs) =>
          setSongs(
            fs.filter(
              (f) => f.mimeType === "application/vnd.google-apps.folder",
            ),
          ),
        )
        .catch(() =>
          setErr(
            "Couldn't reach the song folder. Check your connection and try again.",
          ),
        );
    }, [open]);
    const load = async (song) => {
      setErr("");
      setBusy({ id: song.id, step: "Finding files…" });
      try {
        const parts = sortSongFiles(await driveList(song.id));
        if (!parts.vocal) throw new Error("no vocal");
        let lyricText = null;
        if (parts.lrc) {
          setBusy({ id: song.id, step: "Getting lyrics…" });
          lyricText = await (await driveFile(parts.lrc)).text();
        }
        setBusy({ id: song.id, step: "Downloading vocal…" });
        const vBlob = await driveFile(parts.vocal);
        let iBlob = null;
        if (parts.inst) {
          setBusy({ id: song.id, step: "Downloading music…" });
          iBlob = await driveFile(parts.inst);
        }
        await onLoad({
          name: song.name,
          vocal: new File([vBlob], parts.vocal.name, {
            type: vBlob.type || "audio/mpeg",
          }),
          inst: iBlob
            ? new File([iBlob], parts.inst.name, {
                type: iBlob.type || "audio/mpeg",
              })
            : null,
          lyricText,
          lyricName: parts.lrc ? parts.lrc.name : null,
        });
        if (!inline) setOpen(false);
      } catch (e) {
        setErr(
          e && e.message === "no vocal"
            ? "That song folder has no audio files."
            : "Couldn't download that song. Try again in a moment.",
        );
      }
      setBusy(null);
    };
    return html`<div
      class=${inline ? "flex flex-col gap-3" : "panel p-4 flex flex-col gap-3"}
    >
      <div
        class="flex flex-wrap items-center justify-between gap-3"
        hidden=${inline}
      >
        <div class="min-w-0">
          <span class="label">Sample songs</span>
          <p class="text-sm">
            ${current
              ? html`Now loaded: <b>${current}</b>`
              : "Pick a song to load its vocal, music and lyrics in one go."}
          </p>
        </div>
        <button
          class=${"btn" + (open ? "" : " btn-primary")}
          onClick=${() => setOpen((v) => !v)}
          aria-expanded=${open ? "true" : "false"}
        >
          ${open ? "Close" : "Browse songs"}
        </button>
      </div>
      ${open &&
      (blockedHere
        ? html`<p class="text-sm muted">
            ${!DRIVE_KEY
              ? "The song library isn't connected yet."
              : "The song library works on your Tono website (seeknowhere.github.io). Here, upload the files yourself below."}
          </p>`
        : html`<div class="flex flex-col gap-2">
            ${err &&
            html`<p class="text-sm" style=${{ color: "var(--bad)" }}>
              ${err}
            </p>`}
            ${!songs &&
            !err &&
            html`<p class="text-sm muted">Loading songs…</p>`}
            ${songs &&
            songs.length === 0 &&
            html`<p class="text-sm muted">
              No songs yet. Add a folder per song inside Tono › Songs in your
              Google Drive.
            </p>`}
            ${songs &&
            songs.map(
              (sg) =>
                html`<div key=${sg.id} class="song-row">
                  <span class="flex items-center gap-3 min-w-0">
                    <span class="song-ico"
                      ><${Icon} name="music" size=${20}
                    /></span>
                    <span
                      class="display font-bold"
                      style=${{ overflowWrap: "anywhere" }}
                      >${sg.name}</span
                    >
                  </span>
                  ${busy && busy.id === sg.id
                    ? html`<span class="text-xs muted">${busy.step}</span>`
                    : current === sg.name
                      ? html`<span
                          class="flex items-center gap-1 text-xs"
                          style=${{ color: "var(--good)" }}
                          ><${Icon} name="check" size=${16} />Loaded</span
                        >`
                      : html`<button
                          class="btn btn-primary"
                          style=${{ padding: "6px 14px", fontSize: 13 }}
                          disabled=${!!busy}
                          onClick=${() => load(sg)}
                        >
                          Load
                        </button>`}
                </div>`,
            )}
            <p class="text-xs muted">
              Add more in Google Drive › Tono › Songs. Each song downloads once,
              then loads instantly.
            </p>
          </div>`)}
    </div>`;
  }

  function FileRow({ id, title, sub, slot, onPick, disabled }) {
    const ref = useRef(null);
    const ready = slot && (slot.data || slot.buffer);
    return html`<div class="file-row">
      <span class="flex flex-col min-w-0" style=${{ flex: 1 }}>
        <span class="font-semibold text-sm">${title}</span>
        <span class="text-xs muted" style=${{ overflowWrap: "anywhere" }}
          >${slot && slot.busy
            ? slot.progress != null
              ? "Analyzing " + Math.round(slot.progress * 100) + "%"
              : "Reading…"
            : slot && slot.error
              ? slot.error
              : ready
                ? slot.name
                : sub}</span
        >
      </span>
      ${ready &&
      html`<span style=${{ color: "var(--good)" }}
        ><${Icon} name="check" size=${18}
      /></span>`}
      <button
        class="btn"
        style=${{ padding: "6px 12px", fontSize: 13 }}
        disabled=${disabled || (slot && slot.busy)}
        onClick=${() => ref.current && ref.current.click()}
      >
        ${ready ? "Replace" : "Upload"}
      </button>
      <input
        id=${id}
        ref=${ref}
        type="file"
        class="hidden"
        onChange=${(e) => {
          const f = e.target.files && e.target.files[0];
          e.target.value = "";
          if (f) onPick(f);
        }}
      />
    </div>`;
  }
  // the song picker: sample songs first, then your own files
  function SplitRow({ split, onSplit, onCancel }) {
    const ref = useRef(null);
    const [gpu, setGpu] = useState(null);
    useEffect(() => {
      hasWebGPU().then(setGpu);
    }, []);
    const busy = split && !split.error && !split.done;
    const pct = busy ? Math.round((split.p || 0) * 100) : 0;
    const left =
      busy && split.stage === "split" && split.p > 0.02 && split.t0
        ? Math.max(0, ((Date.now() - split.t0) / 1000) * (1 / split.p - 1))
        : null;
    const msg = !split
      ? gpu === false
        ? "Any song file with singing and music. This device can't use its graphics chip, so splitting may take 10+ minutes."
        : "Any song file with singing and music. Tono splits the voice from the music on your device, about a minute on most laptops."
      : split.error
        ? split.error
        : split.done
          ? "Split " + split.name + "."
          : split.stage === "decode"
            ? "Reading " + split.name + "…"
            : split.stage === "model"
              ? "Downloading the splitter (once): " + pct + "%"
              : split.stage === "start"
                ? "Starting the splitter…"
                : "Splitting voice from music… " +
                  pct +
                  "%" +
                  (left != null
                    ? " · about " +
                      (left < 60
                        ? Math.ceil(left / 5) * 5 + " s"
                        : Math.ceil(left / 60) + " min") +
                      " left"
                    : "");
    return html`<div
      class="file-row"
      style=${{
        flexDirection: "column",
        alignItems: "stretch",
        gap: 10,
        borderColor: "color-mix(in srgb, var(--accent) 45%, var(--line))",
      }}
    >
      <div class="flex items-center gap-3">
        <span class="flex flex-col min-w-0" style=${{ flex: 1 }}>
          <span class="font-semibold text-sm">Load a song</span>
          <span
            class="text-xs muted"
            role="status"
            style=${{
              overflowWrap: "anywhere",
              color: split && split.error ? "var(--warn)" : undefined,
            }}
            >${msg}</span
          >
        </span>
        ${busy
          ? html`<button
              class="btn"
              style=${{ padding: "6px 12px", fontSize: 13 }}
              onClick=${onCancel}
            >
              Stop
            </button>`
          : html`<button
              class="btn btn-primary"
              style=${{ padding: "6px 12px", fontSize: 13 }}
              onClick=${() => ref.current && ref.current.click()}
            >
              Choose song
            </button>`}
        <input
          id="setup-song"
          ref=${ref}
          type="file"
          accept="audio/*,.mp3,.m4a,.wav,.flac,.ogg"
          class="hidden"
          onChange=${(e) => {
            const f = e.target.files && e.target.files[0];
            e.target.value = "";
            if (f) onSplit(f);
          }}
        />
      </div>
      ${split &&
      split.done &&
      split.files &&
      html`<div class="flex flex-wrap items-center gap-3 text-xs">
        <span class="muted">Save the split files:</span>
        <button
          class="link-btn text-xs"
          onClick=${() =>
            saveBlob(split.files.vocal, split.base + " (vocal).wav")}
        >
          Save vocal
        </button>
        <button
          class="link-btn text-xs"
          onClick=${() =>
            saveBlob(split.files.music, split.base + " (music).wav")}
        >
          Save music
        </button>
        <span class="muted"
          >WAV, about ${Math.max(1, Math.round(split.files.vocal.size / 1e6))}
          MB each</span
        >
      </div>`}
      ${busy &&
      html`<div
        style=${{
          height: 6,
          borderRadius: 3,
          background: "var(--line)",
          overflow: "hidden",
        }}
      >
        <div
          style=${{
            height: "100%",
            width: pct + "%",
            background: "var(--accent)",
            transition: "width .3s",
          }}
        ></div>
      </div>`}
    </div>`;
  }
  function SongSetup({
    vocal,
    music,
    lyricsEntry,
    updateLyrics,
    onPickVocal,
    onPickMusic,
    onLoadSample,
    sampleName,
    sync,
    onSync,
    onAutoSync,
    syncMsg,
    keyWarn,
    onDone,
    onContinue,
    canSplit,
    split,
    onSplit,
    onCancelSplit,
  }) {
    const ready = vocal && vocal.data;
    const spans = ready ? lyricSpans(lyricsEntry, vocal.data.duration) : [];
    const small = { padding: "5px 10px", fontSize: 13 };
    return html`<div class="flex flex-col gap-5">
      ${canSplit &&
      html`<section class="flex flex-col gap-2">
        <span class="label">Your song</span>
        <${SplitRow}
          split=${split}
          onSplit=${onSplit}
          onCancel=${onCancelSplit}
        />
      </section>`}
      <section class="flex flex-col gap-2">
        <span class="label">Sample songs</span>
        <${SongLibrary}
          inline=${true}
          onLoad=${async (x) => {
            await onLoadSample(x);
            onDone && onDone();
          }}
          current=${ready ? sampleName : null}
        />
      </section>
      <section class="flex flex-col gap-2">
        <span class="label"
          >${canSplit
            ? "Or upload the vocal and music separately"
            : "Or use your own files"}</span
        >
        <div class="file-list">
          <${FileRow}
            id="setup-vocal"
            title="Vocal (acapella)"
            sub="Needed. The singer's voice on its own."
            slot=${vocal}
            onPick=${onPickVocal}
          />
          <${FileRow}
            id="setup-music"
            title="Instrumental"
            sub="For Karaoke. The song without vocals."
            slot=${music}
            onPick=${onPickMusic}
            disabled=${!ready}
          />
          <${LyricsCard}
            orig=${vocal}
            musicName=${music && music.buffer ? music.name : null}
            lyrics=${lyricsEntry}
            updateLyrics=${updateLyrics}
            count=${spans.length}
            hint="Optional. Timed lyrics show while you sing."
          />
        </div>
        ${keyWarn !== 0 &&
        music &&
        music.buffer &&
        html`<p class="text-xs" style=${{ color: "var(--warn)" }}>
          This instrumental seems to be ${pianoKeys(Math.abs(keyWarn))}
          ${keyWarn > 0 ? "higher" : "lower"} than the vocal, so they may clash.
          Look for a version in the original key.
        </p>`}
      </section>
      ${ready &&
      music &&
      music.buffer &&
      html`<section class="flex flex-col gap-2">
        <span class="label">Music timing</span>
        <div class="flex flex-wrap items-center gap-2">
          <button
            class="btn"
            style=${small}
            onClick=${() => onSync(Math.round((sync - 0.1) * 100) / 100)}
          >
            −0.1 s
          </button>
          <span
            class="mono text-xs"
            style=${{ minWidth: 110, textAlign: "center" }}
            >${sync === 0
              ? "No shift"
              : "Music " +
                (sync > 0
                  ? "skips " + sync.toFixed(2) + " s"
                  : "waits " + (-sync).toFixed(2) + " s")}</span
          >
          <button
            class="btn"
            style=${small}
            onClick=${() => onSync(Math.round((sync + 0.1) * 100) / 100)}
          >
            +0.1 s
          </button>
          <button class="btn btn-ghost" style=${small} onClick=${onAutoSync}>
            Auto-sync
          </button>
        </div>
        <p class="text-xs muted">
          ${syncMsg ||
          "Lines the music up with the vocal. Check it by ear in Karaoke's options."}
        </p>
      </section>`}
      ${onContinue &&
      ready &&
      html`<button
        class="btn btn-primary"
        style=${{ justifyContent: "center", minHeight: 50, fontSize: 16 }}
        onClick=${onContinue}
      >
        Continue
      </button>`}
    </div>`;
  }

  /* ---------- app ---------- */
  /* ---------- practice plan: drills built from your mistakes ---------- */
  function PlanCard({ plan, onStart, onHide, onClear }) {
    const n = plan.drills.length,
      dn = plan.drills.filter((d) => plan.done[d.id] != null).length;
    const nextK = plan.drills.findIndex((d) => plan.done[d.id] == null);
    const when = new Date(plan.at).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    const avg = (xs) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
    const before = plan.checks.length
      ? avg(plan.checks.map((c) => c.before))
      : null;
    const after =
      plan.after && plan.after.scores.length ? avg(plan.after.scores) : null;
    const icon = { slide: "↗", jump: "⤴", hold: "━", end: "↘", line: "♪" };
    return html`<section
      class="flex flex-col gap-2"
      style=${{
        padding: 14,
        borderRadius: 20,
        background:
          "radial-gradient(120% 120% at 100% 0%, color-mix(in srgb, var(--accent) 20%, transparent), transparent 60%), var(--surface)",
        border: "1px solid color-mix(in srgb, var(--accent) 35%, transparent)",
      }}
    >
      <div class="flex items-baseline justify-between gap-2">
        <span class="display font-bold" style=${{ fontSize: 20 }}
          >Your plan</span
        ><span class="text-xs muted">${dn} of ${n} done</span>
      </div>
      <span class="text-xs muted"
        >From your
        ${plan.source === "repeat" ? "Repeat after me scores" : "take"} on
        ${when}</span
      >
      ${plan.drills.map((d, k) => {
        const done = plan.done[d.id] != null,
          now = k === nextK;
        return html`<button
          key=${d.id}
          class="flex items-center gap-3"
          onClick=${() => onStart(k)}
          style=${{
            textAlign: "left",
            padding: 12,
            borderRadius: 14,
            font: "inherit",
            color: "var(--fg)",
            cursor: "pointer",
            background: now ? "var(--surface-2)" : "transparent",
            border:
              "1px solid " +
              (now
                ? "color-mix(in srgb, var(--accent) 40%, transparent)"
                : "var(--line)"),
          }}
        >
          <span
            style=${{
              width: 36,
              height: 36,
              borderRadius: 11,
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              fontSize: 17,
              fontWeight: 700,
              background: done
                ? "var(--good)"
                : "color-mix(in srgb, var(--accent) 15%, transparent)",
              color: done ? "var(--bg)" : "var(--accent)",
            }}
            >${done ? "✓" : icon[d.kind] || "♪"}</span
          >
          <span class="flex flex-col min-w-0" style=${{ flex: 1 }}
            ><b class="text-sm">${k + 1}. ${d.title}</b
            ><span class="text-xs muted">${d.why}</span></span
          >
          <span
            class="text-xs font-semibold"
            style=${{
              color: now ? "var(--accent)" : "var(--muted)",
              whiteSpace: "nowrap",
            }}
            >${done ? plan.done[d.id] + "%" : now ? "Start" : ""}</span
          >
        </button>`;
      })}
      ${after != null &&
      before != null &&
      html`<div class="text-sm" style=${{ padding: "8px 2px" }}>
        Re-check: <span class="mono muted">${before}%</span> →
        <b
          class="mono"
          style=${{ color: after >= before ? "var(--good)" : "var(--warn)" }}
          >${after}%</b
        >
        on these lines
      </div>`}
      <div
        class="flex flex-wrap items-center justify-between gap-2"
        style=${{ paddingTop: 2 }}
      >
        <span class="text-xs muted"
          >${plan.checks.length
            ? dn < n
              ? "Then a quick re-check of these lines"
              : ""
            : ""}</span
        >
        <span class="flex gap-3">
          <button
            class="link-btn text-xs"
            style=${{ color: "var(--muted)" }}
            onClick=${onHide}
          >
            Hide
          </button>
          <button
            class="link-btn text-xs"
            style=${{ color: "var(--muted)" }}
            onClick=${onClear}
          >
            Clear plan
          </button>
        </span>
      </div>
      ${dn === n &&
      html`<button
        class="btn btn-primary"
        style=${{ justifyContent: "center", minHeight: 44 }}
        onClick=${() => onStart(plan.checks.length ? "check" : 0)}
      >
        ${plan.checks.length
          ? after != null
            ? "Re-check again"
            : "Re-check these lines"
          : "Go again"}
      </button>`}
      ${dn < n &&
      html`<button
        class="btn btn-primary"
        style=${{ justifyContent: "center", minHeight: 44 }}
        onClick=${() => onStart(nextK)}
      >
        ${dn ? "Continue plan" : "Start plan"}
      </button>`}
    </section>`;
  }

  function PlanFlow({
    plan,
    songTitle,
    buffer,
    start,
    onClose,
    onUpdate,
    onKaraoke,
  }) {
    const first =
      start === "check" ? { v: "check", k: 0 } : { v: "drill", k: start };
    const [step, setStep] = useState(first);
    const [runKey, setRunKey] = useState(0);
    const [scores, setScores] = useState([]);
    const mic = useLessonMic(step.v === "drill" || step.v === "check");
    const range = useMemo(lessonRange, []);
    useEffect(() => {
      try {
        window.scrollTo(0, 0);
      } catch (e) {}
    }, [step.v, step.k]);
    const D = plan.drills,
      C = plan.checks;
    const total = D.length + (C.length ? 1 : 0);
    const nextUndone = (from) => {
      for (let i = 1; i <= D.length; i++) {
        const k = (from + i) % D.length;
        if (plan.done[D[k].id] == null) return k;
      }
      return -1;
    };
    const head = (p, label) =>
      html`<${FlowHead} p=${p} label=${label} onClose=${onClose} />`;
    const again = () => setRunKey((n) => n + 1);

    if (step.v === "drill") {
      const d = D[step.k];
      return html`<div class="flex flex-col gap-4">
        ${head(
          ((step.k + 0.5) / total) * 100,
          "Drill " + (step.k + 1) + "/" + D.length,
        )}
        <span class="label" style=${{ color: "var(--accent)" }}
          >From your
          ${plan.source === "repeat" ? "practice" : "take"}${songTitle
            ? " · " + songTitle
            : ""}</span
        >
        <h2
          class="display font-bold"
          style=${{ fontSize: 26, lineHeight: 1.15, margin: 0 }}
        >
          ${d.title}
        </h2>
        <p class="text-sm muted" style=${{ margin: 0 }}>
          ${d.detail} ${d.why}.
        </p>
        ${d.spec.stages &&
        html`<div class="flex gap-2">
          ${d.spec.stages.map(
            (s, i) =>
              html`<span
                key=${s}
                class="flex flex-col items-center gap-1"
                style=${{ flex: 1 }}
                ><span
                  style=${{
                    width: "100%",
                    height: 6,
                    borderRadius: 3,
                    background: "var(--line)",
                  }}
                ></span
                ><span class="text-xs muted">${s}</span></span
              >`,
          )}
        </div>`}
        <${Exercise}
          key=${runKey + "-d" + step.k}
          spec=${d.spec}
          range=${range}
          mic=${mic}
          onDone=${(res) => {
            const next = {
              ...plan,
              done: {
                ...plan.done,
                [d.id]: Math.max(plan.done[d.id] || 0, res.score),
              },
            };
            onUpdate(next);
            setStep({ v: "drillDone", k: step.k, res });
          }}
        />
        <div
          class="flex items-start gap-2 text-sm"
          style=${{
            padding: "10px 12px",
            borderRadius: 12,
            background: "color-mix(in srgb, var(--accent) 8%, transparent)",
            border:
              "1px solid color-mix(in srgb, var(--accent) 28%, transparent)",
          }}
        >
          <span aria-hidden="true">🎯</span><span>${d.tip}</span>
        </div>
      </div>`;
    }
    if (step.v === "drillDone") {
      const d = D[step.k],
        res = step.res,
        nk = nextUndone(step.k);
      return html`<div class="flex flex-col gap-4">
        ${head(
          ((step.k + 1) / total) * 100,
          "Drill " + (step.k + 1) + "/" + D.length,
        )}
        <div
          class="flex flex-col items-center gap-1 text-center"
          style=${{ paddingTop: 10 }}
        >
          <span class="display font-bold" style=${{ fontSize: 24 }}
            >${d.title}</span
          >
          <span
            class="display font-bold"
            style=${{
              fontSize: 56,
              lineHeight: 1,
              color: res.score >= 70 ? "var(--good)" : "var(--accent)",
            }}
            >${res.score}%</span
          >
          <span class="text-sm muted"
            >${res.score >= 85
              ? "Nailed it."
              : res.score >= 70
                ? "Good. That's getting solid."
                : "Keep at it. One more go often helps."}</span
          >
        </div>
        ${res.tip &&
        html`<div
          class="flex items-start gap-2 text-sm"
          style=${{
            padding: "12px 14px",
            borderRadius: 14,
            background: "color-mix(in srgb, var(--accent) 8%, transparent)",
            border:
              "1px solid color-mix(in srgb, var(--accent) 30%, transparent)",
          }}
        >
          <span aria-hidden="true">🎯</span><span><b>Tip:</b> ${res.tip}</span>
        </div>`}
        <div class="grid grid-cols-2 gap-2">
          <button
            class="btn"
            style=${{ justifyContent: "center", minHeight: 48 }}
            onClick=${() => {
              again();
              setStep({ v: "drill", k: step.k });
            }}
          >
            Try again
          </button>
          ${nk >= 0
            ? html`<button
                class="btn btn-primary"
                style=${{ justifyContent: "center", minHeight: 48 }}
                onClick=${() => {
                  again();
                  setStep({ v: "drill", k: nk });
                }}
              >
                Next drill →
              </button>`
            : C.length
              ? html`<button
                  class="btn btn-primary"
                  style=${{ justifyContent: "center", minHeight: 48 }}
                  onClick=${() => {
                    again();
                    setScores([]);
                    setStep({ v: "check", k: 0 });
                  }}
                >
                  Re-check →
                </button>`
              : html`<button
                  class="btn btn-primary"
                  style=${{ justifyContent: "center", minHeight: 48 }}
                  onClick=${onClose}
                >
                  Done
                </button>`}
        </div>
      </div>`;
    }
    if (step.v === "check") {
      const c = C[step.k];
      const spec = {
        type: "pattern",
        fixed: c.notes,
        rounds: 1,
        tol: 0.5,
        source: buffer
          ? { buffer, start: Math.max(0, c.start - 0.1), end: c.end + 0.1 }
          : null,
        steps: [600],
      };
      return html`<div class="flex flex-col gap-4">
        ${head(
          ((D.length + (step.k + 0.5) / C.length) / total) * 100,
          "Re-check " + (step.k + 1) + "/" + C.length,
        )}
        <span class="label" style=${{ color: "var(--accent)" }}>Re-check</span>
        <h2
          class="display font-bold"
          style=${{ fontSize: 24, lineHeight: 1.2, margin: 0 }}
        >
          ${c.text ? "“" + c.text + "”" : "Phrase at " + fmt(c.start)}
        </h2>
        <p class="text-sm muted" style=${{ margin: 0 }}>
          ${buffer
            ? "Listen to the original line, then sing it back."
            : "Listen to the notes, then sing them back."}
          Before your plan you got ${c.before}%.
        </p>
        <${Exercise}
          key=${runKey + "-c" + step.k}
          spec=${spec}
          range=${range}
          mic=${mic}
          onDone=${(res) => {
            const sc = [...scores];
            sc[step.k] = res.score;
            setScores(sc);
            if (step.k + 1 < C.length) {
              again();
              setStep({ v: "check", k: step.k + 1 });
            } else {
              onUpdate({ ...plan, after: { at: Date.now(), scores: sc } });
              setStep({ v: "compare" });
            }
          }}
        />
      </div>`;
    }
    // compare before and after
    const sc = scores;
    const better = C.filter((c, i) => sc[i] > c.before).length;
    const worst = C.map((c, i) => ({ c, s: sc[i] })).sort(
      (a, b) => a.s - b.s,
    )[0];
    const worstDrill = worst ? D.findIndex((d) => d.line === worst.c.li) : -1;
    return html`<div class="flex flex-col gap-4">
      ${head(100, "Re-check")}
      <div
        class="flex flex-col items-center gap-1 text-center"
        style=${{ paddingTop: 8 }}
      >
        <span style=${{ fontSize: 40 }} aria-hidden="true"
          >${better ? "📈" : "💪"}</span
        >
        <span class="display font-bold" style=${{ fontSize: 28 }}
          >${better === C.length
            ? "You improved!"
            : better
              ? "Getting better!"
              : "Keep going"}</span
        >
        <span class="text-sm muted"
          >Before your plan and after it, line by line.</span
        >
      </div>
      <section class="panel p-4 flex flex-col gap-3">
        <span class="label">Before → after</span>
        ${C.map(
          (c, i) =>
            html`<div key=${i} class="flex flex-col gap-1">
              <span class="flex justify-between gap-2 text-sm"
                ><span
                  style=${{
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  >${c.text
                    ? "“" + c.text + "”"
                    : "Phrase at " + fmt(c.start)}</span
                ><span class="mono text-xs" style=${{ whiteSpace: "nowrap" }}
                  ><span class="muted">${c.before}%</span> →
                  <b
                    style=${{
                      color: sc[i] >= c.before ? "var(--good)" : "var(--warn)",
                    }}
                    >${sc[i]}%</b
                  ></span
                ></span
              >
              <span
                style=${{
                  position: "relative",
                  display: "block",
                  height: 8,
                  borderRadius: 999,
                  background: "var(--line)",
                  overflow: "hidden",
                }}
              >
                <span
                  style=${{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: Math.max(c.before, sc[i]) + "%",
                    background:
                      sc[i] >= c.before ? "var(--good)" : "var(--warn)",
                  }}
                ></span>
                <span
                  style=${{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: Math.min(c.before, sc[i]) + "%",
                    background: "var(--muted)",
                  }}
                ></span>
              </span>
            </div>`,
        )}
      </section>
      ${worst &&
      worst.s < 80 &&
      html`<div
        class="flex items-start gap-2 text-sm"
        style=${{
          padding: "12px 14px",
          borderRadius: 14,
          background: "color-mix(in srgb, var(--good) 8%, transparent)",
          border: "1px solid color-mix(in srgb, var(--good) 28%, transparent)",
        }}
      >
        <span aria-hidden="true">💡</span
        ><span
          >${worst.c.text ? "“" + worst.c.text + "”" : "That phrase"} still
          needs a little
          work.${worstDrill >= 0
            ? " Run drill " + (worstDrill + 1) + " once more tomorrow."
            : ""}</span
        >
      </div>`}
      <div class="grid grid-cols-2 gap-2">
        <button
          class="btn"
          style=${{ justifyContent: "center", minHeight: 48 }}
          onClick=${() => {
            again();
            setStep({ v: "drill", k: Math.max(0, worstDrill) });
          }}
        >
          Redo a drill
        </button>
        <button
          class="btn btn-primary"
          style=${{ justifyContent: "center", minHeight: 48 }}
          onClick=${onKaraoke}
        >
          Sing it in Karaoke
        </button>
      </div>
    </div>`;
  }

  /* ---------- Lessons ---------- */
  function App() {
    const [tab, setTab] = useState("lessons");
    const [lessonFocus, setLessonFocus] = useState(false);
    const matchHook = useRef(null);
    const [matchTarget, setMatchTarget] = useState(null);
    const [matchStatus, setMatchStatus] = useState(null);
    const [showSettings, setShowSettings] = useState(false);
    const [handoff, setHandoff] = useState(null);
    const [lastTake, setLastTake] = useState(null);
    const [setupOpen, setSetupOpen] = useState(false);
    const [pickStay, setPickStay] = useState(false);
    const [focus, setFocus] = useState(null);

    const sendTake = useCallback((t) => {
      setHandoff(t);
      setTab("analyst");
      setVisited((v) => ({ ...v, analyst: true }));
      try {
        window.scrollTo(0, 0);
      } catch (e) {}
    }, []);
    const [, bumpSettings] = useState(0);
    const [visited, setVisited] = useState({ lessons: true });
    // the acapella is shared by Practice, Karaoke and the Singing Analyst
    const [vocal, setVocal] = useState(null);
    const vocalJob = useRef(0);
    const pickVocal = useCallback(async (file) => {
      const job = ++vocalJob.current;
      setVocal({ name: file.name, busy: true, progress: 0 });
      let buffer;
      try {
        buffer = await decodeFile(file);
      } catch (e) {
        if (vocalJob.current === job)
          setVocal({
            name: file.name,
            error:
              "That file couldn't be read as audio. Try an MP3, M4A or WAV.",
          });
        return;
      }
      const data = await trackPitch(
        buffer,
        (pr) => {
          if (vocalJob.current === job)
            setVocal((v) => (v ? { ...v, progress: pr } : v));
        },
        () => vocalJob.current !== job,
      );
      if (!data || vocalJob.current !== job) return;
      data.notes = snapToKey(data.notes, data.grid);
      if (!SETTINGS.ai) {
        setVocal({ name: file.name, buffer, data });
        return;
      }
      const cached = aiCacheGet(file.name, buffer.duration);
      if (cached && cached.length) {
        setVocal({
          name: file.name,
          buffer,
          data: { ...data, notes: cached, ai: true },
          ai: "done",
        });
        return;
      }
      setVocal({ name: file.name, buffer, data, ai: 0 });
      try {
        const notes = await aiNotes(buffer, data, (p) => {
          if (vocalJob.current === job)
            setVocal((v) =>
              v && v.name === file.name && typeof v.ai === "number"
                ? { ...v, ai: p }
                : v,
            );
        });
        if (vocalJob.current !== job) return;
        if (notes.length >= data.notes.length) {
          aiCachePut(file.name, buffer.duration, notes);
          setVocal((v) =>
            v && v.name === file.name
              ? { ...v, data: { ...v.data, notes, ai: true }, ai: "done" }
              : v,
          );
        } else
          setVocal((v) =>
            v && v.name === file.name ? { ...v, ai: "skip" } : v,
          );
      } catch (e) {
        if (vocalJob.current === job)
          setVocal((v) =>
            v && v.name === file.name ? { ...v, ai: "failed" } : v,
          );
      }
    }, []);
    const vocalName = vocal && vocal.data ? vocal.name : null;
    const [vocalLyrics, setVocalLyrics] = useState(null);
    useEffect(() => {
      if (!vocalName) {
        setVocalLyrics(null);
        return;
      }
      const saved = loadLyricsStore()[vocalName];
      setVocalLyrics(saved && Array.isArray(saved.lines) ? saved : null);
    }, [vocalName]);
    const updateVocalLyrics = useCallback(
      (next) => {
        setVocalLyrics(next);
        if (vocalName) saveLyricsFor(vocalName, next);
      },
      [vocalName],
    );
    // an UltraStar chart brings exact notes for every syllable: use them instead of the detected ones
    const vocalEff = useMemo(() => {
      if (!vocal || !vocal.data || !vocalLyrics) return vocal;
      if (!vocalLyrics.us) {
        // timed lyrics: use each line's syllable count to find missing notes and drop blips
        const sp = lyricSpans(vocalLyrics, vocal.data.duration);
        if (!sp.length) return vocal;
        return {
          ...vocal,
          data: {
            ...vocal.data,
            notes: guideBySyllables(
              vocal.data.notes,
              vocal.data,
              sp,
              looksTagalog(sp),
            ),
            guided: true,
          },
        };
      }
      const ns = usNotesFor(vocalLyrics, vocal.data);
      return ns && ns.length
        ? { ...vocal, data: { ...vocal.data, notes: ns, chart: true } }
        : vocal;
    }, [vocal, vocalLyrics]);
    // the instrumental is shared by Karaoke and the Singing Analyst, with its timing saved per song
    const [music, setMusic] = useState(null);
    const musicJob = useRef(0);
    const pickMusic = useCallback(async (file) => {
      const job = ++musicJob.current;
      setMusic({ name: file.name, busy: true });
      let buffer;
      try {
        buffer = await decodeFile(file);
      } catch (e) {
        if (musicJob.current === job)
          setMusic({
            name: file.name,
            error:
              "That file couldn't be read as audio. Try an MP3, M4A or WAV.",
          });
        return;
      }
      const onset = onsetEnvelope(buffer);
      const chroma = await chromaOf(buffer, () => musicJob.current !== job);
      if (musicJob.current !== job) return;
      setMusic({ name: file.name, buffer, onset, chroma });
    }, []);
    const [msync, setMsync] = useState({ sync: 0, msg: "", keyWarn: 0 });
    const saveMusicSync = useCallback(
      (v, msg) => {
        setMsync((x) => ({ ...x, sync: v, msg: msg || "" }));
        if (vocalName && music && music.buffer) {
          const all = loadJSON(KARA_SYNC_KEY, {});
          const old = all[vocalName];
          all[vocalName] = {
            ...(old && old.inst === music.name ? old : {}),
            inst: music.name,
            sync: v,
          };
          saveJSON(KARA_SYNC_KEY, all);
        }
      },
      [vocalName, music],
    );
    const autoMusicSync = useCallback(() => {
      if (!vocal || !vocal.buffer || !music || !music.onset) return;
      const r = autoSync(onsetEnvelope(vocal.buffer), music.onset);
      if (r.z >= 6)
        saveMusicSync(
          Math.round(r.off * 100) / 100,
          "Lined up automatically. Use Check timing to confirm by ear.",
        );
      else
        saveMusicSync(
          0,
          "Couldn't line them up automatically. Use Check timing and the nudge buttons.",
        );
    }, [vocal, music, saveMusicSync]);
    useEffect(() => {
      if (!vocal || !vocal.data || !music || !music.buffer) return;
      const saved = loadJSON(KARA_SYNC_KEY, {})[vocal.name];
      // a song Tono split itself can't be in two keys, so skip the clash check there
      const sameSource = saved && saved.split && saved.inst === music.name;
      setMsync((x) => ({
        ...x,
        keyWarn:
          music.chroma && !sameSource
            ? keyGap(vocal.data.notes, music.chroma)
            : 0,
      }));
      if (saved && saved.inst === music.name)
        setMsync((x) => ({
          ...x,
          sync: saved.sync,
          msg: sameSource
            ? "Split from the same song, so already in time."
            : "Using the timing you saved for this song.",
        }));
      else autoMusicSync();
    }, [vocal, music]);
    const [sampleName, setSampleName] = useState(null);
    const loadSample = useCallback(
      async ({ name, vocal: vf, inst: inf, lyricText, lyricName }) => {
        if (lyricText) {
          const lines = parseLrc(lyricText);
          if (lines.filter((l) => l.text).length)
            saveLyricsFor(vf.name, {
              name: lyricName,
              lines,
              offset: (loadLyricsStore()[vf.name] || {}).offset || 0,
            });
        }
        setSampleName(name);
        const jobs = [pickVocal(vf)];
        if (inf) jobs.push(pickMusic(inf));
        await Promise.all(jobs);
      },
      [pickVocal, pickMusic],
    );
    const [canSplit, setCanSplit] = useState(false);
    useEffect(() => {
      canSplitSongs().then(setCanSplit);
    }, []);
    const [split, setSplit] = useState(null);
    const splitJob = useRef(0);
    const onSplit = useCallback(
      async (file) => {
        const job = ++splitJob.current,
          base = file.name.replace(/\.[^.]+$/, "");
        setSplit({ name: file.name, stage: "decode", p: 0 });
        try {
          const r = await splitSong(file, (st) => {
            if (splitJob.current === job)
              setSplit((x) => ({
                ...x,
                ...st,
                t0:
                  st.stage === "split" && !(x && x.stage === "split")
                    ? Date.now()
                    : x && x.t0,
              }));
          });
          if (splitJob.current !== job) return;
          const vf = wavFile(r.vocals, r.sr, base + ".wav"),
            mf = wavFile(r.inst, r.sr, base + " (music).wav");
          // both halves come from the same file, so they are already in time
          const all = loadJSON(KARA_SYNC_KEY, {});
          all[vf.name] = { inst: mf.name, sync: 0, split: true };
          saveJSON(KARA_SYNC_KEY, all);
          setSplit({
            name: file.name,
            done: true,
            base,
            files: { vocal: vf, music: mf },
          });
          setSampleName(null);
          setPickStay(true);
          await Promise.all([pickVocal(vf), pickMusic(mf)]);
        } catch (e) {
          if (splitJob.current !== job) return;
          setSplit(
            e.message === "cancelled"
              ? null
              : {
                  name: file.name,
                  error:
                    (e && e.name === "EncodingError"
                      ? "That file couldn't be read as audio."
                      : "Couldn't split this song: " + (e.message || e)) +
                    " You can upload the vocal and music separately below.",
                },
          );
        }
      },
      [pickVocal, pickMusic],
    );
    const onCancelSplit = useCallback(() => {
      splitJob.current++;
      cancelSplit();
      setSplit(null);
    }, []);
    const musicProps = {
      inst: music,
      onPickInst: pickMusic,
      sync: msync.sync,
      syncMsg: msync.msg,
      keyWarn: msync.keyWarn,
      onSync: saveMusicSync,
      onAutoSync: autoMusicSync,
    };
    const [mode, setMode] = useState("idle"); // idle | mic | file
    const [error, setError] = useState("");
    const [recording, setRecording] = useState(false);
    const [live, setLive] = useState(null); // { midi, freq, cents }
    const [level, setLevel] = useState(0);
    const [trail, setTrail] = useState([]);
    const [history, setHistory] = useState(loadHistory);
    const [confirmClear, setConfirmClear] = useState(false);
    const [copyMsg, setCopyMsg] = useState("");
    const [fileName, setFileName] = useState("");
    const [progress, setProgress] = useState(0);
    const [fileResult, setFileResult] = useState("");
    const [song, setSong] = useState(null);
    const [playing, setPlaying] = useState(false);
    const [playPos, setPlayPos] = useState(0);
    const songRef = useRef(null),
      playRef = useRef({
        ctx: null,
        src: null,
        startAt: 0,
        offset: 0,
        raf: 0,
        idx: -2,
      });
    const [theme, setTheme] = useState(() => {
      try {
        return localStorage.getItem(THEME_KEY) || "";
      } catch (e) {
        return "";
      }
    });

    const ctxRef = useRef(null),
      streamRef = useRef(null),
      srcRef = useRef(null),
      rafRef = useRef(0),
      cancelRef = useRef(false);
    const recRef = useRef(recording);
    const fileInput = useRef(null);
    useEffect(() => {
      recRef.current = recording;
    }, [recording]);
    useEffect(() => {
      saveHistory(history);
    }, [history]);
    useEffect(() => {
      if (theme) document.documentElement.setAttribute("data-theme", theme);
      else document.documentElement.removeAttribute("data-theme");
      try {
        theme
          ? localStorage.setItem(THEME_KEY, theme)
          : localStorage.removeItem(THEME_KEY);
      } catch (e) {}
    }, [theme]);

    const confirmNote = useCallback((midi, freq, cents) => {
      const id = Date.now() + "-" + Math.random().toString(36).slice(2, 7);
      setTrail((t) => [...t.slice(-11), { id, midi }]);
      if (recRef.current) {
        const entry = {
          id,
          t: Date.now(),
          note: midiInfo(midi).label,
          midi,
          freq: Math.round(freq * 10) / 10,
          cents,
        };
        setHistory((h) => [entry, ...h].slice(0, 500));
      }
    }, []);

    const pausePlayback = useCallback((reset) => {
      const p = playRef.current;
      cancelAnimationFrame(p.raf);
      if (p.src) {
        if (!reset && p.ctx)
          p.offset = Math.max(0, p.ctx.currentTime - p.startAt);
        p.src.onended = null;
        try {
          p.src.stop();
        } catch (e) {}
        p.src = null;
      }
      if (reset) p.offset = 0;
      p.idx = -2;
      setPlaying(false);
    }, []);

    const stopInput = useCallback(() => {
      cancelRef.current = true;
      cancelAnimationFrame(rafRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (srcRef.current) {
        try {
          srcRef.current.onended = null;
          srcRef.current.stop && srcRef.current.stop();
        } catch (e) {}
        srcRef.current = null;
      }
      if (ctxRef.current) {
        ctxRef.current.close().catch(() => {});
        ctxRef.current = null;
      }
      setMode("idle");
      setLive(null);
      setLevel(0);
    }, []);
    const stop = useCallback(() => {
      stopInput();
      pausePlayback(false);
    }, [stopInput, pausePlayback]);
    const goTab = useCallback(
      (k) => {
        if (k !== "live") stop();
        setTab(k);
        setVisited((v) => ({ ...v, [k]: true }));
        try {
          window.scrollTo(0, 0);
        } catch (e) {}
      },
      [stop],
    );
    const practiceRange = useCallback(
      (a, b, repeat) => {
        setFocus({ a, b, repeat: !!repeat, id: Date.now() });
        goTab("learn");
      },
      [goTab],
    );
    useEffect(() => stop, [stop]);

    // show the note sounding at song time ct, plus the notes before it
    const showAt = useCallback((ct) => {
      const p = playRef.current,
        s = songRef.current;
      if (!s) return;
      const notes = s.notes;
      let idx = -1;
      for (let i = 0; i < notes.length; i++) {
        if (notes[i].pos <= ct) idx = i;
        else break;
      }
      const cur = idx >= 0 && ct < notes[idx].end ? notes[idx] : null;
      const key = idx * 2 + (cur ? 1 : 0);
      if (key === p.idx) return;
      p.idx = key;
      const upto = cur ? idx : idx + 1;
      setTrail(
        notes
          .slice(Math.max(0, upto - 12), upto)
          .map((n) => ({ id: "s" + n.pos, midi: n.midi })),
      );
      setLive(
        cur ? { midi: cur.midi, freq: cur.freq, cents: cur.cents } : null,
      );
    }, []);

    const playSong = useCallback(() => {
      const s = songRef.current;
      if (!s) return;
      stopInput();
      const p = playRef.current;
      if (!p.ctx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        p.ctx = new Ctx();
      }
      const ctx = p.ctx;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      if (p.offset >= s.buffer.duration - 0.05) p.offset = 0;
      const src = ctx.createBufferSource();
      src.buffer = s.buffer;
      src.connect(ctx.destination);
      src.start(0, p.offset);
      p.src = src;
      p.startAt = ctx.currentTime - p.offset;
      p.idx = -2;
      src.onended = () => {
        if (p.src !== src) return;
        p.src = null;
        p.offset = 0;
        cancelAnimationFrame(p.raf);
        setPlaying(false);
        setPlayPos(s.buffer.duration);
        setLive(null);
      };
      setPlaying(true);
      const tick = () => {
        const ct = Math.min(s.buffer.duration, ctx.currentTime - p.startAt);
        setPlayPos(ct);
        showAt(ct);
        p.raf = requestAnimationFrame(tick);
      };
      tick();
    }, [showAt, stopInput]);

    const seek = (v) => {
      const wasPlaying = playing;
      pausePlayback(false);
      playRef.current.offset = v;
      setPlayPos(v);
      showAt(v);
      if (wasPlaying) playSong();
    };

    const runLoop = useCallback(
      (ctx, analyser) => {
        const buf = new Float32Array(analyser.fftSize);
        let cand = { midi: null, since: 0 };
        let confirmed = null;
        let silentSince = 0;
        const recent = [];
        const tick = () => {
          analyser.getFloatTimeDomainData(buf);
          const r = detectPitch(buf, ctx.sampleRate, micGate());
          const now = performance.now();
          if (matchHook.current)
            matchHook.current(
              r.freq > 0 ? 69 + 12 * Math.log2(r.freq / SETTINGS.a4) : null,
              now,
            );
          setLevel(Math.min(1, r.rms * 6));
          if (r.freq > 0) {
            silentSince = 0;
            recent.push(r.freq);
            if (recent.length > 5) recent.shift();
            const med = [...recent].sort((a, b) => a - b)[
              Math.floor(recent.length / 2)
            ];
            const { midi, cents } = freqToMidi(med);
            if (midi !== cand.midi) cand = { midi, since: now };
            if (now - cand.since >= 150) {
              setLive({ midi, freq: med, cents });
              if (confirmed !== midi) {
                confirmed = midi;
                confirmNote(midi, med, cents);
              }
            }
          } else {
            if (!silentSince) silentSince = now;
            if (now - silentSince > 120) {
              confirmed = null;
              cand = { midi: null, since: 0 };
              recent.length = 0;
              setLive(null);
            }
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      },
      [confirmNote],
    );

    const startMic = useCallback(async () => {
      setError("");
      stop();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setError(
          "This browser can't reach a microphone here. Open the page file in Chrome, Edge or Safari, or analyze an audio file instead.",
        );
        return;
      }
      try {
        const stream = await getMicStream();
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        src.connect(analyser);
        ctxRef.current = ctx;
        streamRef.current = stream;
        setMode("mic");
        runLoop(ctx, analyser);
      } catch (e) {
        setError(
          "The microphone is blocked on this page. Download the page file and open it in your browser to use the mic, or analyze an audio file below.",
        );
      }
    }, [stop, runLoop]);

    const onFile = useCallback(
      async (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = "";
        if (!file) return;
        setError("");
        setFileResult("");
        stop();
        songRef.current = null;
        setSong(null);
        setPlayPos(0);
        playRef.current.offset = 0;
        cancelRef.current = false;
        setFileName(file.name);
        setMode("file");
        setProgress(0);
        let audio;
        try {
          const Ctx = window.AudioContext || window.webkitAudioContext;
          const ctx = new Ctx();
          const ab = await file.arrayBuffer();
          audio = await new Promise((res, rej) => {
            const p = ctx.decodeAudioData(ab, res, rej);
            if (p && p.then) p.then(res, rej);
          });
          if (ctx.close) ctx.close().catch(() => {});
        } catch (err) {
          setMode("idle");
          setError(
            "That file couldn't be read as audio. Try an MP3, M4A or WAV.",
          );
          return;
        }
        // mix to mono, then halve the sample rate so analysis stays fast on phones
        let data = audio.getChannelData(0);
        if (audio.numberOfChannels > 1) {
          const r = audio.getChannelData(1),
            m = new Float32Array(data.length);
          for (let i = 0; i < data.length; i++) m[i] = (data[i] + r[i]) / 2;
          data = m;
        }
        let sr = audio.sampleRate;
        if (sr >= 44100) {
          const h = new Float32Array(Math.floor(data.length / 2));
          for (let i = 0; i < h.length; i++)
            h[i] = (data[2 * i] + data[2 * i + 1]) / 2;
          data = h;
          sr = sr / 2;
        }
        const N = 1024,
          hop = 512,
          total = Math.max(1, Math.floor((data.length - N) / hop));
        const found = [];
        let cand = { midi: null, since: 0 },
          confirmed = null,
          silentSince = -1;
        const recent = [];
        for (let f = 0; f < total; f++) {
          if (cancelRef.current) return;
          const t = (f * hop) / sr;
          const r = detectPitch(data.subarray(f * hop, f * hop + N), sr);
          if (r.freq > 0) {
            silentSince = -1;
            recent.push(r.freq);
            if (recent.length > 5) recent.shift();
            const med = [...recent].sort((a, b) => a - b)[
              Math.floor(recent.length / 2)
            ];
            const { midi, cents } = freqToMidi(med);
            if (midi !== cand.midi) cand = { midi, since: t };
            if (t - cand.since >= 0.15 && confirmed !== midi) {
              if (found.length && found[found.length - 1].end == null)
                found[found.length - 1].end = cand.since;
              confirmed = midi;
              found.push({
                midi,
                freq: med,
                cents,
                pos: cand.since,
                end: null,
              });
            }
          } else {
            if (silentSince < 0) silentSince = t;
            if (t - silentSince > 0.12) {
              if (
                confirmed !== null &&
                found.length &&
                found[found.length - 1].end == null
              )
                found[found.length - 1].end = silentSince;
              confirmed = null;
              cand = { midi: null, since: 0 };
              recent.length = 0;
            }
          }
          if (f % 150 === 0) {
            setProgress(f / total);
            await new Promise((res) => setTimeout(res, 0));
          }
        }
        if (found.length && found[found.length - 1].end == null)
          found[found.length - 1].end = data.length / sr;
        songRef.current = { buffer: audio, notes: found };
        setSong({ name: file.name, duration: audio.duration });
        const now = Date.now();
        const entries = found.map((n, i) => ({
          id: now + "-" + i,
          t: now,
          note: midiInfo(n.midi).label,
          midi: n.midi,
          freq: Math.round(n.freq * 10) / 10,
          cents: n.cents,
          pos: Math.round(n.pos * 10) / 10,
          src: file.name,
        }));
        setTrail(entries.slice(-12).map((x) => ({ id: x.id, midi: x.midi })));
        if (recRef.current && entries.length)
          setHistory((h) => [...[...entries].reverse(), ...h].slice(0, 500));
        setProgress(1);
        setMode("idle");
        setFileResult(
          entries.length
            ? "Found " +
                entries.length +
                " notes in " +
                file.name +
                (recRef.current ? " and saved them to the log." : ".") +
                " Tap Play to hear it with the notes on the staff."
            : "No clear single notes found in " +
                file.name +
                ". Clips with one voice or instrument work best.",
        );
      },
      [stop],
    );

    const counts = useMemo(() => {
      const m = {};
      history.forEach((h) => {
        m[h.note] = (m[h.note] || 0) + 1;
      });
      return Object.entries(m)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6);
    }, [history]);

    const flash = (msg) => {
      setCopyMsg(msg);
      setTimeout(() => setCopyMsg(""), 2600);
    };

    const buildText = () => {
      const list = [...history].reverse();
      const when = (h) =>
        h.pos != null
          ? "at " + fmt(h.pos) + " (" + h.src + ")"
          : new Date(h.t).toLocaleString([], {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
              second: "2-digit",
            });
      const lines = [
        "Tono - note log",
        "Exported " +
          new Date().toLocaleString([], {
            dateStyle: "medium",
            timeStyle: "short",
          }),
        list.length + " notes",
        "",
        "Sequence:",
        list.map((h) => h.note).join(" "),
        "",
        "#".padEnd(5) +
          "Note".padEnd(7) +
          "When".padEnd(34) +
          "Freq (Hz)".padEnd(11) +
          "Cents",
      ];
      list.forEach((h, i) => {
        lines.push(
          String(i + 1).padEnd(5) +
            h.note.padEnd(7) +
            when(h).padEnd(34) +
            h.freq.toFixed(1).padEnd(11) +
            (h.cents > 0 ? "+" : "") +
            h.cents,
        );
      });
      return lines.join("\n") + "\n";
    };

    const exportTxt = async () => {
      if (!history.length) return;
      const text = buildText();
      const filename =
        "pitch-staff-notes-" + new Date().toISOString().slice(0, 10) + ".txt";
      let dl = null;
      try {
        dl =
          window.claude && window.claude.use
            ? await window.claude.use("downloads")
            : null;
      } catch (e) {
        dl = null;
      }
      if (dl) {
        try {
          await dl.save({ filename, data: text });
          flash("Exported " + filename);
        } catch (e) {
          flash(
            e && e.code === "declined"
              ? "Export cancelled"
              : e && e.code === "rate_limited"
                ? "One moment, then try again"
                : "Export isn't available in this view",
          );
        }
        return;
      }
      // opened as a plain file in a browser: use a normal download
      try {
        const url = URL.createObjectURL(
          new Blob([text], { type: "text/plain" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        flash("Exported " + filename);
      } catch (e) {
        flash("Export isn't available in this view");
      }
    };

    const copySequence = () => {
      const seq = [...history]
        .reverse()
        .map((h) => h.note)
        .join(" ");
      if (!seq) return;
      const done = (msg) => {
        setCopyMsg(msg);
        setTimeout(() => setCopyMsg(""), 2200);
      };
      try {
        navigator.clipboard.writeText(seq).then(
          () => done("Copied " + history.length + " notes"),
          () => done("Copy blocked here"),
        );
      } catch (e) {
        done("Copy blocked here");
      }
    };

    const info = live ? midiInfo(live.midi) : null;
    const tuneColor = !live
      ? "var(--muted)"
      : Math.abs(live.cents) <= 10
        ? "var(--good)"
        : Math.abs(live.cents) <= 25
          ? "var(--warn)"
          : "var(--bad)";
    const isDark = theme
      ? theme === "dark"
      : !window.matchMedia("(prefers-color-scheme: light)").matches;
    useLayoutEffect(() => {
      document.documentElement.classList.toggle("kara", tab === "karaoke");
    }, [tab]);
    const running = mode !== "idle";
    const showExample = !running && trail.length === 0;
    const tm =
      matchTarget && matchStatus && matchStatus.midi === matchTarget.midi
        ? matchStatus
        : null;

    const songReady = !!(vocal && vocal.data);
    const songNeeded = tab !== "live" && tab !== "lessons";
    const showPick = songNeeded && (!songReady || pickStay);
    const lyricsReady = !!(
      vocalLyrics &&
      vocalLyrics.lines &&
      vocalLyrics.lines.length
    );
    return html`<div class="wrap app-wrap flex flex-col gap-5">
      <header
        class="flex items-center justify-between gap-3"
        hidden=${lessonFocus}
      >
        <div class="min-w-0">
          <h1 class="display text-3xl font-bold flex items-center gap-2">
            <img
              src="data:image/png;base64,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"
              alt=""
              width="34"
              height="34"
              style=${{ width: "34px", height: "34px", flex: "none" }}
            />Tono
          </h1>
          <p
            class="muted text-sm"
            hidden=${tab === "live" ||
            tab === "lessons" ||
            (songNeeded && songReady)}
          >
            ${tab === "live"
              ? "Sing, whistle or play one clean note and see exactly which note it is."
              : tab === "learn"
                ? "Learn a song's melody note by note, one phrase at a time."
                : tab === "karaoke"
                  ? "Sing along to the music with scrolling lyrics and a live score."
                  : "Compare your singing with the original vocal, phrase by phrase."}
          </p>
        </div>
        <div class="flex gap-2">
          <button
            class="icon-btn"
            onClick=${() => setShowSettings((v) => !v)}
            aria-expanded=${showSettings ? "true" : "false"}
            aria-label="Settings"
          >
            <${Icon} name="gear" />
          </button>
          <button
            class="icon-btn"
            onClick=${() => setTheme(isDark ? "light" : "dark")}
            aria-label=${isDark
              ? "Switch to light theme"
              : "Switch to dark theme"}
          >
            <${Icon} name=${isDark ? "sun" : "moon"} />
          </button>
        </div>
      </header>

      ${showSettings &&
      html`<${SettingsPanel}
        listening=${mode === "mic"}
        level=${level}
        onClose=${() => setShowSettings(false)}
        onChange=${() => bumpSettings((n) => n + 1)}
        onMicChange=${() => {
          if (mode === "mic") startMic();
        }}
      />`}

      <nav class="bottom-nav" aria-label="Main" hidden=${lessonFocus}>
        ${[
          ["lessons", "Lessons", "cap"],
          ["live", "Tuner", "gauge"],
          ["learn", "Practice", "music"],
          ["karaoke", "Karaoke", "mic"],
          ["analyst", "Analyze", "chart"],
        ].map(
          ([k, l, ic]) =>
            html`<button
              key=${k}
              aria-current=${tab === k ? "page" : undefined}
              onClick=${() => goTab(k)}
            >
              <span class="nav-ico"><${Icon} name=${ic} size=${22} /></span>${l}
            </button>`,
        )}
      </nav>

      ${songNeeded &&
      !showPick &&
      html`<div class="song-bar">
        <span class="song-ico"><${Icon} name="music" /></span>
        <span class="flex flex-col min-w-0" style=${{ flex: 1 }}>
          <span
            class="display font-bold text-lg"
            style=${{ overflowWrap: "anywhere", lineHeight: 1.2 }}
            >${songTitle(sampleName, vocal)}</span
          >
          <span class="text-xs muted"
            >Vocal${music && music.buffer ? " · Music" : ""}${lyricsReady
              ? " · Lyrics"
              : ""}${music && music.busy ? " · loading music…" : ""}${vocal &&
            typeof vocal.ai === "number"
              ? " · improving notes with AI " + Math.round(vocal.ai * 100) + "%"
              : vocal && vocal.ai === "done"
                ? " · AI notes ✓"
                : ""}</span
          >
        </span>
        <button
          class="btn"
          style=${{ padding: "7px 14px", fontSize: 13 }}
          onClick=${() => setSetupOpen(true)}
        >
          Change
        </button>
      </div>`}
      ${showPick &&
      html`<section class="flex flex-col gap-5">
        <div class="empty-hero">
          <h2
            class="display text-3xl font-bold"
            style=${{ letterSpacing: "-0.02em" }}
          >
            Pick a song
          </h2>
          <p class="muted text-sm">
            Practice, Karaoke and the Analyst all use the song you pick here.
          </p>
          ${vocal &&
          vocal.busy &&
          html`<p class="text-sm" style=${{ color: "var(--accent)" }}>
            Analyzing ${vocal.name}… ${Math.round((vocal.progress || 0) * 100)}%
          </p>`}
        </div>
        <${SongSetup}
          vocal=${vocalEff}
          music=${music}
          lyricsEntry=${vocalLyrics}
          updateLyrics=${updateVocalLyrics}
          onPickVocal=${(f) => {
            setPickStay(true);
            setSampleName(null);
            pickVocal(f);
          }}
          onPickMusic=${pickMusic}
          onLoadSample=${loadSample}
          canSplit=${canSplit}
          split=${split}
          onSplit=${onSplit}
          onCancelSplit=${onCancelSplit}
          sampleName=${sampleName}
          sync=${msync.sync}
          onSync=${saveMusicSync}
          onAutoSync=${autoMusicSync}
          syncMsg=${msync.msg}
          keyWarn=${msync.keyWarn}
          onDone=${() => setPickStay(false)}
          onContinue=${() => setPickStay(false)}
        />
      </section>`}

      <${Sheet}
        open=${setupOpen}
        title="Song"
        onClose=${() => setSetupOpen(false)}
      >
        <${SongSetup}
          vocal=${vocalEff}
          music=${music}
          lyricsEntry=${vocalLyrics}
          updateLyrics=${updateVocalLyrics}
          onPickVocal=${(f) => {
            setSampleName(null);
            pickVocal(f);
          }}
          onPickMusic=${pickMusic}
          onLoadSample=${loadSample}
          canSplit=${canSplit}
          split=${split}
          onSplit=${onSplit}
          onCancelSplit=${onCancelSplit}
          sampleName=${sampleName}
          sync=${msync.sync}
          onSync=${saveMusicSync}
          onAutoSync=${autoMusicSync}
          syncMsg=${msync.msg}
          keyWarn=${msync.keyWarn}
          onDone=${() => setSetupOpen(false)}
        />
      <//>

      ${tab === "lessons" &&
      html`<${Lessons}
        active=${tab === "lessons"}
        onGo=${goTab}
        onFocus=${setLessonFocus}
      />`}
      ${tab === "live" &&
      html`<${MatchTrainer}
        hookRef=${matchHook}
        listening=${mode === "mic"}
        onStartMic=${startMic}
        onStopMic=${stop}
        onTarget=${setMatchTarget}
        onStatus=${setMatchStatus}
        sung=${live ? live.midi : null}
        live=${live}
        level=${level}
        error=${error}
      />`}
      <div hidden=${tab !== "learn" || showPick}>
        ${visited.learn &&
        html`<${Learn}
          themeKey=${isDark ? "dark" : "light"}
          active=${tab === "learn"}
          orig=${vocalEff}
          onPickOrig=${pickVocal}
          lyrics=${vocalLyrics}
          updateLyrics=${updateVocalLyrics}
          focus=${focus}
          onGo=${goTab}
          inst=${music}
          sync=${msync.sync}
        />`}
      </div>
      <div hidden=${tab !== "karaoke" || showPick}>
        ${visited.karaoke &&
        html`<${Karaoke}
          themeKey=${tab === "karaoke" ? "kara" : isDark ? "dark" : "light"}
          active=${tab === "karaoke"}
          orig=${vocalEff}
          onPickOrig=${pickVocal}
          lyrics=${vocalLyrics}
          updateLyrics=${updateVocalLyrics}
          onSendTake=${sendTake}
          onTakeReady=${setLastTake}
          onPractice=${practiceRange}
          ...${musicProps}
        />`}
      </div>
      <div hidden=${tab !== "analyst" || showPick}>
        ${visited.analyst &&
        html`<${Analyst}
          themeKey=${isDark ? "dark" : "light"}
          active=${tab === "analyst"}
          orig=${vocalEff}
          onPickOrig=${pickVocal}
          lyrics=${vocalLyrics}
          updateLyrics=${updateVocalLyrics}
          incomingTake=${handoff}
          lastTake=${lastTake}
          onUseTake=${(t) => setHandoff({ ...t, id: Date.now() })}
          onPractice=${practiceRange}
          onGo=${goTab}
          ...${musicProps}
        />`}
      </div>
    </div>`;
  }

  ReactDOM.createRoot(document.getElementById("root")).render(html`<${App} />`);
})();

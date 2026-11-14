import { useRef, useMemo, useEffect } from "react";
import { html } from "../../html.js";
import { GRID } from "../../lib/analysis.js";
import { cssVar } from "../../lib/css.js";
import { pretty, fmt, NAMES } from "../../lib/music.js";

export function RollChart({
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

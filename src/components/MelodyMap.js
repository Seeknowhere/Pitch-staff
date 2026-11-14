// The scrolling melody chart used in Practice and Karaoke.
import { useRef, useMemo, useEffect } from "react";
import { html } from "../html.js";
import { GRID } from "../lib/analysis.js";
import { cssVar } from "../lib/css.js";
import { fmt } from "../lib/music.js";

export function MelodyMap({
  data,
  notes,
  tr,
  nameOf,
  phrases,
  lyrics,
  loop,
  cursor,
  curIdx,
  onTapNote,
  onSeek,
  themeKey,
  overlay,
  height,
  marks,
}) {
  const canvasRef = useRef(null),
    boxRef = useRef(null);
  const dur = data.duration;
  const pps = Math.min(70, 15000 / Math.max(1, dur));
  const W = Math.ceil(dur * pps),
    H = height || 260;
  const range = useMemo(() => {
    let lo = Infinity,
      hi = -Infinity;
    notes.forEach((n) => {
      lo = Math.min(lo, n.midi + tr);
      hi = Math.max(hi, n.midi + tr);
    });
    if (!isFinite(lo)) {
      lo = 60;
      hi = 72;
    }
    lo -= 2;
    hi += 2;
    if (hi - lo < 14) {
      const m = (hi + lo) / 2;
      lo = Math.floor(m - 7);
      hi = Math.ceil(m + 7);
    }
    return { lo, hi };
  }, [notes, tr]);
  const rowH = (H - 30) / (range.hi - range.lo + 1);
  const yOf = (m) => H - 18 - (m - range.lo + 0.5) * rowH;

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
      bg: cssVar("--surface-2"),
      accent: cssVar("--accent"),
    };
    const mono = "10px " + cssVar("--font-mono");
    // alternate phrase shading
    g.fillStyle = col.fg;
    phrases.forEach((p, i) => {
      if (i % 2) {
        g.globalAlpha = 0.04;
        g.fillRect(p.start * pps, 0, (p.end - p.start) * pps, H);
      }
    });
    g.globalAlpha = 1;
    // pitch rows, C labels
    for (let m = range.lo; m <= range.hi; m++) {
      const y = yOf(m),
        isC = ((m % 12) + 12) % 12 === 0;
      g.strokeStyle = isC ? col.muted : col.line;
      g.globalAlpha = isC ? 0.5 : 0.35;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
      if (isC) {
        g.globalAlpha = 0.9;
        g.fillStyle = col.muted;
        g.font = mono;
        for (let x = 4; x < W; x += 8 * pps)
          g.fillText("C" + (Math.floor(m / 12) - 1), x, y - 3);
      }
    }
    g.globalAlpha = 1;
    g.fillStyle = col.muted;
    g.font = mono;
    for (let s = 0; s < dur; s += 5) g.fillText(fmt(s), s * pps + 3, H - 3);
    // the singer's real pitch line, faint
    g.strokeStyle = col.fg;
    g.globalAlpha = 0.18;
    g.lineWidth = 1.5;
    g.beginPath();
    let pen = false;
    const a = data.grid;
    for (let k = 0; k < a.length; k++) {
      const v = a[k];
      if (v !== v) {
        pen = false;
        continue;
      }
      if (pen && Math.abs(v - a[k - 1]) > 1.5) pen = false;
      const x = k * GRID * pps,
        y = yOf(v + tr);
      if (!pen) {
        g.moveTo(x, y);
        pen = true;
      } else g.lineTo(x, y);
    }
    g.stroke();
    g.globalAlpha = 1;
    // note bars with names
    const bh = Math.max(7, Math.min(18, rowH * 0.85));
    g.font = "600 10px " + cssVar("--font-mono");
    g.textBaseline = "middle";
    notes.forEach((n, i) => {
      // a note running straight into another on the same pitch gets a clear gap, so the two read as two notes
      const nx = notes[i + 1],
        joined = nx && nx.midi === n.midi && nx.pos - n.end < 0.06;
      const x = n.pos * pps,
        w = Math.max(3, (n.end - n.pos) * pps - (joined ? 5 : 1.5)),
        y = yOf(n.midi + tr);
      g.fillStyle = col.fg;
      g.globalAlpha = 0.78;
      const r = Math.min(4, bh / 2, w / 2);
      g.beginPath();
      if (g.roundRect) g.roundRect(x, y - bh / 2, w, bh, r);
      else g.rect(x, y - bh / 2, w, bh);
      g.fill();
      g.globalAlpha = 1;
      const label = nameOf(n.midi);
      if (w >= label.length * 6.5 + 6 && bh >= 10) {
        g.fillStyle = col.bg;
        g.fillText(label, x + 4, y + 0.5);
      }
    });
  }, [data, notes, tr, nameOf, phrases, range, W, pps, themeKey]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || cursor == null) return;
    const x = cursor * pps;
    if (x < box.scrollLeft + 30 || x > box.scrollLeft + box.clientWidth - 60)
      box.scrollLeft = Math.max(0, x - 60);
  }, [cursor, pps]);

  const cur = curIdx >= 0 ? notes[curIdx] : null;
  const bh = Math.max(7, Math.min(18, rowH * 0.85));
  const tap = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left,
      y = e.clientY - r.top,
      t = x / pps;
    const hit = notes.find(
      (n) =>
        t >= n.pos - 0.05 &&
        t <= n.end + 0.05 &&
        Math.abs(y - yOf(n.midi + tr)) <= Math.max(10, bh),
    );
    if (hit) onTapNote(hit);
    else onSeek(Math.max(0, t));
  };
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
      ${lyrics.length > 0 &&
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
      <div style=${{ position: "relative", height: H }}>
        <canvas
          ref=${canvasRef}
          style=${{ display: "block", cursor: "pointer" }}
          onClick=${tap}
        ></canvas>
        ${overlay &&
        overlay.points.length > 1 &&
        html`<svg
          width=${W}
          height=${H}
          style=${{
            position: "absolute",
            left: 0,
            top: 0,
            pointerEvents: "none",
          }}
          aria-hidden="true"
        >
          ${(() => {
            const segs = [];
            let cur = [];
            overlay.points.forEach((pt) => {
              if (pt.m !== pt.m) {
                if (cur.length > 1) segs.push(cur);
                cur = [];
                return;
              }
              cur.push(
                ((overlay.start + pt.t * overlay.speed) * pps).toFixed(1) +
                  "," +
                  yOf(pt.m - overlay.oct).toFixed(1),
              );
            });
            if (cur.length > 1) segs.push(cur);
            return segs.map(
              (sg, i) =>
                html`<polyline
                  key=${i}
                  points=${sg.join(" ")}
                  fill="none"
                  stroke="var(--you)"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />`,
            );
          })()}
        </svg>`}
        ${marks &&
        marks.map(
          (mk) =>
            html`<div
              key=${"mk" + mk.i}
              style=${{
                position: "absolute",
                left: mk.pos * pps,
                width: Math.max(3, (mk.end - mk.pos) * pps - 1.5),
                top: yOf(mk.midi + tr) + bh / 2 + 1,
                height: 3,
                borderRadius: 2,
                background: mk.ok ? "var(--good)" : "var(--bad)",
                pointerEvents: "none",
              }}
            ></div>`,
        )}
        ${cur &&
        html`<div
          style=${{
            position: "absolute",
            left: cur.pos * pps - 2,
            top: yOf(cur.midi + tr) - bh / 2 - 2,
            width: Math.max(3, (cur.end - cur.pos) * pps - 1.5) + 4,
            height: bh + 4,
            borderRadius: 6,
            background: "var(--accent)",
            boxShadow:
              "0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent)",
            pointerEvents: "none",
            display: "flex",
            alignItems: "center",
            paddingLeft: 6,
            overflow: "hidden",
          }}
        >
          <span
            class="mono"
            style=${{
              fontSize: 10,
              fontWeight: 600,
              color: "var(--accent-ink)",
              whiteSpace: "nowrap",
            }}
            >${nameOf(cur.midi)}</span
          >
        </div>`}
      </div>
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

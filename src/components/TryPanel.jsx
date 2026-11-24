// The "your tries" panel: try charts and breath-timing view.
import React, { useState, useEffect } from "react";
import { html } from "../html.js";
import { GRID } from "../lib/analysis.js";
import { NAMES, pretty } from "../lib/music.js";
import { tryStats, btInfo } from "../lib/tries.js";
import { Sheet } from "./Sheet.jsx";

export function BreathTimingView({ rec, notes, text }) {
  const info = btInfo(rec, notes, text);
  return html`<div class="flex flex-col gap-3">
    <div
      style=${{
        padding: 10,
        borderRadius: 14,
        background: "var(--surface-2)",
        border: "1px solid var(--line)",
      }}
    >
      <${TryChart} rec=${rec} notes=${notes} bt=${true} />
      <div
        class="flex flex-wrap gap-3 text-xs muted"
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
        <span>Bars at the bottom: early ↓ / late ↑ for each note</span>
      </div>
    </div>
    <div class="grid grid-cols-2 gap-2">
      ${info.stats.map(
        (st) =>
          html`<div
            key=${st.label}
            style=${{
              padding: "10px 12px",
              borderRadius: 12,
              background: "var(--surface-2)",
            }}
          >
            <div class="label" style=${{ fontSize: 10 }}>${st.label}</div>
            <div
              class="display font-bold"
              style=${{ fontSize: 17, color: "var(--" + st.tone + ")" }}
            >
              ${st.value}
            </div>
            <div class="text-xs muted">${st.note}</div>
          </div>`,
      )}
    </div>
    ${info.drift &&
    html`<div
      class="flex items-start gap-2 text-sm"
      style=${{
        padding: "11px 13px",
        borderRadius: 14,
        background: "color-mix(in srgb, var(--warn) 8%, transparent)",
        border: "1px solid color-mix(in srgb, var(--warn) 30%, transparent)",
      }}
    >
      <span aria-hidden="true">🔉</span
      ><span><b>Loud / soft:</b> ${info.drift}</span>
    </div>`}
    <div
      class="flex items-start gap-2 text-sm"
      style=${{
        padding: "11px 13px",
        borderRadius: 14,
        background: "color-mix(in srgb, var(--accent) 8%, transparent)",
        border:
          "1px solid color-mix(in srgb, var(--accent) 28%, transparent)",
      }}
    >
      <span aria-hidden="true">🎯</span><span><b>Tip:</b> ${info.tip}</span>
    </div>
  </div>`;
}

export function TryChart({ rec, notes, bt }) {
  const ph = rec.rows
    .map((r) => notes.find((n) => Math.abs(n.pos - r.p) < 0.002))
    .filter(Boolean);
  if (!ph.length) return null;
  const t0 = ph[0].pos,
    t1 = Math.max(t0 + 0.5, ph[ph.length - 1].end),
    sp = rec.speed || 1,
    st = rec.start != null ? rec.start : t0;
  let lo = Infinity,
    hi = -Infinity;
  ph.forEach((n) => {
    lo = Math.min(lo, n.midi);
    hi = Math.max(hi, n.midi);
  });
  (rec.trace || []).forEach((v) => {
    if (v != null) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  });
  lo -= 1;
  hi += 1;
  const W = 300,
    H = 140,
    HB = bt ? H + 30 : H,
    x = (t) => 6 + ((t - t0) / (t1 - t0)) * (W - 12),
    y = (m) => H - 16 - ((m - lo) / (hi - lo)) * (H - 34);
  const segs = [];
  let cur = [];
  (rec.trace || []).forEach((v, k) => {
    const t = st + k * 2 * GRID * sp;
    if (v == null || t < t0 - 0.05 || t > t1 + 0.05) {
      if (cur.length > 1) segs.push(cur);
      cur = [];
    } else cur.push(x(t).toFixed(1) + "," + y(v).toFixed(1));
  });
  if (cur.length > 1) segs.push(cur);
  const marks = rec.rows
    .map((r, i) => (r.sc && ph[i] ? ph[i] : null))
    .filter(Boolean);
  const B = rec.bt || { breaths: [], cut: null },
    base = H + 15;
  return html`<svg
    viewBox=${"0 0 " + W + " " + HB}
    style=${{ width: "100%", height: "auto", display: "block" }}
    role="img"
    aria-label="Your voice drawn over the song's notes"
  >
    ${bt &&
    html`<g>
      <line x1="0" x2=${W} y1=${base} y2=${base} stroke="var(--line)"></line>
      <text
        x=${W - 1}
        y=${base - 9}
        fill="var(--muted)"
        fontSize="8"
        textAnchor="end"
        >late ↑</text
      ><text
        x=${W - 1}
        y=${base + 14}
        fill="var(--muted)"
        fontSize="8"
        textAnchor="end"
        >early ↓</text
      >
      ${rec.rows.map((r, i) => {
        const n = ph[i];
        if (!n || r.c == null || Math.abs(r.c) > 50 || r.dt == null)
          return null;
        const v = Math.max(-0.3, Math.min(0.3, r.dt)),
          h = Math.max(1.5, (Math.abs(v) / 0.3) * 13),
          a = Math.abs(r.dt);
        return html`<rect
          key=${"t" + i}
          x=${(x(n.pos) + 1).toFixed(1)}
          y=${(v > 0 ? base - h : base).toFixed(1)}
          width=${Math.max(3, Math.min(14, x(n.end) - x(n.pos) - 2)).toFixed(
            1,
          )}
          height=${h.toFixed(1)}
          rx="2"
          fill=${"var(--" +
          (a < 0.08 ? "good" : a < 0.18 ? "warn" : "bad") +
          ")"}
          opacity="0.85"
        ></rect>`;
      })}
      ${B.breaths.map(
        (b, i) =>
          html`<g key=${"b" + i}
            ><line
              x1=${x(b.t).toFixed(1)}
              x2=${x(b.t).toFixed(1)}
              y1="12"
              y2=${H - 4}
              stroke="var(--warn)"
              strokeDasharray="3 3"
            ></line
            ><text
              x=${x(b.t).toFixed(1)}
              y="9"
              fill="var(--warn)"
              fontSize="9"
              textAnchor="middle"
              >breath</text
            ></g
          >`,
      )}
      ${B.cut &&
      ph[B.cut.i] &&
      html`<g
        ><line
          x1=${x(Math.max(t0, B.cut.t - B.cut.s)).toFixed(1)}
          x2=${x(B.cut.t).toFixed(1)}
          y1=${(y(ph[B.cut.i].midi) + 9).toFixed(1)}
          y2=${(y(ph[B.cut.i].midi) + 9).toFixed(1)}
          stroke="var(--bad)"
          strokeWidth="2.5"
          strokeLinecap="round"
        ></line
        ><text
          x=${Math.min(W - 2, x(B.cut.t)).toFixed(1)}
          y=${Math.min(H - 2, y(ph[B.cut.i].midi) + 21).toFixed(1)}
          fill="var(--bad)"
          fontSize="9"
          textAnchor="end"
          >cut short</text
        ></g
      >`}
    </g>`}
    ${ph.map(
      (n, i) =>
        html`<rect
          key=${"n" + i}
          x=${x(n.pos).toFixed(1)}
          y=${(y(n.midi) - 4).toFixed(1)}
          width=${Math.max(4, x(n.end) - x(n.pos) - 2).toFixed(1)}
          height="8"
          rx="4"
          fill="var(--accent)"
          opacity="0.55"
        ></rect>`,
    )}
    ${segs.map(
      (pts, i) =>
        html`<polyline
          key=${"s" + i}
          points=${pts.join(" ")}
          fill="none"
          stroke="var(--you)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        ></polyline>`,
    )}
    ${(() => {
      let lastX = -99;
      const nm = (m) => pretty(NAMES[((m % 12) + 12) % 12]);
      return ph.map((n, i) => {
        const r = rec.rows[i],
          lab = nm(n.midi),
          lx = x(n.pos) + 1;
        if (lx < lastX + 14) return null;
        lastX = lx + lab.length * 5.5;
        const off =
          r && r.c != null && Math.abs(r.c) > 50
            ? n.midi + Math.round(r.c / 100)
            : null;
        const warn =
          r && r.c != null && Math.abs(r.c) > 25 && Math.abs(r.c) <= 50;
        return html`<g
          key=${"l" + i}
          fontFamily="var(--font-mono)"
          fontSize="9"
          fontWeight="600"
        >
          <text
            x=${lx.toFixed(1)}
            y=${(y(n.midi) - 6).toFixed(1)}
            fill="var(--fg)"
            opacity="0.75"
            >${lab}${warn ? "" : ""}</text
          >
          ${warn &&
          html`<text
            x=${(lx + lab.length * 5.5 + 1).toFixed(1)}
            y=${(y(n.midi) - 6).toFixed(1)}
            fill="var(--warn)"
            >${r.c > 0 ? "↑" : "↓"}</text
          >`}
          ${off != null &&
          html`<text
            x=${lx.toFixed(1)}
            y=${Math.min(H - 2, y(off) + 13).toFixed(1)}
            fill="var(--bad)"
            >${nm(off)}</text
          >`}
          ${r &&
          r.c == null &&
          html`<text
            x=${lx.toFixed(1)}
            y=${Math.min(H - 2, y(n.midi) + 14).toFixed(1)}
            fill="var(--muted)"
            >–</text
          >`}
        </g>`;
      });
    })()}
    ${marks.map(
      (n, i) =>
        html`<circle
          key=${"m" + i}
          cx=${(x(n.pos) + 4).toFixed(1)}
          cy=${(y(n.midi) + 6).toFixed(1)}
          r="9"
          fill="none"
          stroke="var(--bad)"
          strokeWidth="2"
          strokeDasharray="3 3"
        ></circle>`,
    )}
  </svg>`;
}

export function TryPanel({
  open,
  line,
  tries,
  notes,
  onClose,
  onHear,
  canHear,
  onDrill,
}) {
  const [which, setWhich] = useState("last");
  const [ptab, setPtab] = useState("notes");
  useEffect(() => {
    setWhich("last");
    setPtab("notes");
  }, [line]);
  const rec = tries ? tries[which] || tries.last : null;
  const info = rec ? tryStats(rec) : null;
  return html`<${Sheet}
    open=${open && !!rec}
    title=${line
      ? line.text
        ? "“" + line.text + "”"
        : "Your try"
      : "Your try"}
    onClose=${onClose}
  >
    ${rec &&
    html`<div class="flex flex-col gap-3">
      ${tries.best &&
      tries.best !== tries.last &&
      html`<div
        class="seg"
        role="group"
        aria-label="Which try"
        style=${{ alignSelf: "flex-start" }}
      >
        <button
          aria-pressed=${which === "last" ? "true" : "false"}
          onClick=${() => setWhich("last")}
        >
          Last ${tries.last.score}%
        </button>
        <button
          aria-pressed=${which === "best" ? "true" : "false"}
          onClick=${() => setWhich("best")}
        >
          Best ${tries.best.score}%
        </button>
      </div>`}
      ${(!tries.best || tries.best === tries.last) &&
      html`<span class="text-sm muted">Score ${rec.score}%</span>`}
      ${rec.bt &&
      html`<div
        class="seg"
        role="group"
        aria-label="Details"
        style=${{ display: "grid", gridTemplateColumns: "1fr 1.4fr" }}
      >
        <button
          aria-pressed=${ptab === "notes" ? "true" : "false"}
          onClick=${() => setPtab("notes")}
        >
          Notes
        </button>
        <button
          aria-pressed=${ptab === "bt" ? "true" : "false"}
          onClick=${() => setPtab("bt")}
        >
          Breath & timing
        </button>
      </div>`}
      ${ptab === "bt" && rec.bt
        ? html`<${BreathTimingView}
            rec=${rec}
            notes=${notes}
            text=${line && line.text}
          />`
        : html`<${React.Fragment}>
            <div
              style=${{
                padding: 10,
                borderRadius: 14,
                background: "var(--surface-2)",
                border: "1px solid var(--line)",
              }}
            >
              <${TryChart} rec=${rec} notes=${notes} />
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
                ${rec.rows.some((r) => r.sc) &&
                html`<span class="flex items-center gap-1"
                  ><span
                    style=${{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      border: "2px dashed var(--bad)",
                    }}
                  ></span
                  >Slid into it</span
                >`}
              </div>
            </div>
            <div class="grid grid-cols-2 gap-2">
              ${info.stats.map(
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
                      style=${{
                        fontSize: 18,
                        color: "var(--" + st.tone + ")",
                      }}
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
                background:
                  "color-mix(in srgb, var(--accent) 8%, transparent)",
                border:
                  "1px solid color-mix(in srgb, var(--accent) 28%, transparent)",
              }}
            >
              <span aria-hidden="true">🎯</span
              ><span><b>Tip:</b> ${info.tip}</span>
            </div>
          <//>`}
      <div class="grid grid-cols-2 gap-2">
        <button
          class="btn"
          style=${{ justifyContent: "center", minHeight: 46 }}
          onClick=${onHear}
          disabled=${!canHear}
        >
          ▶ Hear me
        </button>
        <button
          class="btn btn-primary"
          style=${{ justifyContent: "center", minHeight: 46 }}
          onClick=${() => onDrill(rec, info)}
        >
          Drill this line
        </button>
      </div>
      ${!canHear &&
      html`<p class="text-xs muted" style=${{ margin: 0 }}>
        Recordings aren't kept after you leave, but your notes and scores are.
      </p>`}
    </div>`}
  <//>`;
}

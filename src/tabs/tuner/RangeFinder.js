// Tuner > My range: find your lowest and highest notes.
import React, { useState, useRef, useEffect } from "react";
import { Icon } from "../../components/Icon.js";
import { RangeKeys } from "../../components/RangeKeys.js";
import { html } from "../../html.js";
import { pretty, midiInfo } from "../../lib/music.js";
import { loadRanges, RANGE_KEY, comfyOf } from "../../lib/range.js";
import { saveJSON } from "../../lib/storage.js";
import { spanWords, keyDot, voiceType } from "./voice.js";

export function RangeFinder({ feedRef, listening, onStartMic, onStopMic }) {
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

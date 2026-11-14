// The Tuner tab (Match a note, My range, Song fit). Not split yet: your turn!
import React, { useState, useRef, useMemo, useEffect } from "react";
import { Dial } from "../../components/Dial.js";
import { Icon } from "../../components/Icon.js";
import { Keyboard } from "../../components/Keyboard.js";
import { RangeKeys } from "../../components/RangeKeys.js";
import { Sheet } from "../../components/Sheet.js";
import { html } from "../../html.js";
import { playPiano, playChime } from "../../lib/audio.js";
import { fmt, signed, midiInfo, pretty } from "../../lib/music.js";
import { comfyOf, RANGE_KEY, loadRanges } from "../../lib/range.js";
import { loadJSON, saveJSON, MATCH_KEY } from "../../lib/storage.js";

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
export function SongFit({
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

export function MatchTrainer({
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

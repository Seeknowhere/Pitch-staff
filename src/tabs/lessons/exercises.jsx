// The lesson exercises: hold, hiss, siren, pattern, posture check, breathing.
import { useEffect, useMemo, useState, useRef } from "react";
import { Icon } from "../../components/Icon.jsx";
import { Ring } from "../../components/Ring.jsx";
import { html } from "../../html.js";
import { playPiano, playChime } from "../../lib/audio.js";
import { median } from "../../lib/math.js";
import { pretty, midiInfo } from "../../lib/music.js";
import { useTimers } from "./hooks.js";

export const nm = (m) => pretty(midiInfo(Math.round(m)).label);

const TryDots = ({ n, results, cur }) =>
  html`<span
    class="flex gap-1"
    role="img"
    aria-label=${"Try " + Math.min(n, cur + 1) + " of " + n}
  >
    ${Array.from(
      { length: n },
      (_, k) =>
        html`<span
          key=${k}
          style=${{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background:
              k < results.length
                ? results[k]
                  ? "var(--good)"
                  : "var(--bad)"
                : k === cur
                  ? "var(--accent)"
                  : "var(--line)",
          }}
        ></span>`,
    )}
  </span>`;

const MicNote = ({ mic }) =>
  mic.err ? html`<div class="notice" role="alert">${mic.err}</div>` : null;

// ---- hold a note (match, slide, hum, sustain) ----
function HoldEx({ spec, range, mic, onDone }) {
  const [k, setK] = useState(0);
  const [phase, setPhase] = useState("ready");
  const [target, setTarget] = useState(null);
  const [cur, setCur] = useState(null);
  const [prog, setProg] = useState(0);
  const [res, setRes] = useState([]);
  const r = useRef({ trail: [] }),
    phaseRef = useRef("ready"),
    resRef = useRef([]);
  const T = useTimers();
  const QUIET = 2100;
  const go = (p) => {
    phaseRef.current = p;
    setPhase(p);
  };
  const pick = (i) => {
    if (spec.targets && spec.targets.length)
      return spec.targets[i % spec.targets.length];
    if (spec.notes === "center")
      return Math.max(
        range.lo,
        Math.min(range.hi, range.center + [0, 2, -2, 1, -1][i % 5]),
      );
    let m;
    do {
      m = range.lo + Math.floor(Math.random() * (range.hi - range.lo + 1));
    } while (m === r.current.last && range.hi > range.lo);
    return m;
  };
  const begin = async (i) => {
    if (!(await mic.start())) return;
    const t = pick(i);
    r.current = {
      last: t,
      target: t,
      quietUntil: performance.now() + QUIET,
      singAt: performance.now() + QUIET,
      holdStart: 0,
      lastIn: 0,
      lastOn: 0,
      cents: [],
      all: [],
      over: 0,
      prevSide: 0,
      best: 0,
      lock: null,
      doneTry: false,
      trail: [],
    };
    setTarget(t);
    setK(i);
    setProg(0);
    setCur(null);
    go("listen");
    playPiano(mic.ctx(), t, 2);
    T.later(() => {
      if (phaseRef.current === "listen") go("sing");
    }, QUIET);
  };
  const replay = () => {
    const s = r.current;
    if (
      s.target == null ||
      phaseRef.current === "hit" ||
      phaseRef.current === "miss"
    )
      return;
    s.quietUntil = performance.now() + QUIET;
    s.singAt = s.quietUntil;
    s.holdStart = 0;
    setProg(0);
    go("listen");
    playPiano(mic.ctx(), s.target, 2);
    T.later(() => {
      if (phaseRef.current === "listen") go("sing");
    }, QUIET);
  };
  const finish = (list) => {
    const n = list.length,
      hits = list.filter((x) => x.ok);
    const score = Math.round(
      list.reduce((a, x) => a + (x.ok ? 100 : Math.round(x.best * 70)), 0) /
        n,
    );
    const locks = hits.map((x) => x.lock).filter((x) => x != null);
    const lock = locks.length
      ? locks.reduce((a, b) => a + b, 0) / locks.length
      : null;
    const sds = hits.map((x) => x.sd).filter((x) => x != null);
    const sd = sds.length
      ? sds.reduce((a, b) => a + b, 0) / sds.length
      : null;
    const leans = list.map((x) => x.lean).filter((x) => x != null);
    const lean = leans.length ? median(leans) : 0;
    const over = list.reduce((a, x) => a + x.over, 0);
    const stats = [
      {
        label: "Found the note",
        value: hits.length + " of " + n,
        pct: (100 * hits.length) / n,
      },
    ];
    if (lock != null)
      stats.push({
        label: "Time to lock in",
        value: lock.toFixed(1) + " s avg",
        pct: Math.max(10, Math.min(100, 110 - lock * 25)),
      });
    if (sd != null)
      stats.push({
        label: "Steady once there",
        value: sd < 8 ? "Very steady" : sd < 14 ? "Good" : "A bit wobbly",
        pct: Math.max(15, Math.min(100, 110 - sd * 4)),
      });
    let tip;
    if (hits.length < n / 2 && Math.abs(lean) >= 25)
      tip =
        "You tended to sit a little " +
        (lean < 0
          ? "low (flat). Aim slightly higher and keep your breath flowing."
          : "high (sharp). Relax your throat and aim slightly lower.");
    else if (over >= 3)
      tip =
        "You slid past the note a few times and came back. Slow down right before you get there.";
    else if (lock != null && lock > 3)
      tip =
        "Take a breath and hear the note in your head before you start singing. It gets faster with practice.";
    else if (sd != null && sd >= 14)
      tip =
        "The note wobbled a bit once you found it. Take a fuller breath and keep the same vowel the whole time.";
    else
      tip =
        score >= 85
          ? "Clean and steady. Nice work!"
          : "Good effort. Try it again to make it feel automatic.";
    onDone({ score, pass: score >= 70, stats, tip });
  };
  const endTry = (ok) => {
    const s = r.current;
    if (s.doneTry) return;
    s.doneTry = true;
    const cs = s.cents.slice(-Math.round(spec.hold * 50));
    const mean = cs.length ? cs.reduce((a, b) => a + b, 0) / cs.length : 0;
    const sd =
      cs.length > 8
        ? Math.sqrt(
            cs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / cs.length,
          )
        : null;
    const item = {
      ok,
      lock: s.lock,
      sd,
      lean: s.all.length ? median(s.all.slice(-90)) : null,
      over: s.over,
      best: ok ? 1 : s.best,
    };
    go(ok ? "hit" : "miss");
    if (ok) playChime(mic.ctx());
    const next = [...resRef.current, item];
    resRef.current = next;
    setRes(next);
    T.later(
      () => {
        if (next.length >= spec.tries) finish(next);
        else begin(next.length);
      },
      ok ? 1100 : 1500,
    );
  };
  mic.setFeed((m, rms, now) => {
    const s = r.current;
    if (phaseRef.current !== "sing" || now < s.quietUntil) return;
    if (now - s.singAt > (spec.hold + 9) * 1000) {
      endTry(false);
      return;
    }
    if (m == null) {
      if (s.holdStart && now - s.lastOn > 220) {
        s.holdStart = 0;
        setProg(0);
      }
      if (now - s.lastOn > 220) setCur(null);
      return;
    }
    let d = m - s.target;
    d -= 12 * Math.round(d / 12);
    const c = Math.round(d * 100);
    s.lastOn = now;
    s.all.push(c);
    s.trail.push({ t: now, c });
    while (s.trail.length && now - s.trail[0].t > 3000) s.trail.shift();
    setCur({ m, c });
    const side = c < -spec.tol ? -1 : c > spec.tol ? 1 : 0;
    if (side && s.prevSide && side !== s.prevSide) s.over++;
    if (side) s.prevSide = side;
    if (!side) {
      if (!s.holdStart) {
        s.holdStart = now;
        if (s.lock == null) s.lock = (now - s.singAt) / 1000;
      }
      s.lastIn = now;
      s.cents.push(c);
      const p = Math.min(1, (now - s.holdStart) / (spec.hold * 1000));
      setProg(p);
      s.best = Math.max(s.best, p);
      if (p >= 1) endTry(true);
    } else if (s.holdStart && now - s.lastIn > 180) {
      s.holdStart = 0;
      setProg(0);
    }
  });

  const tol = spec.tol;
  const inZone = cur && Math.abs(cur.c) <= tol;
  let hint,
    tone = "muted";
  if (phase === "ready") hint = "Tap Start, listen, then sing.";
  else if (phase === "listen") hint = "Listen…";
  else if (phase === "hit") {
    hint = "Got it!";
    tone = "good";
  } else if (phase === "miss") {
    hint = "Let's try the next one.";
    tone = "warn";
  } else if (!cur)
    hint = "Your turn. " + (spec.verb || "Sing") + " the note.";
  else if (inZone) {
    hint = spec.hold > 1.5 ? "Locked in, hold it!" : "That's it, hold…";
    tone = "good";
  } else if (cur.c < 0) {
    hint = cur.c < -100 ? "Go up ↑" : "A little higher ↑";
    tone = "warn";
  } else {
    hint = cur.c > 100 ? "Go down ↓" : "A little lower ↓";
    tone = "warn";
  }
  // trail chart: the last 3 seconds of your voice against the target band
  const W = 320,
    H = 150,
    mid = H / 2,
    sc = (c) => mid - (Math.max(-300, Math.min(300, c)) * (mid - 10)) / 300;
  const now = performance.now(),
    tr = r.current.trail || [];
  const pts = tr
    .map(
      (p) =>
        (W - 12 - ((now - p.t) / 3000) * (W - 24)).toFixed(1) +
        "," +
        sc(p.c).toFixed(1),
    )
    .join(" ");
  const band = (tol * (mid - 10)) / 300;
  return html`<div class="flex flex-col gap-3">
    <section class="tuner-card" style=${{ alignItems: "stretch", gap: 12 }}>
      <div class="flex items-center justify-between gap-2">
        <span class="display font-bold" style=${{ fontSize: 20 }}
          >${spec.verb || "Sing"}
          ${target != null ? nm(target) : "the note"}</span
        >
        <${TryDots}
          n=${spec.tries}
          results=${res.map((x) => x.ok)}
          cur=${k}
        />
      </div>
      <svg
        viewBox=${"0 0 " + W + " " + H}
        style=${{ width: "100%", height: "auto", display: "block" }}
        role="img"
        aria-label=${cur
          ? "You are " +
            Math.abs(cur.c) +
            " cents " +
            (cur.c < 0 ? "below" : "above") +
            " the target"
          : "Waiting for your voice"}
      >
        <rect
          x="0"
          y=${(mid - band).toFixed(1)}
          width=${W}
          height=${(2 * band).toFixed(1)}
          rx="6"
          fill="color-mix(in srgb, var(--good) 14%, transparent)"
        ></rect>
        <line
          x1="0"
          y1=${mid}
          x2=${W}
          y2=${mid}
          stroke="var(--good)"
          strokeWidth="2"
          strokeDasharray="6 6"
        ></line>
        <text
          x="6"
          y=${(mid - band - 6).toFixed(1)}
          fill="var(--good)"
          fontSize="12"
          fontFamily="JetBrains Mono, monospace"
        >
          ${target != null ? nm(target) + " target" : "target"}
        </text>
        ${pts &&
        html`<polyline
          points=${pts}
          fill="none"
          stroke="var(--you)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        ></polyline>`}
        ${cur &&
        phase === "sing" &&
        html`<circle
          cx=${W - 12}
          cy=${sc(cur.c).toFixed(1)}
          r="6"
          fill="var(--fg)"
        ></circle>`}
      </svg>
      <div class="flex items-center justify-center gap-5">
        <${Ring}
          p=${phase === "hit" ? 1 : prog}
          label="Hold"
          value=${(spec.hold * (phase === "hit" ? 1 : prog)).toFixed(1) + "s"}
          tone=${phase === "hit" || inZone ? "good" : "warn"}
        />
        <span class="flex flex-col gap-1 min-w-0">
          ${phase === "sing" &&
          cur &&
          html`<span class="text-xs muted">You're on</span
            ><span
              class="display font-bold"
              style=${{ fontSize: 24, color: "var(--you)" }}
              >${nm(cur.m)}</span
            >`}
          <span
            class="display font-bold"
            style=${{
              fontSize: 19,
              lineHeight: 1.2,
              color: "var(--" + tone + ")",
            }}
            aria-live="polite"
            >${hint}</span
          >
        </span>
      </div>
    </section>
    <${MicNote} mic=${mic} />
    ${phase === "ready"
      ? html`<button
          class="btn btn-primary"
          style=${{ justifyContent: "center", minHeight: 48, fontSize: 16 }}
          onClick=${() => begin(0)}
        >
          <span class="flex items-center gap-2"
            ><${Icon} name="mic" size=${18} />Start</span
          >
        </button>`
      : html`<div class="grid grid-cols-2 gap-2">
          <button
            class="btn"
            style=${{ justifyContent: "center", minHeight: 46 }}
            onClick=${replay}
            disabled=${phase === "hit" || phase === "miss"}
          >
            ▶ Hear note
          </button>
          <button
            class="btn"
            style=${{ justifyContent: "center", minHeight: 46 }}
            onClick=${() => endTry(false)}
            disabled=${phase !== "sing"}
          >
            Skip this one
          </button>
        </div>`}
  </div>`;
}

// ---- long hiss: how long you can let air out evenly ----
function HissEx({ spec, mic, onDone }) {
  const [phase, setPhase] = useState("ready");
  const [secs, setSecs] = useState(0);
  const [list, setList] = useState([]);
  const r = useRef({}),
    phaseRef = useRef("ready"),
    listRef = useRef([]);
  const go = (p) => {
    phaseRef.current = p;
    setPhase(p);
  };
  const finish = (l) => {
    const best = Math.max(...l),
      avg = l.reduce((a, b) => a + b, 0) / l.length;
    const score = Math.min(100, Math.round((best / spec.target) * 100));
    const stats = [
      {
        label: "Longest hiss",
        value: best.toFixed(1) + " s",
        pct: Math.min(100, (best / spec.target) * 100),
      },
    ];
    if (l.length > 1)
      stats.push({
        label: "Average",
        value: avg.toFixed(1) + " s",
        pct: Math.min(100, (avg / spec.target) * 100),
      });
    const tip =
      best < spec.target * 0.5
        ? "Breathe low into your belly before you start, then let the air out slowly, like a tiny leak."
        : best < spec.target
          ? "Good control. Next time try a quieter hiss. Less air per second means a longer hiss."
          : "Great breath control. This is what keeps long notes steady.";
    onDone({
      score,
      pass: best >= spec.target * 0.66,
      stats,
      tip,
      detail: best.toFixed(1) + " s",
    });
  };
  const start = async () => {
    if (!(await mic.start())) return;
    r.current = {
      base: [],
      until: performance.now() + 700,
      thr: 0,
      t0: 0,
      lastOn: 0,
      shown: 0,
    };
    setSecs(0);
    go("calib");
  };
  mic.setFeed((m, rms, now) => {
    const s = r.current,
      p = phaseRef.current;
    if (p === "calib") {
      s.base.push(rms);
      if (now > s.until) {
        s.thr = Math.max(median(s.base) * 3, 0.004);
        go("go");
      }
    } else if (p === "go") {
      if (rms > s.thr) {
        s.t0 = now;
        s.lastOn = now;
        go("blow");
      }
    } else if (p === "blow") {
      if (rms > s.thr) {
        s.lastOn = now;
        const t = (now - s.t0) / 1000;
        if (t - s.shown >= 0.1) {
          s.shown = t;
          setSecs(t);
        }
      } else if (now - s.lastOn > 450) {
        const dur = (s.lastOn - s.t0) / 1000;
        if (dur < 1.5) {
          s.shown = 0;
          setSecs(0);
          go("go");
          return;
        }
        setSecs(dur);
        const l = [...listRef.current, dur];
        listRef.current = l;
        setList(l);
        if (l.length >= spec.tries) {
          go("done");
          setTimeout(() => finish(l), 900);
        } else go("rest");
      }
    }
  });
  const best = list.length ? Math.max(...list) : 0;
  const msg = {
    ready: "Tap Start, take a low breath, then hiss.",
    calib: "Stay quiet for a moment…",
    go: "Go! Hiss “sss” now.",
    blow: "Keep it even…",
    rest: "Nice. Breathe, then go again.",
    done: "Done!",
  }[phase];
  return html`<div class="flex flex-col gap-3">
    <section class="tuner-card" style=${{ gap: 14 }}>
      <div
        class="flex items-center justify-between gap-2"
        style=${{ alignSelf: "stretch" }}
      >
        <span class="display font-bold" style=${{ fontSize: 20 }}
          >Long, even hiss</span
        >
        ${spec.tries > 1 &&
        html`<span class="text-xs muted"
          >Try ${Math.min(spec.tries, list.length + 1)} of ${spec.tries}</span
        >`}
      </div>
      <${Ring}
        p=${secs / spec.target}
        label=${"Goal " + spec.target + "s"}
        value=${secs.toFixed(1) + "s"}
        tone=${secs >= spec.target ? "good" : "accent"}
        size=${150}
      />
      <span
        class="display font-bold"
        style=${{ fontSize: 19 }}
        aria-live="polite"
        >${msg}</span
      >
      ${list.length > 0 &&
      html`<span class="text-sm muted"
        >Best so far:
        <b style=${{ color: "var(--fg)" }}>${best.toFixed(1)} s</b></span
      >`}
    </section>
    <${MicNote} mic=${mic} />
    ${phase === "ready" &&
    html`<button
      class="btn btn-primary"
      style=${{ justifyContent: "center", minHeight: 48, fontSize: 16 }}
      onClick=${start}
    >
      Start
    </button>`}
    ${phase === "rest" &&
    html`<div class="grid grid-cols-2 gap-2">
      <button
        class="btn"
        style=${{ justifyContent: "center", minHeight: 46 }}
        onClick=${() => finish(listRef.current)}
      >
        Finish
      </button>
      <button
        class="btn btn-primary"
        style=${{ justifyContent: "center", minHeight: 46 }}
        onClick=${() => {
          r.current.shown = 0;
          setSecs(0);
          go("go");
        }}
      >
        Go again
      </button>
    </div>`}
  </div>`;
}

// ---- siren: how far you can glide in one smooth slide ----
function SirenEx({ spec, range, mic, onDone }) {
  const [phase, setPhase] = useState("ready");
  const [live, setLive] = useState(null);
  const [list, setList] = useState([]);
  const r = useRef({}),
    phaseRef = useRef("ready"),
    listRef = useRef([]);
  const go = (p) => {
    phaseRef.current = p;
    setPhase(p);
  };
  const target = Math.max(7, Math.min(14, range.full.hi - range.full.lo - 2));
  const finish = (l) => {
    const b = l.reduce((a, x) => (x.hi - x.lo > a.hi - a.lo ? x : a), l[0]);
    const span = b.hi - b.lo;
    const score = Math.min(100, Math.round((span / target) * 100));
    const stats = [
      {
        label: "Widest slide",
        value: nm(b.lo) + " → " + nm(b.hi),
        pct: Math.min(100, (span / target) * 100),
      },
      {
        label: "Notes covered",
        value: Math.round(span) + " notes",
        pct: Math.min(100, (span / target) * 100),
      },
    ];
    const tip =
      span < target * 0.6
        ? "Start lower and keep the air flowing as you go up. Let it get light and soft at the top instead of pushing."
        : span < target
          ? "Smooth slide! Over time you'll gently stretch a little further."
          : "Lovely wide siren. Keep it easy and it'll keep growing.";
    onDone({ score, pass: span >= target * 0.6, stats, tip });
  };
  const start = async () => {
    if (!(await mic.start())) return;
    r.current = { buf: [], lo: null, hi: null, lastOn: 0 };
    setLive(null);
    go("go");
  };
  mic.setFeed((m, rms, now) => {
    const s = r.current,
      p = phaseRef.current;
    if (p !== "go" && p !== "slide") return;
    if (m != null) {
      s.buf.push(m);
      if (s.buf.length > 5) s.buf.shift();
      if (s.buf.length < 3) return;
      const v = median(s.buf);
      if (p === "go") {
        s.lo = s.hi = v;
        go("slide");
      }
      s.lo = Math.min(s.lo, v);
      s.hi = Math.max(s.hi, v);
      s.lastOn = now;
      setLive({ v, lo: s.lo, hi: s.hi });
    } else if (p === "slide" && now - s.lastOn > 600) {
      s.buf = [];
      if (s.hi - s.lo < 2) {
        go("go");
        setLive(null);
        return;
      }
      const l = [...listRef.current, { lo: s.lo, hi: s.hi }];
      listRef.current = l;
      setList(l);
      if (l.length >= spec.tries) {
        go("done");
        setTimeout(() => finish(l), 700);
      } else go("rest");
    }
  });
  const lo = range.full.lo - 5,
    hi = range.full.hi + 5,
    H = 220;
  const y = (v) =>
    H - 10 - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (H - 20);
  const msg = {
    ready: "Tap Start, then slide from low to high.",
    go: "Start low and glide up…",
    slide: "Keep going, nice and smooth…",
    rest: "Good one! Breathe, then go again.",
    done: "Done!",
  }[phase];
  const best = list.length ? Math.max(...list.map((x) => x.hi - x.lo)) : 0;
  return html`<div class="flex flex-col gap-3">
    <section class="tuner-card" style=${{ alignItems: "stretch", gap: 12 }}>
      <div class="flex items-center justify-between gap-2">
        <span class="display font-bold" style=${{ fontSize: 20 }}
          >Siren slide</span
        >
        ${spec.tries > 1 &&
        html`<span class="text-xs muted"
          >Try ${Math.min(spec.tries, list.length + 1)} of ${spec.tries}</span
        >`}
      </div>
      <div class="flex items-center gap-4">
        <svg
          width="90"
          height=${H}
          viewBox=${"0 0 90 " + H}
          role="img"
          aria-label=${live
            ? "Sliding from " + nm(live.lo) + " to " + nm(live.hi)
            : "Waiting for your voice"}
          style=${{ flexShrink: 0 }}
        >
          <rect
            x="30"
            y="10"
            width="30"
            height=${H - 20}
            rx="15"
            fill="var(--surface-2)"
            stroke="var(--line)"
          ></rect>
          ${live &&
          html`<rect
            x="30"
            y=${y(live.hi).toFixed(1)}
            width="30"
            height=${Math.max(6, y(live.lo) - y(live.hi)).toFixed(1)}
            rx="15"
            fill="color-mix(in srgb, var(--accent) 60%, transparent)"
          ></rect>`}
          ${live &&
          html`<circle
            cx="45"
            cy=${y(live.v).toFixed(1)}
            r="9"
            fill="var(--you)"
          ></circle>`}
        </svg>
        <div class="flex flex-col gap-2 min-w-0">
          <span
            class="display font-bold"
            style=${{ fontSize: 19, lineHeight: 1.25 }}
            aria-live="polite"
            >${msg}</span
          >
          ${live &&
          html`<span class="text-sm muted"
            >${nm(live.lo)} →
            <b style=${{ color: "var(--fg)" }}>${nm(live.hi)}</b> ·
            ${Math.round(live.hi - live.lo)} notes</span
          >`}
          ${list.length > 0 &&
          html`<span class="text-sm muted"
            >Widest so far: ${Math.round(best)} notes (goal ${target})</span
          >`}
        </div>
      </div>
    </section>
    <${MicNote} mic=${mic} />
    ${phase === "ready" &&
    html`<button
      class="btn btn-primary"
      style=${{ justifyContent: "center", minHeight: 48, fontSize: 16 }}
      onClick=${start}
    >
      Start
    </button>`}
    ${phase === "rest" &&
    html`<div class="grid grid-cols-2 gap-2">
      <button
        class="btn"
        style=${{ justifyContent: "center", minHeight: 46 }}
        onClick=${() => finish(listRef.current)}
      >
        Finish
      </button>
      <button
        class="btn btn-primary"
        style=${{ justifyContent: "center", minHeight: 46 }}
        onClick=${() => {
          r.current = { buf: [], lo: null, hi: null, lastOn: 0 };
          setLive(null);
          go("go");
        }}
      >
        Go again
      </button>
    </div>`}
  </div>`;
}

// ---- sing back a pattern (steps, jumps, scales, trills) ----
export function patternFor(spec, range) {
  if (spec.fixed) {
    const mn = Math.min(...spec.fixed);
    return spec.fixed.map((m) => m - mn);
  }
  let pat = spec.pattern;
  const span = range.full.hi - range.full.lo;
  if (spec.bigFallback && Math.max(...pat) > span - 1) pat = spec.bigFallback;
  return pat;
}

function matchSeq(targets, sung, tol) {
  // best order-keeping match (any octave for the whole try)
  let best = { hits: -1, marks: [], shift: 0 };
  [-12, 0, 12].forEach((shift) => {
    const n = targets.length,
      m = sung.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = 1; i <= n; i++)
      for (let j = 1; j <= m; j++) {
        const ok = Math.abs(sung[j - 1] - (targets[i - 1] + shift)) <= tol;
        dp[i][j] = Math.max(
          dp[i - 1][j],
          dp[i][j - 1],
          ok ? dp[i - 1][j - 1] + 1 : 0,
        );
      }
    if (dp[n][m] > best.hits) {
      const marks = new Array(n).fill(false);
      let i = n,
        j = m;
      while (i > 0 && j > 0) {
        const ok = Math.abs(sung[j - 1] - (targets[i - 1] + shift)) <= tol;
        if (ok && dp[i][j] === dp[i - 1][j - 1] + 1) {
          marks[i - 1] = true;
          i--;
          j--;
        } else if (dp[i - 1][j] >= dp[i][j - 1]) i--;
        else j--;
      }
      best = { hits: dp[n][m], marks, shift };
    }
  });
  return best;
}

function PatternEx({ spec, range, mic, onDone }) {
  const pat = useMemo(() => patternFor(spec, range), [spec, range]);
  const top = Math.max(...pat);
  const baseFor = (i) => {
    if (spec.fixed) return Math.min(...spec.fixed);
    const startLo = Math.max(
      range.full.lo,
      Math.min(range.lo, range.center - Math.round(top / 2)),
    );
    let b = startLo + i * (spec.rise || 0);
    if (b + top > range.full.hi + 1)
      b = Math.max(range.full.lo, range.full.hi + 1 - top);
    return b;
  };
  const [round, setRound] = useState(0);
  const [phase, setPhase] = useState("ready");
  const [heard, setHeard] = useState([]);
  const [judged, setJudged] = useState(null);
  const [playIdx, setPlayIdx] = useState(-1);
  const [rounds, setRounds] = useState([]);
  const r = useRef({}),
    phaseRef = useRef("ready"),
    roundsRef = useRef([]);
  const T = useTimers();
  const go = (p) => {
    phaseRef.current = p;
    setPhase(p);
  };
  const stepFor = (i) =>
    spec.steps
      ? spec.steps[Math.min(i, spec.steps.length - 1)]
      : spec.verb === "Trill"
        ? 520
        : 600;
  const targets = pat.map((x) => baseFor(round) + x);
  const play = async (i) => {
    if (!(await mic.start())) return;
    T.clear();
    const tg = pat.map((x) => baseFor(i) + x);
    const prevSrc = r.current.src0;
    r.current = {
      tg,
      buf: [],
      curN: null,
      curStart: 0,
      curVals: [],
      notes: [],
      lastOn: 0,
      singAt: 0,
      quietUntil: Infinity,
      src0: prevSrc,
    };
    setRound(i);
    setHeard([]);
    setJudged(null);
    go("play");
    const STEP = stepFor(i);
    let end;
    if (r.current.src0) {
      try {
        r.current.src0.stop();
      } catch (e) {}
    }
    if (spec.source && spec.source.buffer) {
      // play the real line from the original vocal
      const c = mic.ctx(),
        src = c.createBufferSource();
      src.buffer = spec.source.buffer;
      src.connect(c.destination);
      const len = Math.max(0.5, spec.source.end - spec.source.start);
      src.start(c.currentTime + 0.05, spec.source.start, len);
      r.current.src0 = src;
      end = len * 1000 + 600;
    } else {
      const ring = Math.min(1.6, STEP / 1000 + 0.9);
      tg.forEach((m, j) =>
        T.later(() => {
          playPiano(mic.ctx(), m, ring);
          setPlayIdx(j);
        }, j * STEP),
      );
      end = (tg.length - 1) * STEP + ring * 1000 + 150;
    }
    T.later(() => {
      setPlayIdx(-1);
      r.current.quietUntil = performance.now();
      r.current.singAt = performance.now();
      go("sing");
    }, end);
  };
  const closeNote = (s, now) => {
    if (s.curN != null && now - s.curStart >= 150 && s.curVals.length) {
      const v = s.curVals.reduce((a, b) => a + b, 0) / s.curVals.length;
      const last = s.notes[s.notes.length - 1];
      if (last && Math.abs(last.v - v) < 0.5 && s.curStart - last.end < 120) {
        last.end = now;
      } else s.notes.push({ v, end: now });
      setHeard(s.notes.map((x) => x.v));
    }
    s.curN = null;
    s.curVals = [];
  };
  const judge = () => {
    const s = r.current;
    closeNote(s, performance.now());
    const sung = s.notes.map((x) => x.v);
    const mt = matchSeq(s.tg, sung, spec.tol);
    const item = {
      hits: mt.hits,
      n: s.tg.length,
      marks: mt.marks,
      sung,
      tg: s.tg,
      shift: mt.shift,
    };
    setJudged(item);
    go("judged");
    const next = [...roundsRef.current, item];
    roundsRef.current = next;
    setRounds(next);
    if (mt.hits === s.tg.length) playChime(mic.ctx());
  };
  mic.setFeed((m, rms, now) => {
    const s = r.current;
    if (phaseRef.current !== "sing" || now < s.quietUntil) return;
    const limit = s.tg.length * 0.9 + 3.5;
    if ((now - s.singAt) / 1000 > limit) {
      judge();
      return;
    }
    if (m == null) {
      s.buf = [];
      if (s.curN != null && now - s.lastOn > 100) closeNote(s, now);
      if (s.notes.length >= s.tg.length && now - s.lastOn > 1200) judge();
      else if (s.notes.length > 0 && now - s.lastOn > 2600) judge();
      return;
    }
    s.lastOn = now;
    s.buf.push(m);
    if (s.buf.length > 5) s.buf.shift();
    const v = median(s.buf),
      n = Math.round(v);
    if (s.curN === n) s.curVals.push(v);
    else {
      closeNote(s, now);
      s.curN = n;
      s.curStart = now;
      s.curVals = [v];
    }
  });
  const finish = () => {
    const l = roundsRef.current,
      tot = l.reduce((a, x) => a + x.n, 0),
      hits = l.reduce((a, x) => a + x.hits, 0);
    const score = Math.round((100 * hits) / Math.max(1, tot));
    const bestR = Math.max(...l.map((x) => Math.round((100 * x.hits) / x.n)));
    const stats = [
      {
        label: "Notes right",
        value: hits + " of " + tot,
        pct: (100 * hits) / Math.max(1, tot),
      },
      { label: "Best round", value: bestR + "%", pct: bestR },
    ];
    // which way did the missed notes go?
    let flat = 0,
      sharp = 0,
      unheard = 0,
      highMiss = 0,
      missed = 0;
    l.forEach((x) =>
      x.tg.forEach((t, i) => {
        if (x.marks[i]) return;
        missed++;
        if (pat[i] >= top - 1 && top >= 4) highMiss++;
        if (!x.sung.length) {
          unheard++;
          return;
        }
        const d = x.sung
          .map((v) => v - (t + x.shift))
          .reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a));
        if (Math.abs(d) > 3) unheard++;
        else if (d < 0) flat++;
        else sharp++;
      }),
    );
    let tip;
    if (!missed) tip = "Every note clean. Brilliant!";
    else if (unheard > missed / 2)
      tip =
        "Some notes were too short for Tono to catch. Give each note its own moment and sing a little longer on each.";
    else if (highMiss > missed / 2)
      tip =
        "The top notes were the trickiest. Sing them lighter and softer instead of reaching for them.";
    else if (flat > sharp * 1.5)
      tip =
        "On the notes you missed you were a bit low. Aim slightly higher and keep your breath going through the pattern.";
    else if (sharp > flat * 1.5)
      tip =
        "On the notes you missed you were a bit high. Relax and aim slightly lower.";
    else
      tip =
        "Close! Listen once more and picture each note before you sing it.";
    onDone({ score, pass: score >= 70, stats, tip });
  };
  const lastRound = round + 1 >= spec.rounds;
  useEffect(
    () => () => {
      if (r.current.src0) {
        try {
          r.current.src0.stop();
        } catch (e) {}
      }
    },
    [],
  );
  const hint = {
    ready: spec.source
      ? "Tap Start to hear the line."
      : "Tap Start to hear the pattern.",
    play: "Listen…",
    sing:
      "Your turn. " +
      (spec.verb === "Trill" ? "Trill" : "Sing") +
      " it back.",
    judged: judged
      ? judged.hits === judged.n
        ? "Perfect round!"
        : judged.hits + " of " + judged.n + " notes right"
      : "",
  }[phase];
  return html`<div class="flex flex-col gap-3">
    <section class="tuner-card" style=${{ alignItems: "stretch", gap: 14 }}>
      <div class="flex items-center justify-between gap-2">
        <span class="display font-bold" style=${{ fontSize: 20 }}
          >${spec.verb === "Trill" ? "Trill it back" : "Sing it back"}</span
        >
        <span class="text-xs muted"
          >${spec.stages
            ? spec.stages[Math.min(round, spec.stages.length - 1)] + " · "
            : ""}${spec.rounds > 1
            ? "Round " + (round + 1) + " of " + spec.rounds
            : ""}</span
        >
      </div>
      <div
        class="flex flex-wrap justify-center gap-2"
        role="list"
        aria-label="Pattern notes"
      >
        ${targets.map((t, i) => {
          const st = judged
            ? judged.marks[i]
              ? "ok"
              : "bad"
            : playIdx === i
              ? "now"
              : "";
          return html`<span
            key=${i}
            role="listitem"
            class="mono"
            style=${{
              minWidth: 44,
              padding: "10px 8px",
              textAlign: "center",
              borderRadius: 12,
              fontSize: 14,
              fontWeight: 600,
              border:
                "1px solid " +
                (st === "ok"
                  ? "var(--good)"
                  : st === "bad"
                    ? "var(--bad)"
                    : st === "now"
                      ? "var(--accent)"
                      : "var(--line)"),
              background:
                st === "ok"
                  ? "color-mix(in srgb, var(--good) 14%, transparent)"
                  : st === "bad"
                    ? "color-mix(in srgb, var(--bad) 12%, transparent)"
                    : st === "now"
                      ? "color-mix(in srgb, var(--accent) 22%, transparent)"
                      : "var(--surface-2)",
              transform: "translateY(" + -pat[i] * 1.5 + "px)",
            }}
            >${nm(t)}${st === "ok" ? " ✓" : st === "bad" ? " ✗" : ""}</span
          >`;
        })}
      </div>
      <div
        class="flex items-center justify-between gap-3"
        style=${{ minHeight: 28 }}
      >
        <span
          class="display font-bold"
          style=${{
            fontSize: 19,
            color:
              phase === "judged"
                ? judged && judged.hits === judged.n
                  ? "var(--good)"
                  : "var(--warn)"
                : "var(--fg)",
          }}
          aria-live="polite"
          >${hint}</span
        >
        ${phase === "sing" &&
        html`<span class="text-sm muted mono"
          >${heard.length
            ? heard
                .slice(-4)
                .map((v) => nm(v))
                .join(" ")
            : "…"}</span
        >`}
      </div>
    </section>
    <${MicNote} mic=${mic} />
    ${phase === "ready" &&
    html`<button
      class="btn btn-primary"
      style=${{ justifyContent: "center", minHeight: 48, fontSize: 16 }}
      onClick=${() => play(0)}
    >
      Start
    </button>`}
    ${(phase === "sing" || phase === "play") &&
    html`<div class="grid grid-cols-2 gap-2">
      <button
        class="btn"
        style=${{ justifyContent: "center", minHeight: 46 }}
        onClick=${() => play(round)}
        disabled=${phase === "play"}
      >
        ▶ Hear again
      </button>
      <button
        class="btn"
        style=${{ justifyContent: "center", minHeight: 46 }}
        onClick=${judge}
        disabled=${phase !== "sing"}
      >
        I'm done
      </button>
    </div>`}
    ${phase === "judged" &&
    html`<div class="grid grid-cols-2 gap-2">
      <button
        class="btn"
        style=${{ justifyContent: "center", minHeight: 46 }}
        onClick=${() => {
          roundsRef.current = roundsRef.current.slice(0, -1);
          setRounds(roundsRef.current);
          play(round);
        }}
      >
        ↻ Redo round
      </button>
      <button
        class="btn btn-primary"
        style=${{ justifyContent: "center", minHeight: 46 }}
        onClick=${() => (lastRound ? finish() : play(round + 1))}
      >
        ${lastRound ? "See result" : "Next round →"}
      </button>
    </div>`}
  </div>`;
}

// ---- posture checklist ----
function CheckEx({ spec, onDone }) {
  const [on, setOn] = useState(spec.steps.map(() => false));
  const all = on.every(Boolean);
  return html`<div class="flex flex-col gap-3">
    <section class="tuner-card" style=${{ alignItems: "stretch", gap: 10 }}>
      <span class="display font-bold" style=${{ fontSize: 20 }}
        >Check each one</span
      >
      ${spec.steps.map(
        (t, i) =>
          html`<button
            key=${i}
            class="flex items-center gap-3"
            style=${{
              textAlign: "left",
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid " + (on[i] ? "var(--good)" : "var(--line)"),
              background: on[i]
                ? "color-mix(in srgb, var(--good) 10%, transparent)"
                : "var(--surface-2)",
              color: "var(--fg)",
              font: "inherit",
              cursor: "pointer",
            }}
            role="checkbox"
            aria-checked=${on[i] ? "true" : "false"}
            onClick=${() => setOn(on.map((v, j) => (j === i ? !v : v)))}
          >
            <span
              style=${{
                width: 24,
                height: 24,
                borderRadius: 7,
                flexShrink: 0,
                display: "grid",
                placeItems: "center",
                background: on[i] ? "var(--good)" : "transparent",
                border: on[i] ? "0" : "2px solid var(--line)",
                color: "var(--bg)",
                fontWeight: 700,
              }}
              >${on[i] ? "✓" : ""}</span
            >
            <span class="text-sm">${t}</span>
          </button>`,
      )}
    </section>
    <button
      class="btn btn-primary"
      style=${{ justifyContent: "center", minHeight: 48, fontSize: 16 }}
      disabled=${!all}
      onClick=${() =>
        onDone({
          score: 100,
          pass: true,
          stats: [],
          tip: spec.tip,
          simple: true,
        })}
    >
      ${all ? "Done" : "Tick all four to finish"}
    </button>
  </div>`;
}

// ---- guided belly breathing ----
function BreathEx({ spec, onDone }) {
  const [state, setState] = useState({ phase: "ready", round: 0, left: 0 });
  const T = useTimers();
  const run = (round, phase) => {
    const len = phase === "in" ? spec.inhale : spec.exhale;
    for (let s = 0; s < len; s++)
      T.later(() => setState({ phase, round, left: len - s }), s * 1000);
    T.later(() => {
      if (phase === "in") run(round, "out");
      else if (round + 1 < spec.rounds) run(round + 1, "in");
      else setState({ phase: "done", round, left: 0 });
    }, len * 1000);
  };
  const big = state.phase === "in";
  return html`<div class="flex flex-col gap-3">
    <section class="tuner-card" style=${{ gap: 16, minHeight: 320 }}>
      <span class="text-xs muted"
        >${state.phase === "ready"
          ? spec.rounds + " slow breaths"
          : state.phase === "done"
            ? "All done"
            : "Breath " + (state.round + 1) + " of " + spec.rounds}</span
      >
      <span
        style=${{
          width: 180,
          height: 180,
          display: "grid",
          placeItems: "center",
        }}
      >
        <span
          style=${{
            width: 180,
            height: 180,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--accent) 45%, transparent), color-mix(in srgb, var(--accent) 10%, transparent))",
            transform:
              "scale(" + (big ? 1 : state.phase === "out" ? 0.55 : 0.7) + ")",
            transition:
              "transform " +
              (big ? spec.inhale : spec.exhale) +
              "s ease-in-out",
          }}
        >
          <span class="display font-bold" style=${{ fontSize: 40 }}
            >${state.left || ""}</span
          >
        </span>
      </span>
      <span
        class="display font-bold"
        style=${{ fontSize: 22 }}
        aria-live="polite"
        >${{
          ready: "Hand on your belly",
          in: "Breathe in…",
          out: "Out on “sss”…",
          done: "Nice and low!",
        }[state.phase]}</span
      >
    </section>
    ${state.phase === "ready" &&
    html`<button
      class="btn btn-primary"
      style=${{ justifyContent: "center", minHeight: 48, fontSize: 16 }}
      onClick=${() => run(0, "in")}
    >
      Start
    </button>`}
    ${state.phase === "done" &&
    html`<button
      class="btn btn-primary"
      style=${{ justifyContent: "center", minHeight: 48, fontSize: 16 }}
      onClick=${() =>
        onDone({
          score: 100,
          pass: true,
          stats: [],
          tip: spec.tip,
          simple: true,
        })}
    >
      Done
    </button>`}
  </div>`;
}

export function Exercise({ spec, range, mic, onDone }) {
  const P = { spec, range, mic, onDone };
  if (spec.type === "hold") return html`<${HoldEx} ...${P} />`;
  if (spec.type === "hiss") return html`<${HissEx} ...${P} />`;
  if (spec.type === "siren") return html`<${SirenEx} ...${P} />`;
  if (spec.type === "pattern") return html`<${PatternEx} ...${P} />`;
  if (spec.type === "check") return html`<${CheckEx} ...${P} />`;
  if (spec.type === "breath") return html`<${BreathEx} ...${P} />`;
  return null;
}

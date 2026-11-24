// Tuner > Match a note: hear a note, sing it back.
import React, { useEffect, useState, useRef } from "react";
import { Dial } from "../../components/Dial.jsx";
import { Icon } from "../../components/Icon.jsx";
import { Keyboard } from "../../components/Keyboard.jsx";
import { Sheet } from "../../components/Sheet.jsx";
import { playPiano, playChime } from "../../lib/audio.js";
import { signed, pretty, midiInfo } from "../../lib/music.js";
import { loadJSON, saveJSON, MATCH_KEY } from "../../lib/storage.js";
import { RangeFinder } from "./RangeFinder.jsx";

const RANGES = {
  low: [40, 60, "Low"],
  mid: [48, 67, "Medium"],
  high: [55, 76, "High"],
};

const TOLS = { easy: 50, normal: 25, hard: 10 };

const PIANO_QUIET = 2400; // ms the mic waits while the piano note rings out

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
      later(() => setPhase((p) => (p === "listen" ? "sing" : p)), PIANO_QUIET);
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
  if (target == null) hint = "Pick a note on the keyboard, or tap Random note.";
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
  const startBtn = (
    <button
      className="btn btn-primary"
      style={{
        minHeight: 52,
        fontSize: 16,
        padding: "0 22px",
        justifyContent: "center",
      }}
      onClick={onStartMic}
    >
      <span className="flex items-center gap-2">
        <Icon name="mic" size={20} />
        Tap to start listening
      </span>
    </button>
  );
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

  return (
    <div className="tuner-screen">
      <div className="flex items-center gap-2">
        <div
          className="mode-seg"
          role="group"
          aria-label="Tuner mode"
          style={{ flex: 1, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}
        >
          <button
            aria-pressed={tmode === "free" ? "true" : "false"}
            onClick={() => switchMode("free")}
          >
            Free
          </button>
          <button
            aria-pressed={tmode === "match" ? "true" : "false"}
            onClick={() => switchMode("match")}
          >
            Match a note
          </button>
          <button
            aria-pressed={tmode === "range" ? "true" : "false"}
            onClick={() => switchMode("range")}
          >
            My range
          </button>
        </div>
      </div>
      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      {tmode === "range" ? (
        <RangeFinder
          feedRef={rangeFeed}
          listening={listening}
          onStartMic={onStartMic}
          onStopMic={onStopMic}
        />
      ) : tmode === "free" ? (
        <React.Fragment>
          <section className="tuner-card" style={{ flex: 1 }}>
            <Dial
              cents={live ? live.cents : null}
              tol={10}
              tone={freeTone}
              lowLabel="−50¢"
              highLabel="+50¢"
            />
            {listening ? (
              <div className="flex flex-col items-center gap-1">
                <span className="flex items-start gap-1">
                  <span
                    className="display font-bold"
                    style={{
                      fontSize: 88,
                      lineHeight: 0.9,
                      color: lInfo ? "var(--" + freeTone + ")" : "var(--muted)",
                    }}
                  >
                    {lInfo ? lInfo.letter + (lInfo.sharp ? "♯" : "") : "—"}
                  </span>
                  {lInfo && (
                    <span
                      className="mono font-semibold"
                      style={{ fontSize: 30, marginTop: 44 }}
                    >
                      {lInfo.octave}
                    </span>
                  )}
                </span>
                <span className="mono text-sm muted">
                  {live
                    ? live.freq.toFixed(1) + " Hz · " + signed(live.cents) + "¢"
                    : "Sing or play a note"}
                </span>
                {live && (
                  <span
                    className={"tag tag-" + freeTone}
                    style={{ fontSize: 13, padding: "4px 12px" }}
                  >
                    {Math.abs(live.cents) <= 10
                      ? "In tune"
                      : live.cents > 0
                        ? "A little sharp"
                        : "A little flat"}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-2">
                {startBtn}
                <span className="text-xs muted">
                  {
                    "See which note you're singing, and how close you\n                      are."
                  }
                </span>
              </div>
            )}
          </section>
          {listening && (
            <div className="listen-bar">
              <span className="flex items-center gap-2 text-sm">
                <span className="rec-dot" />
                Listening
              </span>
              <span className="level" style={{ flex: 1, height: 5 }}>
                <div style={{ width: level * 100 + "%" }} />
              </span>
              <button
                className="btn"
                style={{ padding: "6px 12px", fontSize: 13 }}
                onClick={onStopMic}
              >
                Stop
              </button>
            </div>
          )}
        </React.Fragment>
      ) : (
        <React.Fragment>
          <div className="flex flex-wrap gap-2">
            <span className="chip">
              <span className="muted text-xs">Streak</span>
              <b className="mono">{streak}</b>
            </span>
            <span className="chip">
              <span className="muted text-xs">Last</span>
              <b className="mono">
                {lastTime == null ? "—" : lastTime.toFixed(1) + " s"}
              </b>
            </span>
            <span className="chip">
              <span className="muted text-xs">Best</span>
              <b className="mono">
                {stats.best == null ? "—" : stats.best.toFixed(1) + " s"}
              </b>
            </span>
          </div>
          <section className={"tuner-card" + (phase === "hit" ? " hit" : "")}>
            <Dial
              cents={
                target != null && listening && phase !== "listen"
                  ? phase === "hit"
                    ? 0
                    : cents
                  : null
              }
              tol={tol}
              tone={
                phase === "hit" || (cents != null && Math.abs(cents) <= tol)
                  ? "good"
                  : "warn"
              }
              lowLabel="too low"
              highLabel="too high"
              zoneSoft={true}
            />
            <div
              className="flex items-center justify-center gap-5"
              style={{ minHeight: 112 }}
            >
              <span
                style={{
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
                  aria-label={
                    "Hold progress " +
                    Math.round((phase === "hit" ? 1 : hold) * 100) +
                    " percent"
                  }
                >
                  <circle
                    cx="56"
                    cy="56"
                    r="50"
                    fill={
                      phase === "hit"
                        ? "color-mix(in srgb, var(--good) 18%, transparent)"
                        : "none"
                    }
                    stroke="var(--line)"
                    strokeWidth="6"
                  />
                  <circle
                    cx="56"
                    cy="56"
                    r="50"
                    fill="none"
                    stroke="var(--good)"
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray={
                      (ringC * (phase === "hit" ? 1 : hold)).toFixed(1) +
                      " " +
                      ringC.toFixed(1)
                    }
                    transform="rotate(-90 56 56)"
                  />
                </svg>
                <span
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <span className="label" style={{ fontSize: 10 }}>
                    Target
                  </span>
                  <span
                    className="display font-bold"
                    style={{
                      fontSize: 38,
                      lineHeight: 1,
                      color:
                        phase === "hit"
                          ? "var(--good)"
                          : tInfo
                            ? "var(--fg)"
                            : "var(--muted)",
                    }}
                  >
                    {tInfo ? pretty(tInfo.label) : "—"}
                  </span>
                </span>
              </span>
              <span className="flex flex-col gap-1 min-w-0">
                {listening && target != null && phase !== "listen" && (
                  <>
                    <span className="text-xs muted">You're singing</span>
                    <span
                      className="display font-bold"
                      style={{ fontSize: 24, color: "var(--you)" }}
                    >
                      {sungInfo ? pretty(sungInfo.label) : "—"}
                    </span>
                  </>
                )}
                <span
                  className="display font-bold"
                  style={{
                    fontSize: 21,
                    lineHeight: 1.2,
                    color: "var(--" + tone + ")",
                  }}
                  aria-live="polite"
                >
                  {hint}
                </span>
              </span>
            </div>
            {!listening && target != null && (
              <div className="flex justify-center">{startBtn}</div>
            )}
          </section>
          <div className="tuner-actions">
            <button
              className="btn btn-primary"
              style={{ justifyContent: "center", minHeight: 44 }}
              onClick={random}
            >
              Random
            </button>
            <button
              className="btn"
              style={{ justifyContent: "center", minHeight: 44 }}
              onClick={replay}
              disabled={target == null}
            >
              Play again
            </button>
            <button
              className={"btn" + (listening ? "" : "")}
              style={{ justifyContent: "center", minHeight: 44 }}
              onClick={listening ? onStopMic : onStartMic}
              aria-label={listening ? "Stop listening" : "Start listening"}
            >
              <span className="flex items-center gap-2">
                {listening ? (
                  <>
                    <span className="rec-dot" />
                    On
                  </>
                ) : (
                  <>
                    <Icon name="mic" size={18} />
                    Off
                  </>
                )}
              </span>
            </button>
            <button
              className="icon-btn"
              onClick={() => setOptOpen(true)}
              aria-label="Tuner options"
            >
              <Icon name="sliders" />
            </button>
          </div>
          <section
            className="flex flex-col gap-2"
            style={{ marginTop: "auto" }}
            aria-label="Piano keyboard"
          >
            <div className="flex items-center justify-between">
              <button
                className="icon-btn"
                style={{ height: 36 }}
                onClick={() => setBaseOct((b) => Math.max(2, b - 1))}
                disabled={baseOct <= 2}
                aria-label="Lower octave"
              >
                <Icon name="back" size={18} />
              </button>
              <span className="mono text-xs muted">
                C{baseOct} – C{baseOct + 1}
              </span>
              <button
                className="icon-btn"
                style={{ height: 36, transform: "scaleX(-1)" }}
                onClick={() => setBaseOct((b) => Math.min(5, b + 1))}
                disabled={baseOct >= 5}
                aria-label="Higher octave"
              >
                <Icon name="back" size={18} />
              </button>
            </div>
            <Keyboard
              baseOct={baseOct}
              target={target}
              matched={phase === "hit"}
              sung={sung}
              onKey={choose}
            />
          </section>
        </React.Fragment>
      )}
      <Sheet
        open={optOpen}
        title="Tuner options"
        onClose={() => setOptOpen(false)}
      >
        <div className="opt-group">
          <span className="label">How close counts</span>
          <div className="seg" role="group" aria-label="Difficulty">
            {[
              ["easy", "Easy"],
              ["normal", "Normal"],
              ["hard", "Hard"],
            ].map(([k, l]) => (
              <button
                key={k}
                aria-pressed={diff === k ? "true" : "false"}
                onClick={() => {
                  setDiff(k);
                  save("diff", k);
                }}
              >
                {l}
              </button>
            ))}
          </div>
          <p className="text-xs muted">
            {diff === "easy"
              ? "Easy: within half a piano key."
              : diff === "normal"
                ? "Normal: within a quarter of a piano key."
                : "Hard: within a tenth of a piano key."}
            Hold it for half a second to count.
          </p>
        </div>
        <div className="opt-group">
          <span className="label">Random notes from</span>
          <div
            className="seg"
            role="group"
            aria-label="Voice range for random notes"
          >
            {Object.entries(RANGES).map(([k, v]) => (
              <button
                key={k}
                aria-pressed={range === k ? "true" : "false"}
                onClick={() => {
                  setRange(k);
                  save("range", k);
                }}
              >
                {v[2]} voice
              </button>
            ))}
          </div>
        </div>
        <div className="opt-group">
          <button
            className="switch"
            role="switch"
            aria-checked={anyOct ? "true" : "false"}
            onClick={() => {
              setAnyOct(!anyOct);
              save("anyoct", !anyOct);
            }}
            style={{ fontSize: 14, alignSelf: "flex-start" }}
          >
            <span className="track">
              <span className="knob" />
            </span>
            {"Any octave\n          counts"}
          </button>
          <button
            className="switch"
            role="switch"
            aria-checked={autoNext ? "true" : "false"}
            onClick={() => {
              setAutoNext(!autoNext);
              save("auto", !autoNext);
            }}
            style={{ fontSize: 14, alignSelf: "flex-start" }}
          >
            <span className="track">
              <span className="knob" />
            </span>
            Auto next note
          </button>
          <p className="text-xs muted">
            Total hits: {stats.hits}
            {
              ". The app ignores the mic while the piano\n          note rings, so it never hears itself."
            }
          </p>
        </div>
      </Sheet>
    </div>
  );
}

// semicircle tuner dial: needle at -50..+50 cents, green zone of +/- tol
/* ---------- app-wide settings ---------- */

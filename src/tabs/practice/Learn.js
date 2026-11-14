import React from "react";
import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Icon } from "../../components/Icon.js";
import { MelodyMap } from "../../components/MelodyMap.js";
import { Sheet } from "../../components/Sheet.js";
import { TryPanel } from "../../components/TryPanel.js";
import { UploadSlot } from "../../components/UploadSlot.js";
import { html } from "../../html.js";
import { trackPitch, scheduleGuide } from "../../lib/analysis.js";
import { lyricSpans } from "../../lib/lyrics.js";
import { median } from "../../lib/math.js";
import { fmt, midiInfo, signed, pretty } from "../../lib/music.js";
import { buildPhrases, keyName, KEY_MAJ, KEY_MIN, estimateKey, SOLFEGE, scorePhrase } from "../../lib/phrases.js";
import { detectPitch } from "../../lib/pitch.js";
import { savePlan, makePlan, loadPlan } from "../../lib/plan.js";
import { SETTINGS, micGate, getMicStream } from "../../lib/settings.js";
import { loadJSON, saveJSON, MATCH_KEY } from "../../lib/storage.js";
import { loadTries, saveTries } from "../../lib/tries.js";
import { pianoKeys, howMuch } from "../../lib/wording.js";
import { PlanCard, PlanFlow } from "./Plan.js";
import { SongSheet } from "./SongSheet.js";
import { SongFit } from "../tuner/tuner.js";

const BEST_KEY = "pitchstaff.phrasebest.v1";

const LEARNED_KEY = "pitchstaff.learned.v1";

export function Learn({
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

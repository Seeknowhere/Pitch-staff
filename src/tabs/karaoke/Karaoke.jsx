// The Karaoke tab.
import React, { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { Icon } from "../../components/Icon.jsx";
import { MelodyMap } from "../../components/MelodyMap.jsx";
import { Sheet } from "../../components/Sheet.jsx";
import { Stars } from "../../components/Stars.jsx";
import { UploadSlot } from "../../components/UploadSlot.jsx";
import { html } from "../../html.js";
import { GRID, foldOct, scheduleGuide } from "../../lib/analysis.js";
import { saveBlob, encodeWav, peakOf, makeImpulse } from "../../lib/audio.js";
import { lyricSpans } from "../../lib/lyrics.js";
import { median } from "../../lib/math.js";
import { fmt, midiInfo, pretty } from "../../lib/music.js";
import { buildPhrases } from "../../lib/phrases.js";
import { detectPitch } from "../../lib/pitch.js";
import { SETTINGS, micGate, getMicStream } from "../../lib/settings.js";
import { loadJSON, saveJSON } from "../../lib/storage.js";
import { KaraokeLine } from "./KaraokeLine.jsx";

const KARA_BEST_KEY = "pitchstaff.karabest.v1";

const karaStars = (sc) =>
  sc >= 90 ? 5 : sc >= 75 ? 4 : sc >= 60 ? 3 : sc >= 40 ? 2 : 1;

const KARA_RANKS = [
  "Warming up",
  "Getting there",
  "Rising star",
  "Showstopper",
  "Superstar",
];

const CONFETTI = Array.from({ length: 36 }, (_, i) => ({
  l: (i * 37) % 100,
  d: ((i * 53) % 90) / 100,
  c: ["#f3d18c", "#8b5cf6", "#8fbcff", "#5fd39a", "#ff7a9c"][i % 5],
  r: (i * 29) % 360,
  w: i % 3 ? 7 : 9,
  h: i % 2 ? 12 : 8,
}));

export function Karaoke({
  themeKey,
  active,
  orig,
  onPickOrig,
  lyrics,
  updateLyrics,
  onSendTake,
  onTakeReady,
  onPractice,
  inst,
  onPickInst,
  sync,
  syncMsg,
  keyWarn,
  onSync,
  onAutoSync,
}) {
  const data = orig && orig.data ? orig.data : null;
  const notes = data ? data.notes : [];
  const songName = data ? orig.name : null;
  const [hp, setHp] = useState("unknown"); // unknown | checking | ok | heard | override | nomic
  const [mix, setMix] = useState(() =>
    loadJSON("pitchstaff.karamix.v1", { m: 0.9, v: 0.25, g: 0 }),
  );
  const [playing, setPlaying] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [overlay, setOverlay] = useState(null);
  const [marks, setMarks] = useState([]);
  const [lineScores, setLineScores] = useState({});
  const [final, setFinal] = useState(null);
  const [takeBuf, setTakeBuf] = useState(null);
  const [hearing, setHearing] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const tape = useRef({ on: false, sr: 24000, chunks: [] });
  const [withMusic, setWithMusic] = useState(true);
  const [optOpen, setOptOpen] = useState(false);
  const [hpAsk, setHpAsk] = useState(false);
  const [showMix, setShowMix] = useState(false);
  const [pl, setPl] = useState({ on: false, pos: 0 });
  const player = useRef({ nodes: [], g: null, raf: 0 });
  const [mixVol, setMixVol] = useState(() =>
    loadJSON("pitchstaff.karaout.v1", { v: 1, m: 0.75, verb: true }),
  );
  const [lat, setLat] = useState(0);
  const [nudgeV, setNudgeV] = useState(0);
  const [mixBusy, setMixBusy] = useState("");
  const [mixMsg, setMixMsg] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const prev = useRef(null);
  const [loop, setLoop] = useState(null);
  const [best, setBest] = useState(null);
  const [combo, setCombo] = useState(0);
  const [pop, setPop] = useState(null);
  const [count, setCount] = useState(null);
  const countTimers = useRef([]);
  const ringRef = useRef(null);
  const mixRef = useRef(mix),
    syncRef = useRef(0),
    loopRef = useRef(null),
    hpRef = useRef("unknown");
  const play = useRef({ ctx: null, srcs: [], guide: [], buses: [], raf: 0 });
  const mic = useRef({});
  const run = useRef({
    her: null,
    lastK: -1,
    points: [],
    judgedNotes: new Set(),
    judgedLines: new Set(),
    tally: {},
    combo: 0,
    bestCombo: 0,
    perfect: 0,
  });
  const fileRef = useRef(null);
  syncRef.current = sync;

  const spans = useMemo(
    () => (data ? lyricSpans(lyrics, data.duration) : []),
    [lyrics, data],
  );
  const phrases = useMemo(
    () => buildPhrases(notes, spans, data && data.grid),
    [notes, spans, data],
  );
  const lines = useMemo(
    () =>
      spans.length
        ? spans
        : phrases.map((p) => ({
            start: p.start,
            end: p.end,
            text: "",
            phrase: p.i,
          })),
    [spans, phrases],
  );
  const songEnd = data
    ? Math.max(
        data.duration,
        inst && inst.buffer ? inst.buffer.duration - sync : 0,
      )
    : 0;
  const listening = hp === "ok" || hp === "override";
  const isListening = () =>
    hpRef.current === "ok" || hpRef.current === "override";

  const ensureCtx = () => {
    const p = play.current;
    if (!p.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      p.ctx = new Ctx();
    }
    if (p.ctx.state === "suspended") p.ctx.resume().catch(() => {});
    return p.ctx;
  };
  const killSources = () => {
    const p = play.current;
    tape.current.on = false;
    tape.current.pos = null;
    p.songAt = null;
    cancelAnimationFrame(p.raf);
    if (ringRef.current) ringRef.current.style.setProperty("--lv", "0");
    if (p.hear) {
      try {
        p.hear.stop();
      } catch (e) {}
      p.hear = null;
      setHearing(false);
    }
    stopPlayerNodes();
    [...p.srcs, ...p.guide].forEach((s) => {
      try {
        s.stop();
      } catch (e) {}
    });
    p.buses.forEach((g) => {
      try {
        g.disconnect();
      } catch (e) {}
    });
    p.srcs = [];
    p.guide = [];
    p.buses = [];
  };
  const stopAll = useCallback(() => {
    killSources();
    setPlaying(false);
  }, []);
  const closeMic = useCallback(() => {
    const m = mic.current;
    if (m.stream) m.stream.getTracks().forEach((t) => t.stop());
    if (m.proc) m.proc.onaudioprocess = null;
    [m.src, m.an, m.proc, m.sink].forEach((n) => {
      if (n) {
        try {
          n.disconnect();
        } catch (e) {}
      }
    });
    mic.current = {};
  }, []);
  const ensureMic = async () => {
    if (mic.current.an) return true;
    try {
      const ctx = ensureCtx();
      const stream = await getMicStream();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 2048;
      src.connect(an);
      // record your voice onto a "tape" laid out in song time, so pauses and loops stay lined up
      const proc = ctx.createScriptProcessor(4096, 1, 1),
        sink = ctx.createGain();
      sink.gain.value = 0;
      src.connect(proc);
      proc.connect(sink);
      sink.connect(ctx.destination);
      proc.onaudioprocess = (e) => {
        const T = tape.current,
          p = play.current;
        if (!T.on || !p.songAt) return;
        const inp = e.inputBuffer.getChannelData(0),
          sr = e.inputBuffer.sampleRate;
        const half = sr >= 44100;
        const out = new Float32Array(half ? inp.length >> 1 : inp.length);
        if (half)
          for (let i = 0; i < out.length; i++)
            out[i] = (inp[2 * i] + inp[2 * i + 1]) / 2;
        else out.set(inp);
        T.sr = half ? sr / 2 : sr;
        // place the first block by song time, then lay the rest end to end so there are no gaps or overlaps (which click)
        const expected = Math.round((p.songAt() - inp.length / sr) * T.sr);
        let fade = false;
        if (T.pos == null) {
          T.pos = Math.max(0, expected);
          T.lag = [];
          fade = true;
        } else {
          // callbacks only ever run late, so the smallest gap over the last few blocks is the real drift;
          // if audio was dropped (common on iPhone), re-line up with the song clock
          T.lag.push(expected - T.pos);
          if (T.lag.length > 12) T.lag.shift();
          const drift = T.lag.length >= 8 ? Math.min(...T.lag) : 0;
          if (Math.abs(drift) > T.sr * 0.03) {
            T.pos = Math.max(0, T.pos + drift);
            T.lag = [];
            fade = true;
          }
        }
        if (fade) {
          const f = Math.min(240, out.length);
          for (let i = 0; i < f; i++) out[i] *= i / f;
        }
        T.chunks.push({ i: T.pos, d: out });
        T.pos += out.length;
      };
      mic.current = { stream, src, an, proc, sink };
      return true;
    } catch (e) {
      closeMic();
      return false;
    }
  };
  const cancelCount = () => {
    countTimers.current.forEach(clearTimeout);
    countTimers.current = [];
    setCount(null);
  };
  useEffect(() => {
    if (!active) {
      stopAll();
      closeMic();
      cancelCount();
    }
  }, [active, stopAll, closeMic]);
  useEffect(() => () => countTimers.current.forEach(clearTimeout), []);
  useEffect(
    () => () => {
      killSources();
      closeMic();
      if (play.current.ctx) play.current.ctx.close().catch(() => {});
    },
    [],
  );

  // new song: reset the session and bring back saved timing/best score
  useEffect(() => {
    stopAll();
    setCursor(0);
    setOverlay(null);
    setMarks([]);
    setLineScores({});
    setFinal(null);
    loopRef.current = null;
    setLoop(null);
    setBest(
      songName ? (loadJSON(KARA_BEST_KEY, {})[songName] ?? null) : null,
    );
  }, [data, songName, stopAll]);

  const saveSync = (v) => {
    syncRef.current = v;
    onSync(v);
  };
  const runAutoSync = () => onAutoSync();
  const pickInst = (file) => {
    stopAll();
    onPickInst(file);
  };

  const runCheck = async () => {
    stopAll();
    setHp("checking");
    hpRef.current = "checking";
    const ok = await ensureMic();
    if (!ok) {
      setHp("nomic");
      hpRef.current = "nomic";
      return "nomic";
    }
    const ctx = ensureCtx(),
      an = mic.current.an,
      buf = new Float32Array(an.fftSize);
    const f = SETTINGS.a4 * 2,
      t0 = ctx.currentTime + 0.05;
    [0, 0.45, 0.9].forEach((d) => {
      const o = ctx.createOscillator(),
        g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + d);
      g.gain.exponentialRampToValueAtTime(0.3, t0 + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.35);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(t0 + d);
      o.stop(t0 + d + 0.4);
    });
    let hits = 0;
    await new Promise((res) => {
      const loopFn = () => {
        if (ctx.currentTime - t0 > 1.45) {
          res();
          return;
        }
        an.getFloatTimeDomainData(buf);
        const d = detectPitch(buf, ctx.sampleRate, micGate());
        if (d.freq > 0 && Math.abs(12 * Math.log2(d.freq / f)) < 0.5) hits++;
        requestAnimationFrame(loopFn);
      };
      loopFn();
    });
    const st = hits >= 3 ? "heard" : "ok";
    setHp(st);
    hpRef.current = st;
    return st;
  };

  // ---- scoring as you sing ----
  const SLACK0 = 5,
    SLACK1 = 20; // look 0.1 s early to 0.4 s late (headphone delay)
  const matchAt = (k) => {
    const a = data.grid[k],
      her = run.current.her;
    if (a !== a || !her) return false;
    for (
      let j = Math.max(0, k - SLACK0);
      j <= Math.min(her.length - 1, k + SLACK1);
      j++
    ) {
      const h = her[j];
      if (h === h && Math.abs(foldOct(h - a)) <= 0.5) return true;
    }
    return false;
  };
  const judge = (songT) => {
    const R = run.current;
    const newMarks = [];
    notes.forEach((n, i) => {
      if (R.judgedNotes.has(i) || n.end + 0.45 > songT) return;
      if (
        loopRef.current &&
        (n.pos < loopRef.current.a - 0.3 || n.end > loopRef.current.b + 0.3)
      )
        return;
      R.judgedNotes.add(i);
      const k0 = Math.round(n.pos / GRID),
        k1 = Math.max(k0 + 1, Math.round(n.end / GRID));
      const cut = Math.floor((k1 - k0) * 0.2);
      let v = 0,
        ok = 0;
      for (let k = k0 + cut; k < k1 - cut; k++) {
        if (data.grid[k] !== data.grid[k]) continue;
        v++;
        if (matchAt(k)) ok++;
      }
      if (v)
        newMarks.push({
          i,
          pos: n.pos,
          end: n.end,
          midi: n.midi,
          ok: ok / v >= 0.5,
          q: ok / v,
        });
    });
    if (newMarks.length) {
      newMarks.sort((x, y) => x.pos - y.pos);
      let last = null;
      newMarks.forEach((mk) => {
        if (mk.ok) {
          R.combo++;
          if (mk.q >= 0.85) R.perfect++;
          R.bestCombo = Math.max(R.bestCombo, R.combo);
          last = mk;
        } else R.combo = 0;
      });
      setCombo(R.combo);
      // combo pop-ups only at big milestones (25, 50, 75…), crossed in this batch
      const mile = Math.floor(R.combo / 25) * 25;
      if (last && mile >= 25 && mile > (R.lastMile || 0)) {
        R.lastMile = mile;
        R.milePop = true;
        setPop({
          id: Date.now() + Math.random(),
          kind: "perfect",
          text: "×" + mile + " combo!",
        });
      }
      if (R.combo < 25) R.lastMile = 0;
    }
    if (newMarks.length)
      setMarks((m) => [
        ...m.filter((x) => !newMarks.some((y) => y.i === x.i)),
        ...newMarks,
      ]);
    const upd = {};
    lines.forEach((l, i) => {
      if (R.judgedLines.has(i) || l.end + 0.45 > songT) return;
      if (
        loopRef.current &&
        (l.start < loopRef.current.a - 0.3 || l.end > loopRef.current.b + 0.3)
      )
        return;
      R.judgedLines.add(i);
      let v = 0,
        ok = 0;
      for (
        let k = Math.round(l.start / GRID);
        k < Math.round(l.end / GRID);
        k++
      ) {
        if (data.grid[k] !== data.grid[k]) continue;
        v++;
        if (matchAt(k)) ok++;
      }
      if (v >= 10) {
        R.tally[i] = { v, ok };
        upd[i] = Math.round((100 * ok) / v);
      }
    });
    // at most one reaction per lyric line, when it ends, and only for a strong line
    const ended = Object.keys(upd).map(Number);
    if (ended.length && !R.milePop) {
      const sc = upd[ended[ended.length - 1]];
      if (sc >= 75)
        setPop({
          id: Date.now() + Math.random(),
          kind: sc >= 90 ? "perfect" : "great",
          text: sc >= 90 ? "Perfect!" : "Great!",
        });
    }
    R.milePop = false;
    if (Object.keys(upd).length) setLineScores((s) => ({ ...s, ...upd }));
  };
  const buildTake = () => {
    const T = tape.current;
    if (!T.chunks.length) return null;
    const len = T.chunks.reduce((m, c) => Math.max(m, c.i + c.d.length), 0);
    if (len < T.sr * 1) return null;
    let ab;
    try {
      ab = new AudioBuffer({
        length: len,
        sampleRate: T.sr,
        numberOfChannels: 1,
      });
    } catch (e) {
      ab = ensureCtx().createBuffer(1, len, T.sr);
    }
    const ch = ab.getChannelData(0);
    T.chunks.forEach((c) => ch.set(c.d, c.i));
    return ab;
  };
  const finish = () => {
    const R = run.current;
    const t = Object.values(R.tally);
    const v = t.reduce((s, x) => s + x.v, 0),
      ok = t.reduce((s, x) => s + x.ok, 0);
    const tb = buildTake();
    if (tb && onTakeReady)
      onTakeReady({
        id: Date.now(),
        name:
          "Karaoke take · " +
          new Date().toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          }),
        buffer: tb,
      });
    setTakeBuf(tb);
    setSaveMsg("");
    setMixMsg("");
    setNudgeV(0);
    setPl({ on: false, pos: 0 });
    setLat(tb ? estimateLatency() : 0);
    const reached = Math.max(
      0,
      Math.min(songEnd, play.current.lastSongT || cursor || 0),
    );
    const lis = isListening();
    if (!lis || v < 50) {
      setFinal({ score: null, lines: 0, scoring: lis, reached });
      return;
    }
    const score = Math.round((100 * ok) / v);
    setFinal({
      score,
      lines: Object.keys(R.tally).length,
      scoring: true,
      reached,
      bestCombo: R.bestCombo,
      perfect: R.perfect,
      prevBest: best,
    });
    if (songName) {
      const all = loadJSON(KARA_BEST_KEY, {});
      if (!(all[songName] >= score)) {
        all[songName] = score;
        saveJSON(KARA_BEST_KEY, all);
        setBest(score);
      }
    }
  };

  const startAt = async (t, fresh, check) => {
    if (!data) return;
    killSources();
    const ctx = ensureCtx();
    const lis = isListening();
    if (lis) await ensureMic();
    const p = play.current,
      mx = mixRef.current,
      sy = syncRef.current,
      lp = loopRef.current;
    const end = lp ? lp.b : songEnd;
    if (lp && (t < lp.a - 1 || t >= lp.b)) t = Math.max(0, lp.a - 0.6);
    if (t >= end - 0.1) t = lp ? Math.max(0, lp.a - 0.6) : 0;
    if (fresh || t < 0.05) {
      run.current = {
        her: new Float32Array(Math.ceil(songEnd / GRID) + 30).fill(NaN),
        lastK: -1,
        points: [],
        judgedNotes: new Set(),
        judgedLines: new Set(),
        tally: {},
        combo: 0,
        bestCombo: 0,
        perfect: 0,
      };
      setCombo(0);
      setPop(null);
      tape.current = { on: false, sr: 24000, chunks: [], pos: null };
      play.current.lastSongT = 0;
      setMarks([]);
      setLineScores({});
      setFinal(null);
      setOverlay(null);
      setTakeBuf(null);
    } else if (!run.current.her) {
      run.current.her = new Float32Array(Math.ceil(songEnd / GRID) + 30).fill(
        NaN,
      );
    }
    if (lp) {
      // forget earlier scores inside the loop so each pass is judged fresh
      const R = run.current;
      notes.forEach((n, i) => {
        if (n.pos >= lp.a - 0.3 && n.end <= lp.b + 0.3)
          R.judgedNotes.delete(i);
      });
      lines.forEach((l, i) => {
        if (l.start >= lp.a - 0.3 && l.end <= lp.b + 0.3) {
          R.judgedLines.delete(i);
          delete R.tally[i];
        }
      });
      for (
        let k = Math.max(0, Math.round(lp.a / GRID) - 30);
        k < Math.min(R.her.length, Math.round(lp.b / GRID) + 30);
        k++
      )
        R.her[k] = NaN;
    }
    const now = ctx.currentTime + 0.08;
    const bus = (v) => {
      const g = ctx.createGain();
      g.gain.value = v;
      g.connect(ctx.destination);
      p.buses.push(g);
      return g;
    };
    p.gM = bus(check ? Math.max(0.7, mx.m) : mx.m);
    p.gV = bus(check ? 1 : mx.v);
    p.gG = bus(check ? 0 : mx.g);
    if (check) {
      p.gV.gain.setValueAtTime(1, now + 8);
      p.gV.gain.linearRampToValueAtTime(mx.v, now + 9);
      p.gG.gain.setValueAtTime(mx.g, now + 9);
    }
    const start = (buf, at, dest) => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.connect(dest);
      if (at >= 0) s.start(now, at);
      else s.start(now - at, 0);
      p.srcs.push(s);
    };
    if (inst && inst.buffer) start(inst.buffer, t + sy, p.gM);
    start(orig.buffer, t, p.gV);
    p.guide = scheduleGuide(ctx, p.gG, notes, t, end, now, 0, 1);
    p.songAt = () => t + Math.max(0, ctx.currentTime - now);
    tape.current.pos = null;
    tape.current.on = !!(lis && mic.current.an && !check);
    setPlaying(true);
    const an = lis ? mic.current.an : null,
      buf = an ? new Float32Array(an.fftSize) : null;
    let frame = 0;
    const tick = () => {
      const songT = t + Math.max(0, ctx.currentTime - now);
      if (an) {
        an.getFloatTimeDomainData(buf);
        const d = detectPitch(buf, ctx.sampleRate, micGate());
        const m =
          d.freq > 0 ? 69 + 12 * Math.log2(d.freq / SETTINGS.a4) : NaN;
        if (ringRef.current)
          ringRef.current.style.setProperty(
            "--lv",
            Math.min(1, (d.rms || 0) * 9).toFixed(2),
          );
        const R = run.current,
          k = Math.round(songT / GRID);
        if (k < R.her.length) {
          for (let q = Math.max(R.lastK + 1, k - 4); q <= k; q++)
            R.her[q] = m;
          R.lastK = k;
        }
        R.points.push({ t: songT, m });
        if (R.points.length > 2400)
          R.points.splice(0, R.points.length - 2400);
        if (++frame % 4 === 0) {
          const recent = R.points.slice(-600).filter((x) => x.m === x.m);
          const ks = recent
            .map((x) => {
              const kk = Math.round(x.t / GRID);
              return data.grid[kk] === data.grid[kk]
                ? x.m - data.grid[kk]
                : NaN;
            })
            .filter((x) => x === x);
          const oct = ks.length ? 12 * Math.round(median(ks) / 12) : 0;
          setOverlay({
            start: 0,
            speed: 1,
            oct,
            points: R.points.filter((x) => x.t > songT - 25),
          });
        }
        if (frame % 10 === 0) judge(songT);
      }
      setCursor(songT);
      p.lastSongT = songT;
      if (songT >= end) {
        if (an) judge(end + 1);
        if (loopRef.current) {
          startAt(Math.max(0, loopRef.current.a - 0.6), false);
          return;
        }
        killSources();
        setPlaying(false);
        finish();
        return;
      }
      p.raf = requestAnimationFrame(tick);
    };
    tick();
  };

  const setVol = (k, v) => {
    const next = { ...mixRef.current, [k]: v };
    mixRef.current = next;
    setMix(next);
    saveJSON("pitchstaff.karamix.v1", next);
    const p = play.current,
      node = { m: p.gM, v: p.gV, g: p.gG }[k];
    if (node && p.ctx) node.gain.setTargetAtTime(v, p.ctx.currentTime, 0.02);
  };
  const nudge = (d) => {
    const v = Math.round((syncRef.current + d) * 100) / 100;
    saveSync(v);
    if (playing) startAt(cursor, false);
  };
  const checkTiming = () => {
    const first = notes.length ? notes[0].pos : 0;
    loopRef.current = null;
    setLoop(null);
    startAt(Math.max(0, first - 1), false, true);
  };
  const loopLine = (l) => {
    const lp = { a: Math.max(0, l.start), b: l.end + 0.3 };
    loopRef.current = lp;
    setLoop(lp);
    startAt(Math.max(0, lp.a - 0.6), false);
  };
  const clearLoop = () => {
    loopRef.current = null;
    setLoop(null);
  };
  const stopSession = () => {
    if (isListening()) judge(cursor + 0.5);
    killSources();
    setPlaying(false);
    finish();
  };
  const takeName = () =>
    "Karaoke take · " +
    new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const saveTake = async () => {
    if (!takeBuf) return;
    const base =
      (songName || "song")
        .replace(/\.[^.]+$/, "")
        .replace(/[^\w\- ]+/g, "")
        .trim()
        .slice(0, 40) || "song";
    try {
      await saveBlob(encodeWav(takeBuf), base + " - my take.wav");
      setSaveMsg("Saved.");
    } catch (e) {
      setSaveMsg(
        e && e.code === "declined"
          ? "Save cancelled."
          : "Saving isn't available here.",
      );
    }
  };
  const sendToAnalyst = () => {
    if (takeBuf && onSendTake) {
      stopAll();
      onSendTake({ id: Date.now(), name: takeName(), buffer: takeBuf });
    }
  };

  // ---- karaoke track with music ----
  // headphones delay your voice a little; find that delay by matching what you sang to the original melody
  const estimateLatency = () => {
    const her = run.current.her,
      a = data.grid;
    if (!her) return 0;
    let best = 0,
      bestL = 0;
    for (let L = -3; L <= 25; L++) {
      let m = 0;
      for (let k = 0; k < a.length; k += 2) {
        const j = k + L;
        if (a[k] !== a[k] || j < 0 || j >= her.length || her[j] !== her[j])
          continue;
        if (Math.abs(foldOct(her[j] - a[k])) < 0.5) m++;
      }
      if (m > best * 1.03) {
        best = m;
        bestL = L;
      }
    }
    return best > 40 ? bestL * GRID : 0;
  };
  const setOut = (k, v) => {
    const next = { ...mixVol, [k]: v };
    setMixVol(next);
    saveJSON("pitchstaff.karaout.v1", next);
    const g = player.current.g,
      ctx = play.current.ctx;
    if (g && ctx) {
      if (k === "v" && g.vG)
        g.vG.gain.setTargetAtTime(v * g.norm, ctx.currentTime, 0.03);
      if (k === "m" && g.mG)
        g.mG.gain.setTargetAtTime(v, ctx.currentTime, 0.03);
      if (k === "verb" && g.wet)
        g.wet.gain.setTargetAtTime(v ? 0.22 : 0, ctx.currentTime, 0.03);
    }
  };
  const mixLength = () => takeBuf.duration + 2;
  // builds the mix into any audio context (live for the player, offline for the file); from = song time to start at
  const buildMix = (ctx, from, music, live) => {
    const nodes = [],
      g = {};
    const shift = music ? Math.max(-0.5, lat + nudgeV) : 0;
    const out = ctx.createDynamicsCompressor();
    out.threshold.value = -8;
    out.ratio.value = 4;
    out.attack.value = 0.005;
    out.release.value = 0.2;
    out.connect(ctx.destination);
    const when = ctx.currentTime + (live ? 0.05 : 0);
    if (music && inst && inst.buffer) {
      g.mG = ctx.createGain();
      g.mG.gain.value = mixVol.m;
      g.mG.connect(out);
      const mSrc = ctx.createBufferSource();
      mSrc.buffer = inst.buffer;
      mSrc.connect(g.mG);
      const mAt = from + syncRef.current;
      if (mAt >= 0) mSrc.start(when, mAt);
      else mSrc.start(when - mAt, 0);
      nodes.push(mSrc);
    }
    // voice: cleaned up, brought to a steady level, then a touch of echo
    const vSrc = ctx.createBufferSource();
    vSrc.buffer = takeBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 90;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -24;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.25;
    g.norm = Math.min(8, 0.5 / peakOf(takeBuf));
    g.vG = ctx.createGain();
    g.vG.gain.value = (music ? mixVol.v : 1) * g.norm;
    vSrc.connect(hp);
    hp.connect(comp);
    comp.connect(g.vG);
    g.vG.connect(out);
    if (music && (live || mixVol.verb)) {
      const conv = ctx.createConvolver();
      conv.buffer = makeImpulse(ctx);
      g.wet = ctx.createGain();
      g.wet.gain.value = mixVol.verb ? 0.22 : 0;
      g.vG.connect(conv);
      conv.connect(g.wet);
      g.wet.connect(out);
    }
    const vAt = from + shift;
    if (vAt >= 0) vSrc.start(when, vAt);
    else vSrc.start(when - vAt, 0);
    nodes.push(vSrc);
    return { nodes, g, when };
  };
  // ---- player for your take: play/pause, stop, drag to seek ----
  function stopPlayerNodes() {
    const P = player.current;
    cancelAnimationFrame(P.raf);
    P.nodes.forEach((n) => {
      try {
        n.stop();
      } catch (e) {}
    });
    P.nodes = [];
    P.g = null;
  }
  const plEnd = () => (takeBuf ? takeBuf.duration + 0.5 : 0);
  const playerStart = (from) => {
    if (!takeBuf) return;
    killSources();
    setPlaying(false);
    const ctx = ensureCtx();
    if (from >= plEnd() - 0.1) from = 0;
    const music = withMusic && !!(inst && inst.buffer);
    const { nodes, g, when } = buildMix(ctx, from, music, true);
    const P = player.current;
    P.nodes = nodes;
    P.g = g;
    setPl({ on: true, pos: from });
    const tick = () => {
      const pos = from + Math.max(0, ctx.currentTime - when);
      if (pos >= plEnd()) {
        stopPlayerNodes();
        setPl({ on: false, pos: 0 });
        return;
      }
      setPl({ on: true, pos });
      P.raf = requestAnimationFrame(tick);
    };
    tick();
  };
  const playerPause = () => {
    stopPlayerNodes();
    setPl((x) => ({ on: false, pos: x.pos }));
  };
  const playerStop = () => {
    stopPlayerNodes();
    setPl({ on: false, pos: 0 });
  };
  const playerSeek = (v) => {
    if (pl.on) playerStart(v);
    else setPl({ on: false, pos: v });
  };
  const plRef = useRef(pl);
  plRef.current = pl;
  // timing or mode changes: restart from where you are so you hear the change right away
  const restartTimer = useRef(0);
  useEffect(() => {
    if (!plRef.current.on) return;
    clearTimeout(restartTimer.current);
    restartTimer.current = setTimeout(() => {
      if (plRef.current.on) playerStart(plRef.current.pos);
    }, 120);
  }, [nudgeV, withMusic]);
  const downloadMix = async () => {
    if (!takeBuf || !inst || !inst.buffer) return;
    stopAll();
    setMixBusy("Mixing…");
    setMixMsg("");
    try {
      const sr = inst.buffer.sampleRate,
        len = Math.ceil(mixLength() * sr);
      const Off =
        window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const off = new Off(2, len, sr);
      buildMix(off, 0, true, false);
      const rendered = await new Promise((res, rej) => {
        off.oncomplete = (e) => res(e.renderedBuffer);
        const pr = off.startRendering();
        if (pr && pr.then) pr.then(res, rej);
      });
      setMixBusy("Saving…");
      const base =
        (songName || "song")
          .replace(/\.[^.]+$/, "")
          .replace(/[^\w\- ]+/g, "")
          .trim()
          .slice(0, 40) || "song";
      await saveBlob(encodeWav(rendered, 1), base + " - karaoke.wav");
      setMixMsg("Saved.");
    } catch (e) {
      setMixMsg(
        e && e.code === "declined"
          ? "Save cancelled."
          : e && e.code
            ? "Saving isn't available here."
            : "Couldn't build the mix on this device.",
      );
    }
    setMixBusy("");
  };

  if (!data) {
    return html`<div class="grid gap-4 sm:grid-cols-2">
      <${UploadSlot}
        id="kara-file"
        step="1"
        title="Song vocal (acapella)"
        hint="Upload the acapella of the song. It's shared with Practice and the Singing Analyst, so you only upload it once. Then add the instrumental."
        slot=${orig}
        onPick=${onPickOrig}
      />
      <div class="panel p-5 flex flex-col gap-2">
        <h3 class="display text-lg font-bold">How Karaoke works</h3>
        <p class="muted text-sm" style=${{ maxWidth: "62ch" }}>
          Add the song's acapella and its instrumental (karaoke version). The
          music plays with big scrolling lyrics while the app listens through
          your headphones, draws your voice over the melody and scores every
          line. At the end you get a final score and your weakest lines to
          practice.
        </p>
      </div>
    </div>`;
  }

  const curLineIdx = lines.findIndex(
    (l) => cursor >= l.start && cursor < l.end,
  );
  const nextIdx =
    curLineIdx >= 0
      ? curLineIdx + 1
      : lines.findIndex((l) => l.start > cursor);
  const prevIdx =
    curLineIdx >= 0 ? curLineIdx - 1 : nextIdx > 0 ? nextIdx - 1 : -1;
  const showLine = curLineIdx >= 0 ? lines[curLineIdx] : null;
  const curIdx = notes.findIndex((n) => cursor >= n.pos && cursor < n.end);
  const nameOf = (m) => pretty(midiInfo(m).label);
  const scored = Object.entries(lineScores)
    .map(([i, s]) => ({ i: +i, s }))
    .sort((a, b) => a.s - b.s);
  const lineLabel = (i) =>
    lines[i].text ? "“" + lines[i].text + "”" : "Phrase " + (i + 1);
  const small = { padding: "5px 10px", fontSize: 13 };
  const hpText = {
    unknown:
      "Run a quick check so the app knows the mic can't hear the music.",
    checking: "Playing three beeps and listening…",
    ok: "All good: the mic can't hear the music. Scoring is on.",
    heard:
      "The mic heard the test beeps, so it would hear the music too. Plug in headphones and check again.",
    override: "Scoring is on without headphones. Expect messy results.",
    nomic:
      "The microphone isn't available here, so you can sing along but without scoring. Use your GitHub Pages site or Chrome on your computer for scoring.",
    skip: "Singing without scoring. Check your headphones to turn scoring and recording on.",
  }[hp];

  const ready = !playing && cursor < 0.05;
  const firstLines = spans.slice(0, 2).map((l) => l.text);
  const liveScore = (() => {
    const v = Object.values(lineScores);
    return v.length
      ? Math.round(v.reduce((a, b) => a + b, 0) / v.length)
      : null;
  })();
  // 3-2-1 before a fresh start, so it feels like stepping on stage
  const countIn = (fn) => {
    cancelCount();
    ensureCtx();
    setCount(3);
    countTimers.current = [
      setTimeout(() => setCount(2), 700),
      setTimeout(() => setCount(1), 1400),
      setTimeout(() => {
        countTimers.current = [];
        setCount(null);
        fn();
      }, 2100),
    ];
  };
  const startPressed = (fresh) => {
    if (count != null) {
      cancelCount();
      return;
    }
    if (!playing && (fresh || cursor < 0.05) && hpRef.current === "unknown") {
      setHpAsk(true);
      return;
    }
    if (playing && !fresh) {
      stopAll();
      return;
    }
    const t = cursor >= songEnd - 0.2 ? 0 : cursor;
    if (fresh || t < 0.05) {
      if (playing) stopAll();
      countIn(() => startAt(0, true));
    } else startAt(t, false);
  };
  const checkThenSing = async () => {
    const st = await runCheck();
    if (st === "ok") {
      setHpAsk(false);
      countIn(() => startAt(0, true));
    }
  };
  const singWithout = () => {
    setHp("skip");
    hpRef.current = "skip";
    setHpAsk(false);
    countIn(() => startAt(0, true));
  };

  return html`<div class="flex flex-col gap-4">
    ${final
      ? html`<${React.Fragment}>
          <section class="flex flex-col gap-4">
            <div class="flex items-center justify-between gap-3">
              <button
                class="btn btn-ghost"
                style=${{ padding: "6px 10px" }}
                onClick=${() => {
                  playerStop();
                  setFinal(null);
                }}
              >
                <span class="flex items-center gap-1"
                  ><${Icon} name="back" size=${18} />Back to the song</span
                >
              </button>
              <button
                class="btn btn-primary"
                onClick=${() => {
                  playerStop();
                  clearLoop();
                  setCursor(0);
                  startPressed(true);
                }}
              >
                Sing again
              </button>
            </div>
            <div class="flex flex-wrap items-end justify-center gap-3">
              <div
                class="flex items-end gap-3"
                style=${{ width: final.score != null ? "100%" : undefined }}
              >
                ${final.score != null
                  ? html`<div class="kara-hero" style=${{ width: "100%" }}>
                      ${final.score >= 75 &&
                      html`<div class="confetti" aria-hidden="true">
                        ${CONFETTI.map(
                          (c, i) =>
                            html`<i
                              key=${i}
                              style=${{
                                left: c.l + "%",
                                background: c.c,
                                width: c.w,
                                height: c.h,
                                animationDelay: c.d + "s",
                                transform: "rotate(" + c.r + "deg)",
                              }}
                            ></i>`,
                        )}
                      </div>`}
                      <${Stars}
                        n=${karaStars(final.score)}
                        size=${36}
                        big=${true}
                      />
                      <span class="rank-title"
                        >${KARA_RANKS[karaStars(final.score) - 1]}</span
                      >
                      <span
                        class="display font-bold"
                        style=${{
                          fontSize: 64,
                          lineHeight: 1,
                          color: "#f3d18c",
                          textShadow: "0 0 28px rgba(226,182,92,.45)",
                        }}
                        >${final.score}<span style=${{ fontSize: 28 }}
                          >%</span
                        ></span
                      >
                      <span class="text-sm muted"
                        >${final.bestCombo
                          ? html`Best combo
                              <b style=${{ color: "#c4b5fd" }}
                                >×${final.bestCombo}</b
                              >
                              · `
                          : ""}${final.perfect || 0}
                        perfect note${final.perfect === 1 ? "" : "s"} ·
                        ${final.lines} lines</span
                      >
                      ${final.prevBest == null || final.score > final.prevBest
                        ? html`<span
                            class="tag tag-good"
                            style=${{ marginTop: 4 }}
                            >${final.prevBest == null
                              ? "First score on this song"
                              : "New best!"}</span
                          >`
                        : html`<span class="text-xs muted"
                            >Your best: ${best}%</span
                          >`}
                    </div>`
                  : html`<div class="flex flex-col gap-1">
                      <span class="label"
                        >${takeBuf ? "Your take" : "Session ended"}</span
                      >
                      <span class="display text-2xl font-bold"
                        >You sang to ${fmt(final.reached || 0)}</span
                      >
                      <span class="text-sm muted"
                        >${final.scoring
                          ? takeBuf
                            ? "Not enough singing to score, but your recording is ready."
                            : "Not enough singing to score."
                          : "You sang without scoring, so there's no score or recording."}</span
                      >
                      ${!final.scoring &&
                      html`<button
                        class="btn"
                        style=${{ alignSelf: "flex-start", marginTop: 6 }}
                        onClick=${() => {
                          setFinal(null);
                          setHpAsk(true);
                        }}
                      >
                        <span class="flex items-center gap-2"
                          ><${Icon} name="headphones" size=${18} />Check
                          headphones to get scored</span
                        >
                      </button>`}
                    </div>`}
              </div>
            </div>
            ${scored.length > 0 &&
            html`<div class="flex flex-col gap-2">
              ${(() => {
                const b = scored[scored.length - 1];
                return html`<div class="part-card">
                  <span class="flex flex-col min-w-0" style=${{ flex: 1 }}
                    ><span class="label"
                      >Best part ·
                      <span class="mono">${fmt(lines[b.i].start)}</span></span
                    ><span
                      class="text-sm"
                      style=${{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      >${lineLabel(b.i)}</span
                    ></span
                  >
                  <span
                    class="display font-bold"
                    style=${{ fontSize: 18, color: "var(--good)" }}
                    >${b.s}%</span
                  >
                </div>`;
              })()}
              ${scored.length > 1 &&
              scored
                .slice(0, Math.min(3, scored.length - 1))
                .filter(({ s }) => s < 90)
                .slice(0, scored.length > 4 ? 2 : 1)
                .map(
                  ({ i, s }, k) =>
                    html`<div key=${i} class="part-card">
                      <span class="flex flex-col min-w-0" style=${{ flex: 1 }}
                        ><span class="label"
                          >${k === 0 ? "Hardest part" : "Also practise"} ·
                          <span class="mono"
                            >${fmt(lines[i].start)}</span
                          ></span
                        ><span
                          class="text-sm"
                          style=${{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          >${lineLabel(i)}</span
                        ></span
                      >
                      <span
                        class="display font-bold"
                        style=${{
                          fontSize: 18,
                          color:
                            s >= 80
                              ? "var(--good)"
                              : s >= 50
                                ? "var(--warn)"
                                : "var(--bad)",
                        }}
                        >${s}%</span
                      >
                      <button
                        class="link-btn text-sm"
                        style=${{ textDecoration: "none" }}
                        onClick=${() =>
                          onPractice &&
                          onPractice(lines[i].start, lines[i].end + 0.3)}
                      >
                        Practise
                      </button>
                    </div>`,
                )}
            </div>`}
            ${takeBuf &&
            html`<div class="take-box">
              <div class="flex flex-wrap items-end justify-between gap-2">
                <div class="flex flex-col min-w-0">
                  <span class="label">Your recording</span>
                  <span class="text-sm"
                    >${fmt(takeBuf.duration)} of your voice, lined up with the
                    song</span
                  >
                </div>
                <div class="seg" role="group" aria-label="What to hear">
                  <button
                    aria-pressed=${!withMusic || !(inst && inst.buffer)
                      ? "true"
                      : "false"}
                    onClick=${() => setWithMusic(false)}
                  >
                    Just me
                  </button>
                  <button
                    aria-pressed=${withMusic && inst && inst.buffer
                      ? "true"
                      : "false"}
                    disabled=${!(inst && inst.buffer)}
                    onClick=${() => setWithMusic(true)}
                    title=${inst && inst.buffer
                      ? ""
                      : "Add the instrumental above first"}
                  >
                    Me + music
                  </button>
                </div>
              </div>
              <div class="player">
                <button
                  class="round-btn primary"
                  onClick=${() =>
                    pl.on ? playerPause() : playerStart(pl.pos)}
                  aria-label=${pl.on ? "Pause" : "Play"}
                >
                  <${Icon} name=${pl.on ? "pause" : "play"} />
                </button>

                <button
                  class="round-btn"
                  onClick=${playerStop}
                  aria-label="Stop"
                  disabled=${!pl.on && pl.pos === 0}
                >
                  <${Icon} name="stop" size=${16} />
                </button>
                <input
                  id="take-seek"
                  type="range"
                  min="0"
                  max=${plEnd()}
                  step="0.05"
                  value=${pl.pos}
                  onChange=${(e) => playerSeek(parseFloat(e.target.value))}
                  aria-label="Position in your recording"
                  style=${{ accentColor: "var(--accent)" }}
                />
                <span
                  class="mono text-xs muted"
                  style=${{ whiteSpace: "nowrap" }}
                  >${fmt(pl.pos)} / ${fmt(takeBuf.duration)}</span
                >
              </div>
              ${withMusic &&
              inst &&
              inst.buffer &&
              html`<button
                class="btn btn-ghost"
                style=${{
                  alignSelf: "flex-start",
                  padding: "4px 2px",
                  color: "var(--accent)",
                }}
                onClick=${() => setShowMix((v) => !v)}
                aria-expanded=${showMix ? "true" : "false"}
              >
                ${showMix ? "Hide mix and timing" : "Adjust mix and timing"}
              </button>`}
              ${withMusic &&
              inst &&
              inst.buffer &&
              showMix &&
              html`<div class="flex flex-col gap-3">
                <div
                  class="mixer"
                  style=${{
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  }}
                >
                  ${[
                    ["v", "My voice", 1.6],
                    ["m", "Music", 1.2],
                  ].map(
                    ([k, l, mx]) =>
                      html`<label key=${k} class="mix-row" for=${"out-" + k}>
                        <span class="text-xs font-semibold">${l}</span>
                        <input
                          id=${"out-" + k}
                          type="range"
                          min="0"
                          max=${mx}
                          step="0.05"
                          value=${mixVol[k]}
                          onInput=${(e) =>
                            setOut(k, parseFloat(e.target.value))}
                          onChange=${(e) =>
                            setOut(k, parseFloat(e.target.value))}
                          style=${{ accentColor: "var(--accent)" }}
                        />
                        <span
                          class="mono text-xs muted"
                          style=${{ width: 34, textAlign: "right" }}
                          >${Math.round(mixVol[k] * 100)}</span
                        >
                      </label>`,
                  )}
                </div>
                <div class="flex flex-wrap items-center gap-x-5 gap-y-2">
                  <button
                    class="switch"
                    role="switch"
                    aria-checked=${mixVol.verb ? "true" : "false"}
                    onClick=${() => setOut("verb", !mixVol.verb)}
                    style=${{ fontSize: 13 }}
                  >
                    <span class="track"><span class="knob"></span></span>Echo
                    (reverb)
                  </button>
                  <label
                    class="mix-row"
                    for="voice-timing"
                    style=${{ flex: "1 1 260px" }}
                  >
                    <span class="text-xs font-semibold">Voice timing</span>
                    <input
                      id="voice-timing"
                      type="range"
                      min=${-0.3 - lat}
                      max=${0.6 - lat}
                      step="0.01"
                      value=${nudgeV}
                      onChange=${(e) => setNudgeV(parseFloat(e.target.value))}
                      style=${{ accentColor: "var(--accent)" }}
                    />
                    <span
                      class="mono text-xs muted"
                      style=${{ minWidth: 86, textAlign: "right" }}
                      >${Math.abs(lat + nudgeV) < 0.005
                        ? "no shift"
                        : (lat + nudgeV > 0 ? "earlier " : "later ") +
                          Math.abs(lat + nudgeV).toFixed(2) +
                          " s"}</span
                    >
                  </label>
                </div>
                <p class="text-xs muted">
                  Drag Voice timing while it plays until your voice sits on
                  the beat.
                  ${lat > 0
                    ? "It starts " +
                      lat.toFixed(2) +
                      " s earlier to make up for headphone delay."
                    : ""}
                </p>
              </div>`}
              <div class="flex flex-wrap items-center gap-2">
                <button class="btn" onClick=${saveTake}>
                  ${withMusic && inst && inst.buffer
                    ? "Save just me"
                    : "Save recording"}
                </button>
                <button
                  class="btn"
                  onClick=${downloadMix}
                  disabled=${!!mixBusy || !(inst && inst.buffer)}
                  title=${inst && inst.buffer
                    ? ""
                    : "Add the instrumental above first"}
                >
                  ${mixBusy || "Save with music"}
                </button>
                <button class="btn btn-primary" onClick=${sendToAnalyst}>
                  Analyze →
                </button>
              </div>
              ${(saveMsg || mixMsg) &&
              html`<span class="text-xs muted">${mixMsg || saveMsg}</span>`}
              ${!mixMsg &&
              inst &&
              inst.buffer &&
              html`<span class="text-xs muted"
                >Save with music makes a WAV file of what you hear in "Me +
                music", about
                ${Math.max(1, Math.round((mixLength() / 60) * 10))} MB.</span
              >`}
            </div>`}
          </section>
        <//>`
      : html`<${React.Fragment}>
          ${ready
            ? html`<section
                class="flex flex-col items-center gap-4 text-center"
                style=${{ paddingTop: 12 }}
              >
                <span
                  class="label"
                  style=${{ color: "#c4b5fd", letterSpacing: "0.12em" }}
                  >Up first</span
                >
                <p
                  class="display font-bold"
                  style=${{
                    fontSize: 30,
                    lineHeight: 1.15,
                    margin: 0,
                    maxWidth: "20ch",
                  }}
                >
                  ${firstLines[0] || "♪"}
                </p>
                ${firstLines[1] &&
                html`<p
                  class="display font-semibold muted"
                  style=${{ fontSize: 17, margin: 0, maxWidth: "26ch" }}
                >
                  ${firstLines[1]}
                </p>`}
                ${!spans.length &&
                html`<p class="text-xs muted" style=${{ margin: 0 }}>
                  No lyrics for this song yet. Add an .lrc file under Change.
                </p>`}
                ${best != null &&
                html`<span class="k-chip" style=${{ cursor: "default" }}
                  ><span class="muted" style=${{ fontWeight: 500 }}
                    >Your best</span
                  ><span class="mono" style=${{ color: "#f3d18c" }}
                    >${best}%</span
                  ><span
                    style=${{ color: "#f3d18c", letterSpacing: 1 }}
                    aria-label=${karaStars(best) + " stars"}
                    >${"★".repeat(karaStars(best))}</span
                  ></span
                >`}
                <div
                  class="flex flex-col items-center gap-3"
                  style=${{ marginTop: 18 }}
                >
                  <button
                    class="ready-mic"
                    onClick=${() => startPressed(false)}
                    aria-label="Start singing"
                  >
                    <${Icon} name="mic" size=${36} />
                  </button>
                  <span
                    class="display font-bold"
                    style=${{ fontSize: 18, marginTop: 6 }}
                    >Tap to sing</span
                  >
                  <span class="text-sm muted"
                    >3-2-1 countdown, then the music starts</span
                  >
                  <div
                    class="flex flex-wrap justify-center gap-2"
                    style=${{ marginTop: 4 }}
                  >
                    <button class="k-chip" onClick=${() => setHpAsk(true)}>
                      <${Icon} name="headphones" size=${16} />${hp === "ok"
                        ? "Headphones on"
                        : hp === "override"
                          ? "No headphones"
                          : "Check headphones"}
                    </button>
                    <span
                      class="k-chip"
                      style=${{
                        cursor: "default",
                        color: listening ? "var(--good)" : "var(--muted)",
                        borderColor: listening
                          ? "rgba(95,211,154,.35)"
                          : undefined,
                      }}
                      >${listening ? "Scoring on" : "Scoring off"}</span
                    >
                    <button class="k-chip" onClick=${() => setOptOpen(true)}>
                      <${Icon} name="sliders" size=${16} />Mix
                    </button>
                  </div>
                </div>
              </section>`
            : html`<${React.Fragment}>
                <div class="flex items-center justify-between gap-3">
                  <span class="flex items-center gap-2 text-sm muted">
                    ${listening
                      ? html`<span class="rec-dot"></span>${playing
                            ? "Recording"
                            : "Paused"}`
                      : html`<${Icon} name="headphones" size=${18} />${hp ===
                            "skip" || hp === "nomic"
                            ? "Singing without scoring"
                            : "Headphones needed for scoring"}`}
                  </span>
                  <span class="flex items-center gap-2">
                    ${combo >= 2 &&
                    html`<span class="combo-chip"
                      >Combo
                      <span class="mono" style=${{ fontSize: 14 }}
                        >×${combo}</span
                      ></span
                    >`}
                    ${listening &&
                    html`<span class="score-chip"
                      ><span
                        class="label"
                        style=${{ fontSize: 9, color: "#c9a866" }}
                        >Score</span
                      ><b
                        >${liveScore != null ? liveScore + "%" : "—"}</b
                      ></span
                    >`}
                  </span>
                </div>

                <div class="stage stage-big">
                  <${KaraokeLine}
                    line=${prevIdx >= 0 ? lines[prevIdx] : null}
                    t=${null}
                    size=${15}
                    dim=${true}
                  />
                  <${KaraokeLine}
                    line=${showLine || (nextIdx >= 0 ? lines[nextIdx] : null)}
                    t=${showLine ? cursor : null}
                    size=${30}
                  />
                  <${KaraokeLine}
                    line=${showLine && nextIdx >= 0 ? lines[nextIdx] : null}
                    t=${null}
                    size=${17}
                    dim=${true}
                  />
                  ${!spans.length &&
                  html`<p class="text-xs muted">
                    No lyrics for this song yet. Add an .lrc file under
                    Change.
                  </p>`}
                </div>

                <div class="kara-lane">
                  ${pop &&
                  playing &&
                  html`<span
                    key=${pop.id}
                    class=${"kara-pop" +
                    (pop.kind === "great" ? " great" : "")}
                    aria-hidden="true"
                    >${pop.text}</span
                  >`}
                  <${MelodyMap}
                    data=${data}
                    notes=${notes}
                    tr=${0}
                    nameOf=${nameOf}
                    phrases=${phrases}
                    lyrics=${[]}
                    loop=${loop}
                    cursor=${cursor}
                    curIdx=${curIdx}
                    onTapNote=${(n) => {
                      setCursor(n.pos);
                      if (playing) startAt(n.pos, false);
                    }}
                    onSeek=${(t) => {
                      setCursor(t);
                      if (playing) startAt(t, false);
                    }}
                    themeKey=${themeKey}
                    overlay=${overlay}
                    height=${170}
                    marks=${marks}
                  />
                </div>

                <div
                  class="playbar"
                  style=${{
                    flexDirection: "column",
                    alignItems: "stretch",
                    gap: "10px",
                  }}
                >
                  <span class="flex items-center gap-3">
                    <span class="mono text-xs muted">${fmt(cursor)}</span>
                    <input
                      id="kara-seek"
                      type="range"
                      min="0"
                      max=${songEnd}
                      step="0.1"
                      value=${cursor}
                      onChange=${(e) => {
                        const t = parseFloat(e.target.value);
                        setCursor(t);
                        if (playing) startAt(t, false);
                      }}
                      aria-label="Position in the song"
                    />
                    <span class="mono text-xs muted">${fmt(songEnd)}</span>
                  </span>
                  <span class="flex items-center justify-center gap-5">
                    <button
                      class="round-btn"
                      onClick=${() => setOptOpen(true)}
                      aria-label="Mix and options"
                    >
                      <${Icon} name="sliders" />
                    </button>
                    <span class="mic-ring" ref=${ringRef}
                      ><button
                        class="round-btn primary big"
                        onClick=${() => startPressed(false)}
                        aria-label=${playing
                          ? "Pause"
                          : cursor > 0.05 && cursor < songEnd - 0.2
                            ? "Resume"
                            : "Start"}
                      >
                        <${Icon}
                          name=${playing ? "pause" : "play"}
                          size=${26}
                        /></button
                    ></span>
                    <button
                      class="round-btn"
                      onClick=${stopSession}
                      aria-label="Stop and see results"
                      disabled=${!(
                        playing ||
                        (cursor > 0.05 && cursor < songEnd - 0.2)
                      )}
                    >
                      <${Icon} name="stop" size=${16} />
                    </button>
                  </span>
                  ${loop &&
                  html`<span
                    class="flex items-center justify-center gap-2 text-xs"
                    ><span style=${{ color: "var(--accent)" }}
                      >Looping ${fmt(loop.a)}–${fmt(loop.b)}</span
                    ><button
                      class="btn btn-ghost"
                      style=${{ padding: "2px 8px", fontSize: 12 }}
                      onClick=${clearLoop}
                    >
                      Stop looping
                    </button></span
                  >`}
                </div>
              <//>`}
        <//>`}
    ${count != null &&
    html`<button
      class="kara-count"
      onClick=${cancelCount}
      aria-label="Cancel countdown"
    >
      <span key=${count} class="count-num" aria-live="assertive"
        >${count}</span
      >
    </button>`}

    <${Sheet}
      open=${optOpen}
      title="Karaoke options"
      onClose=${() => setOptOpen(false)}
    >
      <div class="opt-group">
        <span class="label">Mix</span>
        <div class="mixer">
          ${[
            ["m", "Music"],
            ["v", "Guide vocal"],
            ["g", "Guide notes"],
          ].map(
            ([k, l]) =>
              html`<label key=${k} class="mix-row" for=${"kmix-" + k}>
                <span class="text-xs font-semibold">${l}</span>
                <input
                  id=${"kmix-" + k}
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
        <p class="text-xs muted">
          Guide vocal is the original singer, quietly, like the guide button
          on a karaoke machine. Turn it off once you know the song. Any octave
          counts when scoring.
        </p>
      </div>
      <div class="opt-group">
        <span class="label">Music timing</span>
        ${inst && inst.buffer
          ? html`<div class="flex flex-wrap items-center gap-2">
                <button
                  class="btn"
                  style=${small}
                  onClick=${() => nudge(-0.1)}
                  aria-label="Music earlier"
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
                  onClick=${() => nudge(0.1)}
                  aria-label="Music later"
                >
                  +0.1 s
                </button>
                <button
                  class="btn btn-ghost"
                  style=${small}
                  onClick=${runAutoSync}
                >
                  Auto-sync
                </button>
                <button
                  class="btn"
                  style=${small}
                  onClick=${() => {
                    setOptOpen(false);
                    checkTiming();
                  }}
                >
                  ▶ Check timing
                </button>
              </div>
              <p class="text-xs muted">
                ${syncMsg ||
                "Check timing plays the music with the original voice up loud. Nudge until they line up."}
              </p>`
          : html`<p class="text-sm muted">
              No instrumental for this song. Add one under Change to sing with
              music.
            </p>`}
      </div>
      <div class="opt-group">
        <span class="label">Headphones</span>
        <p
          class="text-sm"
          style=${{
            color:
              hp === "ok"
                ? "var(--good)"
                : hp === "heard"
                  ? "var(--warn)"
                  : undefined,
          }}
        >
          ${hpText}
        </p>
        <div class="flex flex-wrap gap-2">
          <button
            class="btn"
            disabled=${hp === "checking"}
            onClick=${runCheck}
          >
            ${hp === "unknown" || hp === "skip"
              ? "Check headphones"
              : "Check again"}
          </button>
          ${hp === "heard" &&
          html`<button
            class="btn btn-ghost"
            onClick=${() => {
              setHp("override");
              hpRef.current = "override";
            }}
          >
            Score anyway
          </button>`}
        </div>
      </div>
    <//>

    <${Sheet}
      open=${hpAsk}
      title="Headphones on?"
      onClose=${() => setHpAsk(false)}
    >
      <p class="text-sm">
        For scoring and recording, the mic must hear only you, not the music.
        A quick check plays three beeps and listens.
      </p>
      ${hp !== "unknown" &&
      html`<p
        class="text-sm"
        style=${{ color: hp === "ok" ? "var(--good)" : "var(--warn)" }}
      >
        ${hpText}
      </p>`}
      <div class="flex flex-col gap-2">
        <button
          class="btn btn-primary"
          style=${{ justifyContent: "center", minHeight: 48 }}
          disabled=${hp === "checking"}
          onClick=${checkThenSing}
        >
          ${hp === "checking"
            ? "Listening…"
            : hp === "heard"
              ? "Check again"
              : "Check and start"}
        </button>
        ${hp === "heard" &&
        html`<button
          class="btn"
          style=${{ justifyContent: "center", minHeight: 48 }}
          onClick=${() => {
            setHp("override");
            hpRef.current = "override";
            setHpAsk(false);
            countIn(() => startAt(0, true));
          }}
        >
          Score anyway
        </button>`}
        <button
          class="btn btn-ghost"
          style=${{ justifyContent: "center", minHeight: 48 }}
          onClick=${singWithout}
        >
          Sing without scoring
        </button>
      </div>
    <//>
  </div>`;
}

/* ---------- sample songs from Google Drive ---------- */

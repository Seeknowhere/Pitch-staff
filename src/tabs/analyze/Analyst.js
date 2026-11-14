import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { Icon } from "../../components/Icon.js";
import { UploadSlot } from "../../components/UploadSlot.js";
import { html } from "../../html.js";
import { mapTime, fixedMap, detectKeyAndOffset, GRID, loadSessions, warpTake, invTime, compare, trackPitch, scheduleGuide, SESS_KEY, decodeFile } from "../../lib/analysis.js";
import { lyricSpans } from "../../lib/lyrics.js";
import { fmt } from "../../lib/music.js";
import { buildPhrases } from "../../lib/phrases.js";
import { savePlan, makePlan } from "../../lib/plan.js";
import { loadRuns, analyzeRun, loadLastRun, saveLastRun, addRun } from "../../lib/runs.js";
import { loadJSON, saveJSON } from "../../lib/storage.js";
import { technique } from "../../lib/technique.js";
import { loadTries } from "../../lib/tries.js";
import { AnalyzeView } from "./AnalyzeView.js";
import { RollChart } from "./RollChart.js";

const MIX_KEY = "pitchstaff.mix.v1";

export function Analyst({
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

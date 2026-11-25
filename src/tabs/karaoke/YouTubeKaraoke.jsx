// YouTube karaoke: find a karaoke video on YouTube and sing along in YouTube's own player.
// No score (Tono can't hear the video, so it doesn't know the melody): you see your voice live,
// and "Hear yourself" replays the video with your recording on top.
import React, { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon.jsx";
import { detectPitch } from "../../lib/pitch.js";
import { SETTINGS, micGate, getMicStream } from "../../lib/settings.js";
import { midiInfo } from "../../lib/music.js";
import { saveBlob, encodeWav, peakOf, makeImpulse } from "../../lib/audio.js";
import { loadJSON, saveJSON } from "../../lib/storage.js";
import {
  canSearch,
  loadYouTube,
  searchKaraoke,
  youTubeId,
} from "../../lib/youtube.js";

const RECENT = "tono.yt.recent.v1";
const loadRecent = () => {
  try {
    return JSON.parse(localStorage.getItem(RECENT) || "[]");
  } catch (e) {
    return [];
  }
};

export function YouTubeKaraoke({ onBack }) {
  const [video, setVideo] = useState(null); // { id, title, channel, thumb }
  const [recent, setRecent] = useState(loadRecent);
  const pick = (v) => {
    const next = [v, ...recent.filter((x) => x.id !== v.id)].slice(0, 8);
    setRecent(next);
    try {
      localStorage.setItem(RECENT, JSON.stringify(next));
    } catch (e) {}
    setVideo(v);
  };
  return video ? (
    <Player video={video} onBack={() => setVideo(null)} />
  ) : (
    <Finder onBack={onBack} onPick={pick} recent={recent} />
  );
}

function Finder({ onBack, onPick, recent }) {
  const [q, setQ] = useState("");
  const [link, setLink] = useState("");
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const search = async (e) => {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    setErr("");
    try {
      setItems(await searchKaraoke(q));
    } catch (x) {
      setErr(
        x.message === "quota"
          ? "Tono's YouTube searches are used up for today. Paste a link below, or try again tomorrow."
          : "Couldn't search YouTube right now. Check your internet, or paste a link below.",
      );
    }
    setBusy(false);
  };
  const usePasted = (e) => {
    e.preventDefault();
    const id = youTubeId(link);
    if (!id) return setErr("That doesn't look like a YouTube link.");
    setErr("");
    onPick({
      id,
      title: "YouTube video",
      channel: "",
      thumb: "https://i.ytimg.com/vi/" + id + "/mqdefault.jpg",
    });
  };
  const list = items || (recent.length ? recent : null);
  return (
    <section
      className="flex flex-col gap-4"
      style={{ maxWidth: 640, width: "100%", margin: "0 auto" }}
    >
      <button
        className="btn btn-ghost"
        style={{ alignSelf: "flex-start", padding: "6px 10px" }}
        onClick={onBack}
      >
        <span className="flex items-center gap-1">
          <Icon name="back" size={18} />
          Modes
        </span>
      </button>
      <div className="flex flex-col gap-1">
        <h2
          className="display font-bold"
          style={{
            fontSize: 30,
            lineHeight: 1.05,
            margin: 0,
            letterSpacing: "-0.02em",
          }}
        >
          YouTube karaoke
        </h2>
        <p className="text-sm muted" style={{ margin: 0 }}>
          Sing along to any karaoke video on YouTube. No score here: just you
          and the song.
        </p>
      </div>
      {canSearch() ? (
        <form className="flex gap-2" onSubmit={search} role="search">
          <input
            className="battle-input"
            style={{ flex: 1, minWidth: 0 }}
            type="search"
            aria-label="Song or artist"
            placeholder="Song or artist"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="btn btn-primary" disabled={busy || !q.trim()}>
            {busy ? "Searching…" : "Search"}
          </button>
        </form>
      ) : (
        <p className="text-sm muted" style={{ margin: 0 }}>
          Search isn't switched on yet. Paste a YouTube link below in the
          meantime.
        </p>
      )}
      <form className="flex gap-2" onSubmit={usePasted}>
        <input
          className="battle-input"
          style={{ flex: 1, minWidth: 0 }}
          aria-label="YouTube link"
          placeholder="Paste a YouTube link"
          value={link}
          onChange={(e) => setLink(e.target.value)}
        />
        <button className="btn" disabled={!link.trim()}>
          Sing it
        </button>
      </form>
      {err && (
        <p className="text-sm" style={{ color: "var(--warn)", margin: 0 }}>
          {err}
        </p>
      )}
      {list && (
        <div className="flex flex-col gap-2">
          <span className="label">{items ? "Results" : "Recently sung"}</span>
          {list.length === 0 && (
            <p className="text-sm muted">
              No karaoke videos found. Try the artist's name too.
            </p>
          )}
          <div className="yt-list">
            {list.map((v) => (
              <button key={v.id} className="yt-item" onClick={() => onPick(v)}>
                <img src={v.thumb} alt="" loading="lazy" />
                <span className="flex flex-col" style={{ minWidth: 0 }}>
                  <span className="font-semibold yt-title">{v.title}</span>
                  {v.channel && (
                    <span className="text-xs muted">{v.channel}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="text-xs muted" style={{ margin: 0 }}>
        Videos play in YouTube's own player, so YouTube's ads and rules apply.
        Some videos can't be played outside YouTube and won't show up.
      </p>
    </section>
  );
}

// ---- the video, your live voice, and "Hear yourself" ----
function Player({ video, onBack }) {
  const box = useRef(null);
  const yt = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState("");
  const [state, setState] = useState(-1); // YouTube player state
  const [title, setTitle] = useState(video.title);
  // singing: mic on, recording your voice from where the video started
  const mic = useRef({});
  const [singing, setSinging] = useState(false);
  const [note, setNote] = useState(null);
  const [level, setLevel] = useState(0);
  const canvas = useRef(null);
  const trail = useRef([]);
  const rec = useRef(null); // { recorder, chunks, start }
  // your take: the recording, where in the video it started, and the delay it was recorded with
  const [take, setTake] = useState(null); // { url, start, blob, buf, auto }
  const [saveMsg, setSaveMsg] = useState("");
  useEffect(() => setSaveMsg(""), [take]);
  // the same mix settings as normal Karaoke (shared with it), plus this device's timing tweak
  const [mixVol, setMixVol] = useState(() =>
    loadJSON("pitchstaff.karaout.v1", { v: 1, m: 0.75, verb: true }),
  );
  const [nudge, setNudge] = useState(() => loadJSON("tono.yt.timing.v1", 0));
  const shift = take ? take.auto + nudge : 0; // how much earlier your voice is played
  const shiftRef = useRef(0);
  shiftRef.current = shift;
  const [hearing, setHearing] = useState(false);
  const pb = useRef({ ctx: null, chain: null, src: null, at: 0, off: 0 });
  const syncTimer = useRef(0);
  const playCtx = () => {
    const P = pb.current;
    if (!P.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      P.ctx = new Ctx();
    }
    if (P.ctx.state === "suspended") P.ctx.resume().catch(() => {});
    return P.ctx;
  };
  // your voice cleaned up like normal Karaoke: low rumble off, an even level, a touch of echo
  const voiceChain = (ctx, dest, buf) => {
    const out = ctx.createDynamicsCompressor();
    out.threshold.value = -8;
    out.ratio.value = 4;
    out.attack.value = 0.005;
    out.release.value = 0.2;
    out.connect(dest);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 90;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -24;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.25;
    const norm = Math.min(8, 0.5 / peakOf(buf));
    const vG = ctx.createGain();
    vG.gain.value = mixVol.v * norm;
    hp.connect(comp);
    comp.connect(vG);
    vG.connect(out);
    const conv = ctx.createConvolver();
    conv.buffer = makeImpulse(ctx);
    const wet = ctx.createGain();
    wet.gain.value = mixVol.verb ? 0.22 : 0;
    vG.connect(conv);
    conv.connect(wet);
    wet.connect(out);
    return { input: hp, vG, wet, norm, out };
  };
  const setOut = (k, v) => {
    const next = { ...mixVol, [k]: v };
    setMixVol(next);
    saveJSON("pitchstaff.karaout.v1", next);
    const P = pb.current;
    if (P.chain && P.ctx) {
      const t = P.ctx.currentTime;
      if (k === "v") P.chain.vG.gain.setTargetAtTime(v * P.chain.norm, t, 0.03);
      if (k === "verb") P.chain.wet.gain.setTargetAtTime(v ? 0.22 : 0, t, 0.03);
    }
  };
  // the music is YouTube's own player volume (it can't go above 100)
  useEffect(() => {
    if (ready && yt.current && yt.current.setVolume)
      yt.current.setVolume(Math.round(Math.min(1, mixVol.m) * 100));
  }, [ready, mixVol.m]);
  const setTiming = (v) => {
    setNudge(v);
    saveJSON("tono.yt.timing.v1", v);
  };
  // your voice as a file, with the echo and the timing fix (the video's music can't be
  // included: Tono never has it)
  const saveTake = async () => {
    if (!take || !take.buf) return;
    const base =
      (title || "YouTube karaoke")
        .replace(/\(.*?\)|\[.*?\]/g, "")
        .replace(/karaoke|instrumental|lyrics/gi, "")
        .replace(/[^\w\- ]+/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 40) || "song";
    setSaveMsg("Getting it ready…");
    try {
      const buf = take.buf,
        sr = buf.sampleRate,
        tail = mixVol.verb ? 1.8 : 0.2;
      const len = Math.max(1, Math.ceil((buf.duration - shift + tail) * sr));
      const off = new OfflineAudioContext(2, len, sr);
      const ch = voiceChain(off, off.destination, buf);
      const src = off.createBufferSource();
      src.buffer = buf;
      src.connect(ch.input);
      if (shift >= 0) src.start(0, shift);
      else src.start(-shift, 0);
      const out = await off.startRendering();
      await saveBlob(encodeWav(out), base + " - my singing.wav");
      setSaveMsg("Saved. It's your voice only, without the music.");
    } catch (e) {
      setSaveMsg(
        e && e.code === "declined"
          ? "Save cancelled."
          : "Saving isn't available here.",
      );
    }
  };

  // the YouTube player
  useEffect(() => {
    let dead = false;
    loadYouTube()
      .then((YT) => {
        if (dead) return;
        yt.current = new YT.Player(box.current, {
          videoId: video.id,
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
          events: {
            onReady: (e) => {
              setReady(true);
              const d = e.target.getVideoData && e.target.getVideoData();
              if (d && d.title && video.title === "YouTube video")
                setTitle(d.title);
            },
            onStateChange: (e) => setState(e.data),
            onError: (e) =>
              setFailed(
                e.data === 101 || e.data === 150
                  ? "This video's owner doesn't allow it to play outside YouTube. Try another one."
                  : "This video can't play here. Try another one.",
              ),
          },
        });
      })
      .catch(() => setFailed("YouTube couldn't load. Check your internet."));
    return () => {
      dead = true;
      try {
        yt.current && yt.current.destroy();
      } catch (e) {}
    };
  }, [video.id]);

  // stop everything when leaving
  useEffect(
    () => () => {
      stopMic();
      stopHearing();
      if (pb.current.ctx) pb.current.ctx.close().catch(() => {});
    },
    [],
  );
  useEffect(() => () => take && URL.revokeObjectURL(take.url), [take]);

  // while "Hear yourself" plays, your recording follows the video: it starts, pauses and
  // jumps with it, and is put back in line if the video stutters or buffers
  useEffect(() => {
    if (!hearing || !take) return;
    if (state === 1) startVoice();
    else stopVoice();
    if (state === 0) stopHearing();
  }, [state, hearing]);
  // moving the timing slider while it plays takes effect straight away
  useEffect(() => {
    if (hearing && state === 1) startVoice();
  }, [nudge]);

  // recording starts the moment the video actually plays
  useEffect(() => {
    const r = rec.current;
    if (singing && r && !r.started && state === 1) {
      r.started = true;
      r.start = yt.current.getCurrentTime();
      r.recorder.start();
    }
    if (singing && state === 0) stopSinging();
  }, [state, singing]);

  const stopMic = () => {
    const m = mic.current;
    cancelAnimationFrame(m.raf);
    if (m.stream) m.stream.getTracks().forEach((t) => t.stop());
    if (m.ctx) m.ctx.close().catch(() => {});
    mic.current = {};
  };

  const startSinging = async (fromStart) => {
    if (!yt.current || !ready) return;
    stopHearing();
    let stream;
    try {
      stream = await getMicStream();
    } catch (e) {
      setFailed(
        "Tono can't use the microphone. Allow it in your browser to sing along.",
      );
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext,
      ctx = new Ctx();
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    ctx.createMediaStreamSource(stream).connect(an);
    mic.current = { stream, ctx, an };
    // the delay this phone and these headphones add: what you hear comes late, and so does
    // the mic, so your recording lands late against the video
    const tr = stream.getAudioTracks()[0];
    const inLat =
      (tr && tr.getSettings && tr.getSettings().latency) ||
      ctx.baseLatency ||
      0.01;
    const outLat = ctx.outputLatency || ctx.baseLatency || 0.02;
    const auto = Math.max(0.05, Math.min(0.5, inLat + outLat + 0.04));
    trail.current = [];
    // record your voice only (the video's sound never goes through Tono)
    const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find(
      (t) =>
        window.MediaRecorder &&
        MediaRecorder.isTypeSupported &&
        MediaRecorder.isTypeSupported(t),
    );
    if (window.MediaRecorder) {
      const recorder = new MediaRecorder(
        stream,
        type ? { mimeType: type } : undefined,
      );
      const chunks = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.current = { recorder, chunks, started: false, start: 0, auto };
    }
    const buf = new Float32Array(an.fftSize);
    const tick = () => {
      an.getFloatTimeDomainData(buf);
      const d = detectPitch(buf, ctx.sampleRate, micGate());
      const m = d.freq > 0 ? 69 + 12 * Math.log2(d.freq / SETTINGS.a4) : NaN;
      setLevel(Math.min(1, (d.rms || 0) * 9));
      setNote(m === m ? midiInfo(Math.round(m)).label : null);
      const now = performance.now();
      trail.current.push({ t: now, m });
      while (trail.current.length && trail.current[0].t < now - 8000)
        trail.current.shift();
      draw();
      mic.current.raf = requestAnimationFrame(tick);
    };
    tick();
    setSinging(true);
    if (fromStart) yt.current.seekTo(0, true);
    yt.current.playVideo();
  };

  const stopSinging = () => {
    const r = rec.current;
    rec.current = null;
    stopMic();
    setSinging(false);
    setNote(null);
    setLevel(0);
    try {
      yt.current && yt.current.pauseVideo();
    } catch (e) {}
    if (r && r.started) {
      r.recorder.onstop = () => {
        if (!r.chunks.length) return;
        const blob = new Blob(r.chunks, {
          type: r.chunks[0].type || "audio/webm",
        });
        blob
          .arrayBuffer()
          .then((ab) => playCtx().decodeAudioData(ab))
          .then((buf) =>
            setTake({
              url: URL.createObjectURL(blob),
              start: r.start,
              blob,
              buf,
              auto: r.auto,
            }),
          )
          .catch(() =>
            setFailed("Couldn't get your recording ready. Try singing again."),
          );
      };
      try {
        r.recorder.stop();
      } catch (e) {}
    }
  };

  // your voice from the spot the video is at (shifted earlier to make up for the delay)
  function startVoice() {
    const P = pb.current,
      p = yt.current;
    if (!take || !take.buf || !p) return;
    stopVoice();
    const ctx = playCtx();
    if (!P.chain) P.chain = voiceChain(ctx, ctx.destination, take.buf);
    const off = p.getCurrentTime() - take.start + shiftRef.current;
    const src = ctx.createBufferSource();
    src.buffer = take.buf;
    src.connect(P.chain.input);
    const now = ctx.currentTime + 0.02;
    if (off >= 0) src.start(now, off);
    else src.start(now - off, 0);
    P.src = src;
    P.at = now;
    P.off = off;
  }
  function stopVoice() {
    const P = pb.current;
    if (P.src) {
      try {
        P.src.stop();
      } catch (e) {}
      P.src = null;
    }
  }
  const hearYourself = () => {
    if (!take || !take.buf || !yt.current) return;
    const P = pb.current;
    playCtx();
    if (P.chain) {
      try {
        P.chain.out.disconnect();
      } catch (e) {}
    }
    P.chain = null;
    setHearing(true);
    yt.current.seekTo(take.start, true);
    yt.current.playVideo();
    clearInterval(syncTimer.current);
    syncTimer.current = setInterval(() => {
      const p = yt.current;
      if (!P.src || !p || !P.ctx) return;
      const want = p.getCurrentTime() - take.start + shiftRef.current;
      const have = P.off + (P.ctx.currentTime - P.at);
      if (Math.abs(have - want) > 0.12) startVoice();
    }, 500);
  };
  function stopHearing() {
    clearInterval(syncTimer.current);
    stopVoice();
    setHearing(false);
  }

  // your pitch over the last 8 seconds, on a semitone grid
  function draw() {
    const c = canvas.current;
    if (!c) return;
    const w = (c.width = c.clientWidth * devicePixelRatio),
      h = (c.height = c.clientHeight * devicePixelRatio);
    const g = c.getContext("2d");
    g.clearRect(0, 0, w, h);
    const pts = trail.current.filter((p) => p.m === p.m);
    if (!pts.length) return;
    const ms = pts.map((p) => p.m),
      mid = (Math.min(...ms) + Math.max(...ms)) / 2,
      lo = mid - 9,
      span = 18;
    g.strokeStyle = "rgba(165,159,189,.12)";
    g.lineWidth = 1;
    for (let k = Math.ceil(lo); k < lo + span; k++) {
      const y = h - ((k - lo) / span) * h;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
    const now = performance.now();
    g.strokeStyle = "#e2b65c";
    g.lineWidth = 3 * devicePixelRatio;
    g.lineCap = "round";
    g.beginPath();
    let prev = null;
    trail.current.forEach((p) => {
      if (p.m !== p.m) return (prev = null);
      const x = w - ((now - p.t) / 8000) * w,
        y = h - ((p.m - lo) / span) * h;
      if (prev && p.t - prev.t < 150) g.lineTo(x, y);
      else g.moveTo(x, y);
      prev = p;
    });
    g.stroke();
  }

  return (
    <section
      className="flex flex-col gap-4"
      style={{ maxWidth: 720, width: "100%", margin: "0 auto" }}
    >
      <button
        className="btn btn-ghost"
        style={{ alignSelf: "flex-start", padding: "6px 10px" }}
        onClick={() => {
          stopSinging();
          stopHearing();
          onBack();
        }}
      >
        <span className="flex items-center gap-1">
          <Icon name="back" size={18} />
          Search
        </span>
      </button>
      <div className="yt-frame">
        <div ref={box}></div>
      </div>
      <h2
        className="display font-bold"
        style={{ fontSize: 20, margin: 0, overflowWrap: "anywhere" }}
      >
        {title}
      </h2>
      {failed && (
        <p className="text-sm" style={{ color: "var(--warn)", margin: 0 }}>
          {failed}
        </p>
      )}
      <div className="yt-voice">
        <div className="flex items-center gap-3">
          <div className="yt-note" aria-live="off">
            {singing ? note || "–" : "🎤"}
          </div>
          <div className="flex flex-col" style={{ flex: 1, minWidth: 0 }}>
            <span className="font-semibold">
              {singing ? "Singing" : "Your voice"}
            </span>
            <span className="text-xs muted">
              {singing
                ? "Tono shows your pitch. Headphones keep the video out of your recording."
                : "Wear headphones, then sing along."}
            </span>
            <div className="yt-level">
              <span style={{ width: level * 100 + "%" }}></span>
            </div>
          </div>
        </div>
        <canvas ref={canvas} className="yt-trail" aria-hidden="true"></canvas>
        <div className="flex flex-wrap gap-2">
          {singing ? (
            <button className="btn btn-primary" onClick={stopSinging}>
              Stop
            </button>
          ) : (
            <>
              <button
                className="btn btn-primary"
                disabled={!ready || !!failed}
                onClick={() => startSinging(true)}
              >
                Sing from the start
              </button>
              <button
                className="btn"
                disabled={!ready || !!failed}
                onClick={() => startSinging(false)}
              >
                Sing from here
              </button>
            </>
          )}
          {take && !singing && (
            <button
              className="btn"
              onClick={hearing ? stopHearing : hearYourself}
            >
              {hearing ? "Stop listening" : "🎧 Hear yourself"}
            </button>
          )}
          {take && !singing && (
            <button className="btn" onClick={saveTake}>
              💾 Save my recording
            </button>
          )}
        </div>
        {take && !singing && (
          <div className="flex flex-col gap-3">
            <div
              className="mixer"
              style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}
            >
              {[
                ["v", "My voice", 1.6],
                ["m", "Music", 1],
              ].map(([k, l, mx]) => (
                <label key={k} className="mix-row" htmlFor={"yt-out-" + k}>
                  <span className="text-xs font-semibold">{l}</span>
                  <input
                    id={"yt-out-" + k}
                    type="range"
                    min="0"
                    max={mx}
                    step="0.05"
                    value={Math.min(mx, mixVol[k])}
                    onInput={(e) => setOut(k, parseFloat(e.target.value))}
                    onChange={(e) => setOut(k, parseFloat(e.target.value))}
                    style={{ accentColor: "var(--accent)" }}
                  />
                  <span
                    className="mono text-xs muted"
                    style={{ width: 34, textAlign: "right" }}
                  >
                    {Math.round(Math.min(mx, mixVol[k]) * 100)}
                  </span>
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <button
                className="switch"
                role="switch"
                aria-checked={mixVol.verb ? "true" : "false"}
                onClick={() => setOut("verb", !mixVol.verb)}
                style={{ fontSize: 13 }}
              >
                <span className="track">
                  <span className="knob" />
                </span>
                Echo (reverb)
              </button>
              <label
                className="mix-row"
                htmlFor="yt-voice-timing"
                style={{ flex: "1 1 260px" }}
              >
                <span className="text-xs font-semibold">Voice timing</span>
                <input
                  id="yt-voice-timing"
                  type="range"
                  min={-0.3 - take.auto}
                  max={0.6 - take.auto}
                  step="0.01"
                  value={nudge}
                  onChange={(e) => setTiming(parseFloat(e.target.value))}
                  style={{ accentColor: "var(--accent)" }}
                />
                <span
                  className="mono text-xs muted"
                  style={{ minWidth: 86, textAlign: "right" }}
                >
                  {Math.abs(shift) < 0.005
                    ? "no shift"
                    : (shift > 0 ? "earlier " : "later ") +
                      Math.abs(shift).toFixed(2) +
                      " s"}
                </span>
              </label>
            </div>
            <p className="text-xs muted" style={{ margin: 0 }}>
              {saveMsg ||
                "Drag Voice timing while it plays until your voice sits on the beat. It starts " +
                  take.auto.toFixed(2) +
                  " s earlier to make up for headphone delay. Saving gives you your voice only, since Tono can't record YouTube's music."}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

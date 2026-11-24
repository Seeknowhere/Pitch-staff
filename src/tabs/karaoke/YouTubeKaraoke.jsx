// YouTube karaoke: find a karaoke video on YouTube and sing along in YouTube's own player.
// No score (Tono can't hear the video, so it doesn't know the melody): you see your voice live,
// and "Hear yourself" replays the video with your recording on top.
import React, { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon.jsx";
import { detectPitch } from "../../lib/pitch.js";
import { SETTINGS, micGate, getMicStream } from "../../lib/settings.js";
import { midiInfo } from "../../lib/music.js";
import { saveBlob } from "../../lib/audio.js";
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
  const [take, setTake] = useState(null); // { url, start, blob }
  const [saveMsg, setSaveMsg] = useState("");
  useEffect(() => setSaveMsg(""), [take]);
  // your voice as a file (the video's music can't be included: Tono never has it)
  const saveTake = async () => {
    if (!take || !take.blob) return;
    const type = take.blob.type || "";
    const ext = /mp4|m4a|aac/.test(type)
      ? "m4a"
      : /ogg/.test(type)
        ? "ogg"
        : "webm";
    const base =
      (title || "YouTube karaoke")
        .replace(/\(.*?\)|\[.*?\]/g, "")
        .replace(/karaoke|instrumental|lyrics/gi, "")
        .replace(/[^\w\- ]+/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 40) || "song";
    try {
      await saveBlob(take.blob, base + " - my singing." + ext);
      setSaveMsg("Saved. It's your voice only, without the music.");
    } catch (e) {
      setSaveMsg(
        e && e.code === "declined"
          ? "Save cancelled."
          : "Saving isn't available here.",
      );
    }
  };
  const [hearing, setHearing] = useState(false);
  const audio = useRef(null);
  const syncTimer = useRef(0);

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
      clearInterval(syncTimer.current);
      if (audio.current) audio.current.pause();
    },
    [],
  );
  useEffect(() => () => take && URL.revokeObjectURL(take.url), [take]);

  // while "Hear yourself" plays, keep your recording lined up with the video and paused with it
  useEffect(() => {
    if (!hearing || !audio.current || !take) return;
    const a = audio.current;
    if (state === 1) {
      a.currentTime = Math.max(0, yt.current.getCurrentTime() - take.start);
      a.play().catch(() => {});
    } else a.pause();
    if (state === 0) stopHearing();
  }, [state, hearing]);

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
      rec.current = { recorder, chunks, started: false, start: 0 };
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
        setTake({ url: URL.createObjectURL(blob), start: r.start, blob });
      };
      try {
        r.recorder.stop();
      } catch (e) {}
    }
  };

  const hearYourself = () => {
    if (!take || !yt.current) return;
    if (!audio.current || audio.current.src !== take.url)
      audio.current = new Audio(take.url);
    setHearing(true);
    yt.current.seekTo(take.start, true);
    yt.current.playVideo();
    // nudge the recording back in line if the video stutters or buffers
    clearInterval(syncTimer.current);
    syncTimer.current = setInterval(() => {
      const a = audio.current,
        p = yt.current;
      if (!a || !p || a.paused) return;
      const want = p.getCurrentTime() - take.start;
      if (Math.abs(a.currentTime - want) > 0.25)
        a.currentTime = Math.max(0, want);
    }, 1000);
  };
  function stopHearing() {
    clearInterval(syncTimer.current);
    if (audio.current) audio.current.pause();
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
          <p className="text-xs muted" style={{ margin: 0 }}>
            {saveMsg ||
              "Hear yourself plays the video with your recording on top. Saving gives you a file of your voice only, since Tono can't record YouTube's music."}
          </p>
        )}
      </div>
    </section>
  );
}

import {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  useLayoutEffect,
} from "react";
import { Icon } from "./components/Icon.jsx";
import { SettingsPanel } from "./components/SettingsPanel.jsx";
import { Sheet } from "./components/Sheet.jsx";
import { aiCachePut, aiCacheGet, snapToKey, aiNotes } from "./lib/ai-notes.js";
import { trackPitch, decodeFile, guideBySyllables } from "./lib/analysis.js";
import { chromaOf } from "./lib/audio.js";
import {
  onsetEnvelope,
  autoSync,
  keyGap,
  KARA_SYNC_KEY,
} from "./lib/karaoke-sync.js";
import {
  loadLyricsStore,
  saveLyricsFor,
  lyricSpans,
  parseLrc,
  songTitle,
  looksTagalog,
} from "./lib/lyrics.js";
import { fmt, midiInfo, freqToMidi } from "./lib/music.js";
import { detectPitch } from "./lib/pitch.js";
import { SETTINGS, micGate, getMicStream } from "./lib/settings.js";
import { cancelSplit, splitSong, canSplitSongs, wavFile } from "./lib/split.js";
import { fileKey, findSplit, saveSong, touchSong } from "./lib/songLibrary.js";
import { loadJSON, saveJSON } from "./lib/storage.js";
import { usNotesFor } from "./lib/ultrastar.js";
import { SongSetup } from "./song/SongSetup.jsx";
import { Analyst } from "./tabs/analyze/Analyst.jsx";
import { Karaoke } from "./tabs/karaoke/Karaoke.jsx";
import {
  KaraokeModePick,
  BattleJoin,
  BattleLobby,
} from "./tabs/karaoke/BattleLobby.jsx";
import { useBattle } from "./tabs/karaoke/useBattle.js";
import { Lessons } from "./tabs/lessons/Lessons.jsx";
import { Learn } from "./tabs/practice/Learn.jsx";
import { MatchTrainer } from "./tabs/tuner/MatchTrainer.jsx";

// The whole app: tabs, the chosen song, and the live mic.

const KEY = "pitchstaff.history.v1";

const THEME_KEY = "pitchstaff.theme";

function loadHistory() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

function saveHistory(h) {
  try {
    localStorage.setItem(KEY, JSON.stringify(h));
  } catch (e) {}
}

/* ---------- staff ---------- */

export function App() {
  const [tab, setTab] = useState("lessons");
  const [lessonFocus, setLessonFocus] = useState(false);
  const matchHook = useRef(null);
  const [matchTarget, setMatchTarget] = useState(null);
  const [matchStatus, setMatchStatus] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [handoff, setHandoff] = useState(null);
  const [lastTake, setLastTake] = useState(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [pickStay, setPickStay] = useState(false);
  // Karaoke starts with a mode: null (not chosen yet) | "solo" | "battle"
  const [karaMode, setKaraMode] = useState(null);
  const battleCtl = useBattle();
  const [focus, setFocus] = useState(null);

  const sendTake = useCallback((t) => {
    setHandoff(t);
    setTab("analyst");
    setVisited((v) => ({ ...v, analyst: true }));
    try {
      window.scrollTo(0, 0);
    } catch (e) {}
  }, []);
  const [, bumpSettings] = useState(0);
  const [visited, setVisited] = useState({ lessons: true });
  // the acapella is shared by Practice, Karaoke and the Singing Analyst
  const [vocal, setVocal] = useState(null);
  const vocalJob = useRef(0);
  // the original files, kept so a battle partner can be sent this song
  const vocalFile = useRef(null),
    musicFile = useRef(null);
  // for My songs: which vocal the loaded music belongs with, and the file a split came from
  const musicFor = useRef(null),
    splitSrc = useRef(null);
  // a song received from a battle partner: { vocalName, lyrics, sync, from }, only for that battle
  const shared = useRef(null);
  const pickVocal = useCallback(async (file, preset) => {
    const job = ++vocalJob.current;
    vocalFile.current = file;
    setVocal({ name: file.name, busy: true, progress: 0 });
    let buffer;
    try {
      buffer = await decodeFile(file);
    } catch (e) {
      if (vocalJob.current === job)
        setVocal({
          name: file.name,
          error: "That file couldn't be read as audio. Try an MP3, M4A or WAV.",
        });
      return;
    }
    const data = await trackPitch(
      buffer,
      (pr) => {
        if (vocalJob.current === job)
          setVocal((v) => (v ? { ...v, progress: pr } : v));
      },
      () => vocalJob.current !== job,
    );
    if (!data || vocalJob.current !== job) return;
    // a shared song comes with the notes its owner's phone found, so both phones score alike
    data.notes =
      preset && preset.notes ? preset.notes : snapToKey(data.notes, data.grid);
    if (!SETTINGS.ai || (preset && preset.notes)) {
      setVocal({ name: file.name, buffer, data });
      return;
    }
    const cached = aiCacheGet(file.name, buffer.duration);
    if (cached && cached.length) {
      setVocal({
        name: file.name,
        buffer,
        data: { ...data, notes: cached, ai: true },
        ai: "done",
      });
      return;
    }
    setVocal({ name: file.name, buffer, data, ai: 0 });
    try {
      const notes = await aiNotes(buffer, data, (p) => {
        if (vocalJob.current === job)
          setVocal((v) =>
            v && v.name === file.name && typeof v.ai === "number"
              ? { ...v, ai: p }
              : v,
          );
      });
      if (vocalJob.current !== job) return;
      if (notes.length >= data.notes.length) {
        aiCachePut(file.name, buffer.duration, notes);
        setVocal((v) =>
          v && v.name === file.name
            ? { ...v, data: { ...v.data, notes, ai: true }, ai: "done" }
            : v,
        );
      } else
        setVocal((v) => (v && v.name === file.name ? { ...v, ai: "skip" } : v));
    } catch (e) {
      if (vocalJob.current === job)
        setVocal((v) =>
          v && v.name === file.name ? { ...v, ai: "failed" } : v,
        );
    }
  }, []);
  const vocalName = vocal && vocal.data ? vocal.name : null;
  const [vocalLyrics, setVocalLyrics] = useState(null);
  useEffect(() => {
    if (!vocalName) {
      setVocalLyrics(null);
      return;
    }
    if (shared.current && shared.current.vocalName === vocalName) {
      setVocalLyrics(shared.current.lyrics || null);
      return;
    }
    const saved = loadLyricsStore()[vocalName];
    setVocalLyrics(saved && Array.isArray(saved.lines) ? saved : null);
  }, [vocalName]);
  const updateVocalLyrics = useCallback(
    (next) => {
      setVocalLyrics(next);
      if (vocalName) saveLyricsFor(vocalName, next);
    },
    [vocalName],
  );
  // an UltraStar chart brings exact notes for every syllable: use them instead of the detected ones
  const vocalEff = useMemo(() => {
    if (!vocal || !vocal.data || !vocalLyrics) return vocal;
    if (!vocalLyrics.us) {
      // timed lyrics: use each line's syllable count to find missing notes and drop blips
      const sp = lyricSpans(vocalLyrics, vocal.data.duration);
      if (!sp.length) return vocal;
      return {
        ...vocal,
        data: {
          ...vocal.data,
          notes: guideBySyllables(
            vocal.data.notes,
            vocal.data,
            sp,
            looksTagalog(sp),
          ),
          guided: true,
        },
      };
    }
    const ns = usNotesFor(vocalLyrics, vocal.data);
    return ns && ns.length
      ? { ...vocal, data: { ...vocal.data, notes: ns, chart: true } }
      : vocal;
  }, [vocal, vocalLyrics]);
  // the instrumental is shared by Karaoke and the Singing Analyst, with its timing saved per song
  const [music, setMusic] = useState(null);
  const musicJob = useRef(0);
  const pickMusic = useCallback(async (file) => {
    const job = ++musicJob.current;
    musicFile.current = file;
    musicFor.current = vocalFile.current ? fileKey(vocalFile.current) : null;
    setMusic({ name: file.name, busy: true });
    let buffer;
    try {
      buffer = await decodeFile(file);
    } catch (e) {
      if (musicJob.current === job)
        setMusic({
          name: file.name,
          error: "That file couldn't be read as audio. Try an MP3, M4A or WAV.",
        });
      return;
    }
    const onset = onsetEnvelope(buffer);
    const chroma = await chromaOf(buffer, () => musicJob.current !== job);
    if (musicJob.current !== job) return;
    setMusic({ name: file.name, buffer, onset, chroma });
  }, []);
  const [msync, setMsync] = useState({ sync: 0, msg: "", keyWarn: 0 });
  const saveMusicSync = useCallback(
    (v, msg) => {
      setMsync((x) => ({ ...x, sync: v, msg: msg || "" }));
      if (vocalName && music && music.buffer) {
        const all = loadJSON(KARA_SYNC_KEY, {});
        const old = all[vocalName];
        all[vocalName] = {
          ...(old && old.inst === music.name ? old : {}),
          inst: music.name,
          sync: v,
        };
        saveJSON(KARA_SYNC_KEY, all);
      }
    },
    [vocalName, music],
  );
  const autoMusicSync = useCallback(() => {
    if (!vocal || !vocal.buffer || !music || !music.onset) return;
    const r = autoSync(onsetEnvelope(vocal.buffer), music.onset);
    if (r.z >= 6)
      saveMusicSync(
        Math.round(r.off * 100) / 100,
        "Lined up automatically. Use Check timing to confirm by ear.",
      );
    else
      saveMusicSync(
        0,
        "Couldn't line them up automatically. Use Check timing and the nudge buttons.",
      );
  }, [vocal, music, saveMusicSync]);
  useEffect(() => {
    if (!vocal || !vocal.data || !music || !music.buffer) return;
    if (shared.current && shared.current.vocalName === vocal.name) {
      setMsync((x) => ({
        ...x,
        keyWarn: 0,
        sync: shared.current.sync || 0,
        msg: "Using " + shared.current.from + "'s timing for this song.",
      }));
      return;
    }
    const saved = loadJSON(KARA_SYNC_KEY, {})[vocal.name];
    // a song Tono split itself can't be in two keys, so skip the clash check there
    const sameSource = saved && saved.split && saved.inst === music.name;
    setMsync((x) => ({
      ...x,
      keyWarn:
        music.chroma && !sameSource
          ? keyGap(vocal.data.notes, music.chroma)
          : 0,
    }));
    if (saved && saved.inst === music.name)
      setMsync((x) => ({
        ...x,
        sync: saved.sync,
        msg: sameSource
          ? "Split from the same song, so already in time."
          : "Using the timing you saved for this song.",
      }));
    else autoMusicSync();
  }, [vocal, music]);
  const [sampleName, setSampleName] = useState(null);
  const loadSample = useCallback(
    async ({ name, vocal: vf, inst: inf, lyricText, lyricName }) => {
      if (lyricText) {
        const lines = parseLrc(lyricText);
        if (lines.filter((l) => l.text).length)
          saveLyricsFor(vf.name, {
            name: lyricName,
            lines,
            offset: (loadLyricsStore()[vf.name] || {}).offset || 0,
          });
      }
      setSampleName(name);
      const jobs = [pickVocal(vf)];
      if (inf) jobs.push(pickMusic(inf));
      await Promise.all(jobs);
    },
    [pickVocal, pickMusic],
  );
  // a song from your battle partner: load it like a picked song, but don't keep anything about it
  const applySharedSong = useCallback(
    async ({ title, vocal: vf, music: mf, notes, lyrics, sync }) => {
      const from =
        (battleCtl.state &&
          battleCtl.state.peer &&
          battleCtl.state.peer.name) ||
        "your friend";
      shared.current = { vocalName: vf.name, lyrics, sync, from };
      setPickStay(false);
      setSampleName(title || null);
      setMusic(null);
      const jobs = [pickVocal(vf, { notes })];
      if (mf) jobs.push(pickMusic(mf));
      await Promise.all(jobs);
    },
    [pickVocal, pickMusic, battleCtl.state],
  );
  battleCtl.setOnSongReceived(applySharedSong);
  // when the battle ends, a shared song goes with it
  const inBattleRoom = !!battleCtl.state;
  useEffect(() => {
    if (inBattleRoom || !shared.current) return;
    shared.current = null;
    vocalJob.current++;
    musicJob.current++;
    vocalFile.current = null;
    musicFile.current = null;
    setVocal(null);
    setMusic(null);
    setSampleName(null);
  }, [inBattleRoom]);
  // load a song from My songs (its lyrics and timing come back from where they're saved)
  const loadSaved = useCallback(
    async (rec) => {
      splitSrc.current = null;
      setSampleName(null);
      setPickStay(false);
      touchSong(rec.id).catch(() => {});
      if (!rec.music) setMusic(null);
      const jobs = [pickVocal(rec.vocal)];
      if (rec.music) jobs.push(pickMusic(rec.music));
      await Promise.all(jobs);
    },
    [pickVocal, pickMusic],
  );
  // keep every loaded song in My songs, except samples (built in) and a battle partner's song
  useEffect(() => {
    const vf = vocalFile.current;
    if (!vocal || !vocal.data || !vf || sampleName || shared.current) return;
    const id = fileKey(vf);
    const mf =
      music && music.buffer && musicFor.current === id
        ? musicFile.current
        : null;
    saveSong({
      id,
      title: songTitle(null, vocal),
      vocal: vf,
      music: mf,
      src: splitSrc.current,
    }).catch(() => {});
  }, [vocal && vocal.data, music && music.buffer]);
  const [canSplit, setCanSplit] = useState(false);
  useEffect(() => {
    canSplitSongs().then(setCanSplit);
  }, []);
  const [split, setSplit] = useState(null);
  const splitJob = useRef(0);
  const onSplit = useCallback(
    async (file) => {
      const job = ++splitJob.current,
        base = file.name.replace(/\.[^.]+$/, "");
      setSplit({ name: file.name, stage: "decode", p: 0 });
      try {
        // split this exact file before? then there's nothing to wait for
        const saved = await findSplit(file).catch(() => null);
        if (splitJob.current !== job) return;
        let vf, mf;
        if (saved) {
          vf = saved.vocal;
          mf = saved.music;
        } else {
          const r = await splitSong(file, (st) => {
            if (splitJob.current === job)
              setSplit((x) => ({
                ...x,
                ...st,
                t0:
                  st.stage === "split" && !(x && x.stage === "split")
                    ? Date.now()
                    : x && x.t0,
              }));
          });
          if (splitJob.current !== job) return;
          vf = wavFile(r.vocals, r.sr, base + ".wav");
          mf = wavFile(r.inst, r.sr, base + " (music).wav");
        }
        // both halves come from the same file, so they are already in time
        const all = loadJSON(KARA_SYNC_KEY, {});
        all[vf.name] = { inst: mf.name, sync: 0, split: true };
        saveJSON(KARA_SYNC_KEY, all);
        setSplit({
          name: file.name,
          done: true,
          fromSaved: !!saved,
          base,
          files: { vocal: vf, music: mf },
        });
        setSampleName(null);
        setPickStay(true);
        splitSrc.current = fileKey(file);
        if (saved) touchSong(saved.id).catch(() => {});
        await Promise.all([pickVocal(vf), pickMusic(mf)]);
      } catch (e) {
        if (splitJob.current !== job) return;
        setSplit(
          e.message === "cancelled"
            ? null
            : {
                name: file.name,
                error:
                  (e && e.name === "EncodingError"
                    ? "That file couldn't be read as audio."
                    : "Couldn't split this song: " + (e.message || e)) +
                  " You can upload the vocal and music separately below.",
              },
        );
      }
    },
    [pickVocal, pickMusic],
  );
  const onCancelSplit = useCallback(() => {
    splitJob.current++;
    cancelSplit();
    setSplit(null);
  }, []);
  const musicProps = {
    inst: music,
    onPickInst: pickMusic,
    sync: msync.sync,
    syncMsg: msync.msg,
    keyWarn: msync.keyWarn,
    onSync: saveMusicSync,
    onAutoSync: autoMusicSync,
  };
  const [mode, setMode] = useState("idle"); // idle | mic | file
  const [error, setError] = useState("");
  const [recording, setRecording] = useState(false);
  const [live, setLive] = useState(null); // { midi, freq, cents }
  const [level, setLevel] = useState(0);
  const [trail, setTrail] = useState([]);
  const [history, setHistory] = useState(loadHistory);
  const [confirmClear, setConfirmClear] = useState(false);
  const [copyMsg, setCopyMsg] = useState("");
  const [fileName, setFileName] = useState("");
  const [progress, setProgress] = useState(0);
  const [fileResult, setFileResult] = useState("");
  const [song, setSong] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [playPos, setPlayPos] = useState(0);
  const songRef = useRef(null),
    playRef = useRef({
      ctx: null,
      src: null,
      startAt: 0,
      offset: 0,
      raf: 0,
      idx: -2,
    });
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem(THEME_KEY) || "";
    } catch (e) {
      return "";
    }
  });

  const ctxRef = useRef(null),
    streamRef = useRef(null),
    srcRef = useRef(null),
    rafRef = useRef(0),
    cancelRef = useRef(false);
  const recRef = useRef(recording);
  const fileInput = useRef(null);
  useEffect(() => {
    recRef.current = recording;
  }, [recording]);
  useEffect(() => {
    saveHistory(history);
  }, [history]);
  useEffect(() => {
    if (theme) document.documentElement.setAttribute("data-theme", theme);
    else document.documentElement.removeAttribute("data-theme");
    try {
      theme
        ? localStorage.setItem(THEME_KEY, theme)
        : localStorage.removeItem(THEME_KEY);
    } catch (e) {}
  }, [theme]);

  const confirmNote = useCallback((midi, freq, cents) => {
    const id = Date.now() + "-" + Math.random().toString(36).slice(2, 7);
    setTrail((t) => [...t.slice(-11), { id, midi }]);
    if (recRef.current) {
      const entry = {
        id,
        t: Date.now(),
        note: midiInfo(midi).label,
        midi,
        freq: Math.round(freq * 10) / 10,
        cents,
      };
      setHistory((h) => [entry, ...h].slice(0, 500));
    }
  }, []);

  const pausePlayback = useCallback((reset) => {
    const p = playRef.current;
    cancelAnimationFrame(p.raf);
    if (p.src) {
      if (!reset && p.ctx)
        p.offset = Math.max(0, p.ctx.currentTime - p.startAt);
      p.src.onended = null;
      try {
        p.src.stop();
      } catch (e) {}
      p.src = null;
    }
    if (reset) p.offset = 0;
    p.idx = -2;
    setPlaying(false);
  }, []);

  const stopInput = useCallback(() => {
    cancelRef.current = true;
    cancelAnimationFrame(rafRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (srcRef.current) {
      try {
        srcRef.current.onended = null;
        srcRef.current.stop && srcRef.current.stop();
      } catch (e) {}
      srcRef.current = null;
    }
    if (ctxRef.current) {
      ctxRef.current.close().catch(() => {});
      ctxRef.current = null;
    }
    setMode("idle");
    setLive(null);
    setLevel(0);
  }, []);
  const stop = useCallback(() => {
    stopInput();
    pausePlayback(false);
  }, [stopInput, pausePlayback]);
  const goTab = useCallback(
    (k) => {
      if (k !== "live") stop();
      setTab(k);
      setVisited((v) => ({ ...v, [k]: true }));
      try {
        window.scrollTo(0, 0);
      } catch (e) {}
    },
    [stop],
  );
  const practiceRange = useCallback(
    (a, b, repeat) => {
      setFocus({ a, b, repeat: !!repeat, id: Date.now() });
      goTab("learn");
    },
    [goTab],
  );
  useEffect(() => stop, [stop]);

  // show the note sounding at song time ct, plus the notes before it
  const showAt = useCallback((ct) => {
    const p = playRef.current,
      s = songRef.current;
    if (!s) return;
    const notes = s.notes;
    let idx = -1;
    for (let i = 0; i < notes.length; i++) {
      if (notes[i].pos <= ct) idx = i;
      else break;
    }
    const cur = idx >= 0 && ct < notes[idx].end ? notes[idx] : null;
    const key = idx * 2 + (cur ? 1 : 0);
    if (key === p.idx) return;
    p.idx = key;
    const upto = cur ? idx : idx + 1;
    setTrail(
      notes
        .slice(Math.max(0, upto - 12), upto)
        .map((n) => ({ id: "s" + n.pos, midi: n.midi })),
    );
    setLive(cur ? { midi: cur.midi, freq: cur.freq, cents: cur.cents } : null);
  }, []);

  const playSong = useCallback(() => {
    const s = songRef.current;
    if (!s) return;
    stopInput();
    const p = playRef.current;
    if (!p.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      p.ctx = new Ctx();
    }
    const ctx = p.ctx;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    if (p.offset >= s.buffer.duration - 0.05) p.offset = 0;
    const src = ctx.createBufferSource();
    src.buffer = s.buffer;
    src.connect(ctx.destination);
    src.start(0, p.offset);
    p.src = src;
    p.startAt = ctx.currentTime - p.offset;
    p.idx = -2;
    src.onended = () => {
      if (p.src !== src) return;
      p.src = null;
      p.offset = 0;
      cancelAnimationFrame(p.raf);
      setPlaying(false);
      setPlayPos(s.buffer.duration);
      setLive(null);
    };
    setPlaying(true);
    const tick = () => {
      const ct = Math.min(s.buffer.duration, ctx.currentTime - p.startAt);
      setPlayPos(ct);
      showAt(ct);
      p.raf = requestAnimationFrame(tick);
    };
    tick();
  }, [showAt, stopInput]);

  const seek = (v) => {
    const wasPlaying = playing;
    pausePlayback(false);
    playRef.current.offset = v;
    setPlayPos(v);
    showAt(v);
    if (wasPlaying) playSong();
  };

  const runLoop = useCallback(
    (ctx, analyser) => {
      const buf = new Float32Array(analyser.fftSize);
      let cand = { midi: null, since: 0 };
      let confirmed = null;
      let silentSince = 0;
      const recent = [];
      const tick = () => {
        analyser.getFloatTimeDomainData(buf);
        const r = detectPitch(buf, ctx.sampleRate, micGate());
        const now = performance.now();
        if (matchHook.current)
          matchHook.current(
            r.freq > 0 ? 69 + 12 * Math.log2(r.freq / SETTINGS.a4) : null,
            now,
          );
        setLevel(Math.min(1, r.rms * 6));
        if (r.freq > 0) {
          silentSince = 0;
          recent.push(r.freq);
          if (recent.length > 5) recent.shift();
          const med = [...recent].sort((a, b) => a - b)[
            Math.floor(recent.length / 2)
          ];
          const { midi, cents } = freqToMidi(med);
          if (midi !== cand.midi) cand = { midi, since: now };
          if (now - cand.since >= 150) {
            setLive({ midi, freq: med, cents });
            if (confirmed !== midi) {
              confirmed = midi;
              confirmNote(midi, med, cents);
            }
          }
        } else {
          if (!silentSince) silentSince = now;
          if (now - silentSince > 120) {
            confirmed = null;
            cand = { midi: null, since: 0 };
            recent.length = 0;
            setLive(null);
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    },
    [confirmNote],
  );

  const startMic = useCallback(async () => {
    setError("");
    stop();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError(
        "This browser can't reach a microphone here. Open the page file in Chrome, Edge or Safari, or analyze an audio file instead.",
      );
      return;
    }
    try {
      const stream = await getMicStream();
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      src.connect(analyser);
      ctxRef.current = ctx;
      streamRef.current = stream;
      setMode("mic");
      runLoop(ctx, analyser);
    } catch (e) {
      setError(
        "The microphone is blocked on this page. Download the page file and open it in your browser to use the mic, or analyze an audio file below.",
      );
    }
  }, [stop, runLoop]);

  const onFile = useCallback(
    async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      setError("");
      setFileResult("");
      stop();
      songRef.current = null;
      setSong(null);
      setPlayPos(0);
      playRef.current.offset = 0;
      cancelRef.current = false;
      setFileName(file.name);
      setMode("file");
      setProgress(0);
      let audio;
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        const ctx = new Ctx();
        const ab = await file.arrayBuffer();
        audio = await new Promise((res, rej) => {
          const p = ctx.decodeAudioData(ab, res, rej);
          if (p && p.then) p.then(res, rej);
        });
        if (ctx.close) ctx.close().catch(() => {});
      } catch (err) {
        setMode("idle");
        setError(
          "That file couldn't be read as audio. Try an MP3, M4A or WAV.",
        );
        return;
      }
      // mix to mono, then halve the sample rate so analysis stays fast on phones
      let data = audio.getChannelData(0);
      if (audio.numberOfChannels > 1) {
        const r = audio.getChannelData(1),
          m = new Float32Array(data.length);
        for (let i = 0; i < data.length; i++) m[i] = (data[i] + r[i]) / 2;
        data = m;
      }
      let sr = audio.sampleRate;
      if (sr >= 44100) {
        const h = new Float32Array(Math.floor(data.length / 2));
        for (let i = 0; i < h.length; i++)
          h[i] = (data[2 * i] + data[2 * i + 1]) / 2;
        data = h;
        sr = sr / 2;
      }
      const N = 1024,
        hop = 512,
        total = Math.max(1, Math.floor((data.length - N) / hop));
      const found = [];
      let cand = { midi: null, since: 0 },
        confirmed = null,
        silentSince = -1;
      const recent = [];
      for (let f = 0; f < total; f++) {
        if (cancelRef.current) return;
        const t = (f * hop) / sr;
        const r = detectPitch(data.subarray(f * hop, f * hop + N), sr);
        if (r.freq > 0) {
          silentSince = -1;
          recent.push(r.freq);
          if (recent.length > 5) recent.shift();
          const med = [...recent].sort((a, b) => a - b)[
            Math.floor(recent.length / 2)
          ];
          const { midi, cents } = freqToMidi(med);
          if (midi !== cand.midi) cand = { midi, since: t };
          if (t - cand.since >= 0.15 && confirmed !== midi) {
            if (found.length && found[found.length - 1].end == null)
              found[found.length - 1].end = cand.since;
            confirmed = midi;
            found.push({
              midi,
              freq: med,
              cents,
              pos: cand.since,
              end: null,
            });
          }
        } else {
          if (silentSince < 0) silentSince = t;
          if (t - silentSince > 0.12) {
            if (
              confirmed !== null &&
              found.length &&
              found[found.length - 1].end == null
            )
              found[found.length - 1].end = silentSince;
            confirmed = null;
            cand = { midi: null, since: 0 };
            recent.length = 0;
          }
        }
        if (f % 150 === 0) {
          setProgress(f / total);
          await new Promise((res) => setTimeout(res, 0));
        }
      }
      if (found.length && found[found.length - 1].end == null)
        found[found.length - 1].end = data.length / sr;
      songRef.current = { buffer: audio, notes: found };
      setSong({ name: file.name, duration: audio.duration });
      const now = Date.now();
      const entries = found.map((n, i) => ({
        id: now + "-" + i,
        t: now,
        note: midiInfo(n.midi).label,
        midi: n.midi,
        freq: Math.round(n.freq * 10) / 10,
        cents: n.cents,
        pos: Math.round(n.pos * 10) / 10,
        src: file.name,
      }));
      setTrail(entries.slice(-12).map((x) => ({ id: x.id, midi: x.midi })));
      if (recRef.current && entries.length)
        setHistory((h) => [...[...entries].reverse(), ...h].slice(0, 500));
      setProgress(1);
      setMode("idle");
      setFileResult(
        entries.length
          ? "Found " +
              entries.length +
              " notes in " +
              file.name +
              (recRef.current ? " and saved them to the log." : ".") +
              " Tap Play to hear it with the notes on the staff."
          : "No clear single notes found in " +
              file.name +
              ". Clips with one voice or instrument work best.",
      );
    },
    [stop],
  );

  const counts = useMemo(() => {
    const m = {};
    history.forEach((h) => {
      m[h.note] = (m[h.note] || 0) + 1;
    });
    return Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [history]);

  const flash = (msg) => {
    setCopyMsg(msg);
    setTimeout(() => setCopyMsg(""), 2600);
  };

  const buildText = () => {
    const list = [...history].reverse();
    const when = (h) =>
      h.pos != null
        ? "at " + fmt(h.pos) + " (" + h.src + ")"
        : new Date(h.t).toLocaleString([], {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
            second: "2-digit",
          });
    const lines = [
      "Tono - note log",
      "Exported " +
        new Date().toLocaleString([], {
          dateStyle: "medium",
          timeStyle: "short",
        }),
      list.length + " notes",
      "",
      "Sequence:",
      list.map((h) => h.note).join(" "),
      "",
      "#".padEnd(5) +
        "Note".padEnd(7) +
        "When".padEnd(34) +
        "Freq (Hz)".padEnd(11) +
        "Cents",
    ];
    list.forEach((h, i) => {
      lines.push(
        String(i + 1).padEnd(5) +
          h.note.padEnd(7) +
          when(h).padEnd(34) +
          h.freq.toFixed(1).padEnd(11) +
          (h.cents > 0 ? "+" : "") +
          h.cents,
      );
    });
    return lines.join("\n") + "\n";
  };

  const exportTxt = async () => {
    if (!history.length) return;
    const text = buildText();
    const filename =
      "pitch-staff-notes-" + new Date().toISOString().slice(0, 10) + ".txt";
    let dl = null;
    try {
      dl =
        window.claude && window.claude.use
          ? await window.claude.use("downloads")
          : null;
    } catch (e) {
      dl = null;
    }
    if (dl) {
      try {
        await dl.save({ filename, data: text });
        flash("Exported " + filename);
      } catch (e) {
        flash(
          e && e.code === "declined"
            ? "Export cancelled"
            : e && e.code === "rate_limited"
              ? "One moment, then try again"
              : "Export isn't available in this view",
        );
      }
      return;
    }
    // opened as a plain file in a browser: use a normal download
    try {
      const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      flash("Exported " + filename);
    } catch (e) {
      flash("Export isn't available in this view");
    }
  };

  const copySequence = () => {
    const seq = [...history]
      .reverse()
      .map((h) => h.note)
      .join(" ");
    if (!seq) return;
    const done = (msg) => {
      setCopyMsg(msg);
      setTimeout(() => setCopyMsg(""), 2200);
    };
    try {
      navigator.clipboard.writeText(seq).then(
        () => done("Copied " + history.length + " notes"),
        () => done("Copy blocked here"),
      );
    } catch (e) {
      done("Copy blocked here");
    }
  };

  const info = live ? midiInfo(live.midi) : null;
  const tuneColor = !live
    ? "var(--muted)"
    : Math.abs(live.cents) <= 10
      ? "var(--good)"
      : Math.abs(live.cents) <= 25
        ? "var(--warn)"
        : "var(--bad)";
  const isDark = theme
    ? theme === "dark"
    : !window.matchMedia("(prefers-color-scheme: light)").matches;
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("kara", tab === "karaoke");
  }, [tab]);
  const running = mode !== "idle";
  const showExample = !running && trail.length === 0;
  const tm =
    matchTarget && matchStatus && matchStatus.midi === matchTarget.midi
      ? matchStatus
      : null;

  const songReady = !!(vocal && vocal.data);
  const songNeeded = tab !== "live" && tab !== "lessons";
  const showPick = songNeeded && (!songReady || pickStay);
  const lyricsReady = !!(
    vocalLyrics &&
    vocalLyrics.lines &&
    vocalLyrics.lines.length
  );
  const pickSetup = (
    <SongSetup
      vocal={vocalEff}
      music={music}
      lyricsEntry={vocalLyrics}
      updateLyrics={updateVocalLyrics}
      onPickVocal={(f) => {
        setPickStay(true);
        setSampleName(null);
        splitSrc.current = null;
        pickVocal(f);
      }}
      onLoadSaved={loadSaved}
      savedCurrent={
        vocalFile.current && songReady ? fileKey(vocalFile.current) : null
      }
      onPickMusic={pickMusic}
      onLoadSample={loadSample}
      canSplit={canSplit}
      split={split}
      onSplit={onSplit}
      onCancelSplit={onCancelSplit}
      sampleName={sampleName}
      sync={msync.sync}
      onSync={saveMusicSync}
      onAutoSync={autoMusicSync}
      syncMsg={msync.msg}
      keyWarn={msync.keyWarn}
      onDone={() => setPickStay(false)}
      onContinue={() => setPickStay(false)}
    />
  );
  // tell a battle partner which song this phone has, as soon as it's loaded
  const battleSong = {
    song: songReady ? songTitle(sampleName, vocal) : "",
    dur: songReady ? Math.round(vocal.data.duration * 10) / 10 : 0,
  };
  // what this phone can send a battle partner: the original files plus what it worked out
  battleCtl.setShareSource(() =>
    vocalFile.current && vocal && vocal.data
      ? {
          title: songTitle(sampleName, vocal),
          vocal: vocalFile.current,
          music: music && music.buffer ? musicFile.current : null,
          notes: vocal.data.notes,
          lyrics: vocalLyrics,
          sync: msync.sync,
        }
      : null,
  );
  useEffect(() => {
    battleCtl.setSong(battleSong.song, battleSong.dur);
  }, [
    battleSong.song,
    battleSong.dur,
    battleCtl.state && battleCtl.state.code,
  ]);
  // Karaoke screens that come before the song: pick a mode, then (for a battle) the room and lobby
  const karaScreen =
    tab !== "karaoke"
      ? null
      : !karaMode
        ? "mode"
        : karaMode === "battle" && !battleCtl.state
          ? "join"
          : karaMode === "battle" && !battleCtl.state.started
            ? "lobby"
            : null;
  return (
    <div className="wrap app-wrap flex flex-col gap-5">
      <header
        className="flex items-center justify-between gap-3"
        hidden={lessonFocus}
      >
        <div className="min-w-0">
          <h1 className="display text-3xl font-bold flex items-center gap-2">
            <img
              src="data:image/png;base64,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"
              alt=""
              width="34"
              height="34"
              style={{ width: "34px", height: "34px", flex: "none" }}
            />
            Tono
          </h1>
          <p
            className="muted text-sm"
            hidden={
              tab === "live" || tab === "lessons" || (songNeeded && songReady)
            }
          >
            {tab === "live"
              ? "Sing, whistle or play one clean note and see exactly which note it is."
              : tab === "learn"
                ? "Learn a song's melody note by note, one phrase at a time."
                : tab === "karaoke"
                  ? "Sing along to the music with scrolling lyrics and a live score."
                  : "Compare your singing with the original vocal, phrase by phrase."}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="icon-btn"
            onClick={() => setShowSettings((v) => !v)}
            aria-expanded={showSettings ? "true" : "false"}
            aria-label="Settings"
          >
            <Icon name="gear" />
          </button>
          <button
            className="icon-btn"
            onClick={() => setTheme(isDark ? "light" : "dark")}
            aria-label={
              isDark ? "Switch to light theme" : "Switch to dark theme"
            }
          >
            <Icon name={isDark ? "sun" : "moon"} />
          </button>
        </div>
      </header>
      {showSettings && (
        <SettingsPanel
          listening={mode === "mic"}
          level={level}
          onClose={() => setShowSettings(false)}
          onChange={() => bumpSettings((n) => n + 1)}
          onMicChange={() => {
            if (mode === "mic") startMic();
          }}
        />
      )}
      <nav className="bottom-nav" aria-label="Main" hidden={lessonFocus}>
        {[
          ["lessons", "Lessons", "cap"],
          ["live", "Tuner", "gauge"],
          ["learn", "Practice", "music"],
          ["karaoke", "Karaoke", "mic"],
          ["analyst", "Analyze", "chart"],
        ].map(([k, l, ic]) => (
          <button
            key={k}
            aria-current={tab === k ? "page" : undefined}
            onClick={() => goTab(k)}
          >
            <span className="nav-ico">
              <Icon name={ic} size={22} />
            </span>
            {l}
          </button>
        ))}
      </nav>
      {songNeeded && !showPick && !karaScreen && (
        <div className="song-bar">
          <span className="song-ico">
            <Icon name="music" />
          </span>
          <span className="flex flex-col min-w-0" style={{ flex: 1 }}>
            <span
              className="display font-bold text-lg"
              style={{ overflowWrap: "anywhere", lineHeight: 1.2 }}
            >
              {songTitle(sampleName, vocal)}
            </span>
            <span className="text-xs muted">
              Vocal{music && music.buffer ? " · Music" : ""}
              {lyricsReady ? " · Lyrics" : ""}
              {music && music.busy ? " · loading music…" : ""}
              {vocal && typeof vocal.ai === "number"
                ? " · improving notes with AI " +
                  Math.round(vocal.ai * 100) +
                  "%"
                : vocal && vocal.ai === "done"
                  ? " · AI notes ✓"
                  : ""}
            </span>
          </span>
          <button
            className="btn"
            style={{ padding: "7px 14px", fontSize: 13 }}
            onClick={() => setSetupOpen(true)}
          >
            Change
          </button>
        </div>
      )}
      {karaScreen === "mode" && (
        <KaraokeModePick
          onSolo={() => setKaraMode("solo")}
          onBattle={() => setKaraMode("battle")}
        />
      )}
      {karaScreen === "join" && (
        <BattleJoin ctl={battleCtl} onBack={() => setKaraMode(null)} />
      )}
      {karaScreen === "lobby" && (
        <BattleLobby
          ctl={battleCtl}
          mySong={battleSong}
          preparing={
            !!(
              battleCtl.state &&
              battleCtl.state.recv &&
              battleCtl.state.recv.done &&
              !songReady
            )
          }
          prepPct={vocal && vocal.busy ? vocal.progress : null}
          picker={pickSetup}
          onChangeSong={() => setPickStay(true)}
        />
      )}
      {tab === "karaoke" && karaMode === "solo" && (
        <button
          className="btn btn-ghost"
          style={{ alignSelf: "flex-start", padding: "4px 8px", fontSize: 13 }}
          onClick={() => setKaraMode(null)}
        >
          <span className="flex items-center gap-1">
            <Icon name="back" size={16} />
            Modes
          </span>
        </button>
      )}
      {showPick && !karaScreen && (
        <section className="flex flex-col gap-5">
          <div className="empty-hero">
            <h2
              className="display text-3xl font-bold"
              style={{ letterSpacing: "-0.02em" }}
            >
              Pick a song
            </h2>
            <p className="muted text-sm">
              Practice, Karaoke and the Analyst all use the song you pick here.
            </p>
            {vocal && vocal.busy && (
              <p className="text-sm" style={{ color: "var(--accent)" }}>
                Analyzing {vocal.name}…{" "}
                {Math.round((vocal.progress || 0) * 100)}%
              </p>
            )}
          </div>
          {pickSetup}
        </section>
      )}
      <Sheet open={setupOpen} title="Song" onClose={() => setSetupOpen(false)}>
        <SongSetup
          vocal={vocalEff}
          music={music}
          lyricsEntry={vocalLyrics}
          updateLyrics={updateVocalLyrics}
          onPickVocal={(f) => {
            setSampleName(null);
            pickVocal(f);
          }}
          onPickMusic={pickMusic}
          onLoadSample={loadSample}
          canSplit={canSplit}
          split={split}
          onSplit={onSplit}
          onCancelSplit={onCancelSplit}
          sampleName={sampleName}
          sync={msync.sync}
          onSync={saveMusicSync}
          onAutoSync={autoMusicSync}
          syncMsg={msync.msg}
          keyWarn={msync.keyWarn}
          onDone={() => setSetupOpen(false)}
        />
      </Sheet>
      {tab === "lessons" && (
        <Lessons
          active={tab === "lessons"}
          onGo={goTab}
          onFocus={setLessonFocus}
        />
      )}
      {tab === "live" && (
        <MatchTrainer
          hookRef={matchHook}
          listening={mode === "mic"}
          onStartMic={startMic}
          onStopMic={stop}
          onTarget={setMatchTarget}
          onStatus={setMatchStatus}
          sung={live ? live.midi : null}
          live={live}
          level={level}
          error={error}
        />
      )}
      <div hidden={tab !== "learn" || showPick}>
        {visited.learn && (
          <Learn
            themeKey={isDark ? "dark" : "light"}
            active={tab === "learn"}
            orig={vocalEff}
            onPickOrig={pickVocal}
            lyrics={vocalLyrics}
            updateLyrics={updateVocalLyrics}
            focus={focus}
            onGo={goTab}
            inst={music}
            sync={msync.sync}
          />
        )}
      </div>
      <div hidden={tab !== "karaoke" || showPick || !!karaScreen}>
        {visited.karaoke && (
          <Karaoke
            themeKey={tab === "karaoke" ? "kara" : isDark ? "dark" : "light"}
            active={tab === "karaoke"}
            orig={vocalEff}
            onPickOrig={pickVocal}
            lyrics={vocalLyrics}
            updateLyrics={updateVocalLyrics}
            onSendTake={sendTake}
            onTakeReady={setLastTake}
            onPractice={practiceRange}
            {...musicProps}
            battleCtl={karaMode === "battle" ? battleCtl : null}
          />
        )}
      </div>
      <div hidden={tab !== "analyst" || showPick}>
        {visited.analyst && (
          <Analyst
            themeKey={isDark ? "dark" : "light"}
            active={tab === "analyst"}
            orig={vocalEff}
            onPickOrig={pickVocal}
            lyrics={vocalLyrics}
            updateLyrics={updateVocalLyrics}
            incomingTake={handoff}
            lastTake={lastTake}
            onUseTake={(t) => setHandoff({ ...t, id: Date.now() })}
            onPractice={practiceRange}
            onGo={goTab}
            {...musicProps}
          />
        )}
      </div>
    </div>
  );
}

// State for a live battle with a friend: the room, who's in it, which song each of you has
// loaded, and the friend's line scores. Lives in App so the lobby can come before the song.
import { useCallback, useEffect, useRef, useState } from "react";
import { joinRoom, makeCode } from "../../lib/battleNet.js";
import { loadJSON, saveJSON } from "../../lib/storage.js";
import {
  CHUNK,
  CHUNK_GAP_MS,
  chunkCount,
  fromB64,
  packFile,
  toB64,
} from "../../lib/songShare.js";

// state: { code, host, status, peer: { name, host, song, dur, ready } | null, lastName,
//          started, round, synced, lines: { lineIndex: friend's score },
//          paused: { by: "me" | "peer", pos } | null,
//          stopReq: { by: "me" | "peer", pos, until } | null,
//          peerFinal: { bestCombo } | null, again: { me, peer } | null,
//          sending: { pct } | null (sharing your song), recv: { pct, done, error } | null,
//          theirClips: { lineIndex: { sr, pcm: Int16Array } } (their voice for the highlights),
//          theirPhotos: [object URL] (their candid photos), cam: "ok" | "denied" | null } | null
export function useBattle() {
  const [state, setState] = useState(null);
  const [myName, setMyName] = useState(() => loadJSON("tono.battle.name", ""));
  // share my voice for the end-of-battle highlights (only sent to the other player, never saved)
  // candid photos of me while I sing, shown on the results (only to the other player, never saved)
  const [sharePhotos, setSharePhotosState] = useState(
    () => loadJSON("tono.battle.photos", true) !== false,
  );
  const [shareHL, setShareHLState] = useState(
    () => loadJSON("tono.battle.highlights", true) !== false,
  );
  const net = useRef(null);
  const me = useRef({
    name: "",
    host: false,
    song: "",
    dur: 0,
    ready: false,
    hl: true,
    ph: true,
  });
  // Karaoke registers its player here: prepare() (headphone check + unlock sound, from a tap),
  // setHpMode(mode) and start(atMs), so either phone can start the song at a shared moment
  const player = useRef(null);
  // how far the host's clock is ahead of this phone's (ms), measured with pings; 0 for the host
  const offset = useRef(0);
  const bestRtt = useRef(Infinity);
  const stopTimer = useRef(null);
  const again = useRef({ me: false, peer: false }); // who's tapped Rematch since the last start
  // song sharing: App tells us what this phone can share, and takes a song that arrives
  const shareSource = useRef(null); // () => { title, vocal: File, music: File | null, notes, lyrics, sync } | null
  const onReceived = useRef(null);
  const recv = useRef(null);
  const sendJob = useRef(0);
  const blobs = useRef({}); // small files arriving in chunks (highlight clips, photos): id -> { meta, parts, left }
  const photoUrls = useRef([]);
  const dropPhotos = () => {
    photoUrls.current.forEach((u) => URL.revokeObjectURL(u));
    photoUrls.current = [];
  };
  useEffect(() => () => net.current && net.current.leave(), []);
  // times sent between phones are on the host's clock
  const toHost = (local) => local + offset.current;
  const fromHost = (h) => h - offset.current;
  const send = (msg) => net.current && net.current.send(msg);
  const clearStopTimer = () => {
    clearTimeout(stopTimer.current);
    stopTimer.current = null;
  };
  // both phones pause at the same spot; resuming is a synced 3-2-1 from there
  const doPause = (pos, by) => {
    if (player.current) player.current.pause(pos);
    setState((b) => b && { ...b, paused: { by, pos } });
  };
  const doResume = (atLocal, pos) => {
    clearStopTimer();
    setState((b) => b && { ...b, paused: null, stopReq: null });
    if (player.current) player.current.resume(atLocal, pos);
  };
  const doFinish = () => {
    clearStopTimer();
    setState((b) => b && { ...b, paused: null, stopReq: null });
    if (player.current) player.current.finish();
  };
  const resumeAll = (pos) => {
    const at = Date.now() + 3000;
    send({ type: "resume", at: toHost(at), pos });
    doResume(at, pos);
  };
  // host: start both phones 3.5 s from now (time enough for the message to arrive)
  const startAll = () => {
    const at = Date.now() + 3500;
    send({ type: "start", at: toHost(at) });
    begin(at);
  };
  // rematch starts (from the host's phone) once both have tapped it
  const checkAgain = (host) => {
    const a = again.current;
    setState((b) => b && { ...b, again: { ...a } });
    if (host && a.me && a.peer) startAll();
  };
  // back to the lobby on both phones to pick another song (everyone gets ready again)
  const doLobby = () => {
    me.current = { ...me.current, ready: false };
    announce();
    setState(
      (b) =>
        b && {
          ...b,
          started: false,
          paused: null,
          stopReq: null,
          peerFinal: null,
          again: null,
          lines: {},
          theirClips: {},
          theirPhotos: [],
        },
    );
  };
  // ending needs the other singer's OK; no answer in 20 s ends it anyway
  const STOP_WAIT = 20000;
  const answerStop = (end, pos) => {
    if (end) {
      send({ type: "stopOk" });
      doFinish();
    } else {
      send({ type: "stopNo" });
      resumeAll(pos);
    }
  };

  // send your loaded song (files in chunks, plus the notes, lyrics and timing your phone worked out)
  const sendSong = async () => {
    const src = shareSource.current && shareSource.current();
    if (!src) return send({ type: "songNone" });
    const job = ++sendJob.current;
    setState((b) => b && { ...b, sending: { pct: 0 } });
    try {
      const files = [{ role: "vocal", ...(await packFile(src.vocal)) }];
      if (src.music)
        files.push({ role: "music", ...(await packFile(src.music)) });
      const total = files.reduce((a, f) => a + f.bytes.length, 0);
      let meta = {
        type: "songMeta",
        id: job,
        title: src.title,
        notes: src.notes,
        lyrics: src.lyrics,
        sync: src.sync,
        files: files.map((f) => ({
          role: f.role,
          name: f.name,
          type: f.type,
          size: f.bytes.length,
          n: chunkCount(f.bytes.length),
        })),
      };
      // keep the first message under the size limit: the other phone can work these out itself
      if (JSON.stringify(meta).length > 200000) meta = { ...meta, notes: null };
      if (JSON.stringify(meta).length > 200000)
        meta = { ...meta, lyrics: null };
      await send(meta);
      let sent = 0;
      for (const f of files)
        for (let i = 0; i < chunkCount(f.bytes.length); i++) {
          if (sendJob.current !== job || !net.current) return;
          const part = f.bytes.subarray(i * CHUNK, (i + 1) * CHUNK);
          await send({
            type: "chunk",
            id: job,
            role: f.role,
            i,
            d: toB64(part),
          });
          sent += part.length;
          setState(
            (b) =>
              b && { ...b, sending: { pct: Math.round((100 * sent) / total) } },
          );
          await new Promise((r) => setTimeout(r, CHUNK_GAP_MS));
        }
    } catch (e) {
      send({ type: "songFail" });
    }
    if (sendJob.current === job) setState((b) => b && { ...b, sending: null });
  };
  const gotMeta = (m) => {
    const parts = {};
    m.files.forEach((f) => (parts[f.role] = new Array(f.n)));
    recv.current = {
      id: m.id,
      meta: m,
      parts,
      got: 0,
      total: m.files.reduce((a, f) => a + f.size, 0),
      left: m.files.reduce((a, f) => a + f.n, 0), // chunks still to come
    };
    setState((b) => b && { ...b, recv: { pct: 0 } });
  };
  const gotChunk = (m) => {
    const r = recv.current;
    if (!r || r.id !== m.id || !r.parts[m.role] || r.parts[m.role][m.i]) return;
    const u = fromB64(m.d);
    r.parts[m.role][m.i] = u;
    r.got += u.length;
    r.left--;
    const done = r.left === 0;
    setState(
      (b) =>
        b && {
          ...b,
          recv: {
            pct: Math.min(100, Math.round((100 * r.got) / r.total)),
            done,
          },
        },
    );
    if (!done) return;
    const file = (role) => {
      const f = r.meta.files.find((x) => x.role === role);
      return f ? new File(r.parts[role], f.name, { type: f.type }) : null;
    };
    recv.current = null;
    const { title, notes, lyrics, sync } = r.meta;
    if (onReceived.current)
      onReceived.current({
        title,
        vocal: file("vocal"),
        music: file("music"),
        notes,
        lyrics,
        sync,
      });
  };

  // highlight clips: 16-bit mono PCM of your voice for one line, in chunks like a shared song
  const sendClip = async (line, sr, samples) => {
    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const v = Math.max(-1, Math.min(1, samples[i]));
      pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    await sendBlob("clip", { line, sr }, new Uint8Array(pcm.buffer));
  };
  const sendBlob = async (kind, meta, bytes) => {
    const n = chunkCount(bytes.length),
      id = Math.random().toString(36).slice(2);
    await send({ type: "blobMeta", id, kind, meta, n });
    for (let i = 0; i < n; i++) {
      if (!net.current) return;
      await send({
        type: "blobChunk",
        id,
        i,
        d: toB64(bytes.subarray(i * CHUNK, (i + 1) * CHUNK)),
      });
      await new Promise((r) => setTimeout(r, CHUNK_GAP_MS));
    }
  };
  const gotBlobMeta = (m) => {
    blobs.current[m.id] = {
      kind: m.kind,
      meta: m.meta,
      parts: new Array(m.n),
      left: m.n,
    };
  };
  const gotBlobChunk = (m) => {
    const b = blobs.current[m.id];
    if (!b || b.parts[m.i]) return;
    b.parts[m.i] = fromB64(m.d);
    if (--b.left) return;
    delete blobs.current[m.id];
    const len = b.parts.reduce((a, p) => a + p.length, 0),
      all = new Uint8Array(len);
    let o = 0;
    b.parts.forEach((p) => {
      all.set(p, o);
      o += p.length;
    });
    if (b.kind === "photo") {
      const url = URL.createObjectURL(new Blob([all], { type: "image/jpeg" }));
      photoUrls.current.push(url);
      setState(
        (s) => s && { ...s, theirPhotos: [...(s.theirPhotos || []), url] },
      );
    } else if (b.kind === "clip") {
      const pcm = new Int16Array(all.buffer, 0, len >> 1);
      setState(
        (s) =>
          s && {
            ...s,
            theirClips: {
              ...(s.theirClips || {}),
              [b.meta.line]: { sr: b.meta.sr, pcm },
            },
          },
      );
    }
  };

  // atLocal: the moment (this phone's clock, ms) the countdown should end and the music start
  const begin = useCallback((atLocal) => {
    again.current = { me: false, peer: false };
    blobs.current = {};
    dropPhotos();
    setState(
      (b) =>
        b && {
          ...b,
          started: true,
          paused: null,
          stopReq: null,
          peerFinal: null,
          again: null,
          lines: {},
          theirClips: {},
          theirPhotos: [],
          round: (b.round || 0) + 1,
        },
    );
    if (player.current) player.current.start(atLocal);
  }, []);

  const announce = () => net.current && net.current.update(me.current);

  const open = (code, host) => {
    if (net.current) net.current.leave();
    const name = myName.trim() || "Singer";
    saveJSON("tono.battle.name", name);
    me.current = {
      ...me.current,
      name,
      host,
      ready: false,
      hl: shareHL,
      ph: sharePhotos,
    };
    offset.current = 0;
    bestRtt.current = Infinity;
    setState({
      code,
      host,
      status: "connecting",
      peer: null,
      lastName: "",
      started: false,
      round: 0,
      lines: {},
      synced: host,
    });
    net.current = joinRoom(code, me.current, {
      onStatus: (status) => setState((b) => b && { ...b, status }),
      onPeer: (peer) =>
        setState(
          (b) => b && { ...b, peer, lastName: peer ? peer.name : b.lastName },
        ),
      onMessage: (m) => {
        if (m.type === "ping") {
          if (host && net.current)
            net.current.send({ type: "pong", t0: m.t0, t1: Date.now() });
        } else if (m.type === "pong") {
          // NTP-style: the host read its clock about halfway through the round trip
          const now = Date.now(),
            rtt = now - m.t0;
          if (rtt < bestRtt.current) {
            bestRtt.current = rtt;
            offset.current = m.t1 + rtt / 2 - now;
          }
          setState((b) => b && (b.synced ? b : { ...b, synced: true }));
        } else if (m.type === "start") begin(fromHost(m.at));
        else if (m.type === "pause") doPause(m.pos, "peer");
        else if (m.type === "resume") doResume(fromHost(m.at), m.pos);
        else if (m.type === "stopReq") {
          doPause(m.pos, "peer");
          clearStopTimer();
          setState(
            (b) =>
              b && {
                ...b,
                stopReq: {
                  by: "peer",
                  pos: m.pos,
                  until: Date.now() + STOP_WAIT,
                },
              },
          );
          stopTimer.current = setTimeout(() => answerStop(true), STOP_WAIT);
        } else if (m.type === "stopOk") doFinish();
        else if (m.type === "stopNo") {
          clearStopTimer();
          setState((b) => b && { ...b, stopReq: null });
        } else if (m.type === "final")
          setState((b) => b && { ...b, peerFinal: m.stats });
        else if (m.type === "again") {
          again.current = { ...again.current, peer: true };
          checkAgain(host);
        } else if (m.type === "lobby") doLobby();
        else if (m.type === "line")
          setState((b) => b && { ...b, lines: { ...b.lines, [m.i]: m.score } });
        else if (m.type === "songReq") sendSong();
        else if (m.type === "blobMeta") gotBlobMeta(m);
        else if (m.type === "blobChunk") gotBlobChunk(m);
        else if (m.type === "songMeta") gotMeta(m);
        else if (m.type === "chunk") gotChunk(m);
        else if (m.type === "songNone" || m.type === "songFail") {
          recv.current = null;
          setState((b) => b && { ...b, recv: { error: true } });
        }
      },
    });
  };

  // the guest measures its clock against the host's with a few pings once they're both in
  const peerIn = !!(state && state.peer && state.status === "connected");
  useEffect(() => {
    if (!peerIn || !state || state.host) return;
    const ids = [0, 1, 2, 3, 4, 5].map((k) =>
      setTimeout(
        () => net.current && net.current.send({ type: "ping", t0: Date.now() }),
        k * 250,
      ),
    );
    return () => ids.forEach(clearTimeout);
  }, [peerIn]);

  return {
    state,
    myName,
    setMyName,
    create: () => open(makeCode(), true),
    join: (code) => open(code, false),
    leave: () => {
      clearStopTimer();
      dropPhotos();
      sendJob.current++;
      recv.current = null;
      me.current = { ...me.current, ready: false };
      if (net.current) net.current.leave();
      net.current = null;
      setState(null);
    },
    // tell the other phone which song you have loaded (title + length in seconds)
    setSong: (song, dur) => {
      if (me.current.song === song && me.current.dur === dur) return;
      // a different song means getting ready again
      me.current = { ...me.current, song, dur, ready: false };
      announce();
    },
    // tap "I'm ready": the headphone check also unlocks sound on this phone, so the song can
    // start later from a network message. Resolves to the check's result.
    prepare: () =>
      player.current ? player.current.prepare() : Promise.resolve("nomic"),
    setHpMode: (mode) => player.current && player.current.setHpMode(mode),
    setReady: (ready) => {
      me.current = { ...me.current, ready };
      announce();
      setState((b) => b && { ...b });
    },
    isReady: () => me.current.ready,
    // host: start both phones 3.5 s from now (time enough for the message to arrive)
    start: startAll,
    // your end-of-song stats the other phone can't work out itself (line scores it already has)
    sendFinal: (stats) => send({ type: "final", stats }),
    rematch: () => {
      again.current = { ...again.current, me: true };
      send({ type: "again" });
      checkAgain(me.current.host);
    },
    newSong: () => {
      send({ type: "lobby" });
      doLobby();
    },
    pause: (pos) => {
      send({ type: "pause", pos });
      doPause(pos, "me");
    },
    resume: (pos) => resumeAll(pos),
    // ask to end: both pause, the friend confirms (or it ends by itself after 20 s)
    requestStop: (pos) => {
      if (!(state && state.peer)) return doFinish();
      send({ type: "stopReq", pos });
      doPause(pos, "me");
      clearStopTimer();
      setState(
        (b) =>
          b && {
            ...b,
            stopReq: { by: "me", pos, until: Date.now() + STOP_WAIT },
          },
      );
      // a little extra so the friend's own timeout (and its "end" message) lands first
      stopTimer.current = setTimeout(doFinish, STOP_WAIT + 3000);
    },
    answerStop,
    sendLine: (i, score) =>
      net.current && net.current.send({ type: "line", i, score }),
    resetLines: () =>
      setState((b) =>
        b && Object.keys(b.lines).length ? { ...b, lines: {} } : b,
      ),
    shareHL,
    setShareHL: (on) => {
      saveJSON("tono.battle.highlights", on);
      setShareHLState(on);
      me.current = { ...me.current, hl: on };
      announce();
    },
    sendClip,
    sharePhotos,
    setSharePhotos: (on) => {
      saveJSON("tono.battle.photos", on);
      setSharePhotosState(on);
      me.current = { ...me.current, ph: on };
      announce();
    },
    sendPhoto: async (blob) =>
      sendBlob("photo", {}, new Uint8Array(await blob.arrayBuffer())),
    // whether this phone's camera can take the photos (asked when you tap "I'm ready")
    setCam: (cam) => setState((b) => b && { ...b, cam }),
    setPlayer: (p) => {
      player.current = p;
    },
    // ask the other phone for its song (it only lives in this phone's memory for this battle)
    requestSong: () => {
      recv.current = null;
      setState((b) => b && { ...b, recv: { pct: 0 } });
      send({ type: "songReq" });
    },
    setShareSource: (fn) => {
      shareSource.current = fn;
    },
    setOnSongReceived: (fn) => {
      onReceived.current = fn;
    },
  };
}

// both phones have a song loaded and their lengths agree (so it's very likely the same version)
export const songsMatch = (a, b) =>
  !!(a && b && a.dur && b.dur && Math.abs(a.dur - b.dur) <= 2);

// State for a live battle with a friend: the room, who's in it, which song each of you has
// loaded, and the friend's line scores. Lives in App so the lobby can come before the song.
import { useCallback, useEffect, useRef, useState } from "react";
import { joinRoom, makeCode } from "../../lib/battleNet.js";
import { loadJSON, saveJSON } from "../../lib/storage.js";

// state: { code, host, status, peer: { name, host, song, dur, ready } | null, lastName,
//          started, round, synced, lines: { lineIndex: friend's score },
//          paused: { by: "me" | "peer", pos } | null,
//          stopReq: { by: "me" | "peer", pos, until } | null,
//          peerFinal: { bestCombo } | null, again: { me, peer } | null } | null
export function useBattle() {
  const [state, setState] = useState(null);
  const [myName, setMyName] = useState(() => loadJSON("tono.battle.name", ""));
  const net = useRef(null);
  const me = useRef({ name: "", host: false, song: "", dur: 0, ready: false });
  // Karaoke registers its player here: prepare() (headphone check + unlock sound, from a tap),
  // setHpMode(mode) and start(atMs), so either phone can start the song at a shared moment
  const player = useRef(null);
  // how far the host's clock is ahead of this phone's (ms), measured with pings; 0 for the host
  const offset = useRef(0);
  const bestRtt = useRef(Infinity);
  const stopTimer = useRef(null);
  const again = useRef({ me: false, peer: false }); // who's tapped Rematch since the last start
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
    setState((b) => b && { ...b, started: false, paused: null, stopReq: null, peerFinal: null, again: null, lines: {} });
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

  // atLocal: the moment (this phone's clock, ms) the countdown should end and the music start
  const begin = useCallback((atLocal) => {
    again.current = { me: false, peer: false };
    setState((b) => b && { ...b, started: true, paused: null, stopReq: null, peerFinal: null, again: null, lines: {}, round: (b.round || 0) + 1 });
    if (player.current) player.current.start(atLocal);
  }, []);

  const announce = () => net.current && net.current.update(me.current);

  const open = (code, host) => {
    if (net.current) net.current.leave();
    const name = myName.trim() || "Singer";
    saveJSON("tono.battle.name", name);
    me.current = { ...me.current, name, host, ready: false };
    offset.current = 0;
    bestRtt.current = Infinity;
    setState({ code, host, status: "connecting", peer: null, lastName: "", started: false, round: 0, lines: {}, synced: host });
    net.current = joinRoom(code, me.current, {
      onStatus: (status) => setState((b) => b && { ...b, status }),
      onPeer: (peer) =>
        setState((b) => b && { ...b, peer, lastName: peer ? peer.name : b.lastName }),
      onMessage: (m) => {
        if (m.type === "ping") {
          if (host && net.current) net.current.send({ type: "pong", t0: m.t0, t1: Date.now() });
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
          setState((b) => b && { ...b, stopReq: { by: "peer", pos: m.pos, until: Date.now() + STOP_WAIT } });
          stopTimer.current = setTimeout(() => answerStop(true), STOP_WAIT);
        } else if (m.type === "stopOk") doFinish();
        else if (m.type === "stopNo") {
          clearStopTimer();
          setState((b) => b && { ...b, stopReq: null });
        }
        else if (m.type === "final") setState((b) => b && { ...b, peerFinal: m.stats });
        else if (m.type === "again") {
          again.current = { ...again.current, peer: true };
          checkAgain(host);
        } else if (m.type === "lobby") doLobby();
        else if (m.type === "line")
          setState((b) => b && { ...b, lines: { ...b.lines, [m.i]: m.score } });
      },
    });
  };

  // the guest measures its clock against the host's with a few pings once they're both in
  const peerIn = !!(state && state.peer && state.status === "connected");
  useEffect(() => {
    if (!peerIn || !state || state.host) return;
    const ids = [0, 1, 2, 3, 4, 5].map((k) =>
      setTimeout(() => net.current && net.current.send({ type: "ping", t0: Date.now() }), k * 250),
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
    prepare: () => (player.current ? player.current.prepare() : Promise.resolve("nomic")),
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
      setState((b) => b && { ...b, stopReq: { by: "me", pos, until: Date.now() + STOP_WAIT } });
      // a little extra so the friend's own timeout (and its "end" message) lands first
      stopTimer.current = setTimeout(doFinish, STOP_WAIT + 3000);
    },
    answerStop,
    sendLine: (i, score) => net.current && net.current.send({ type: "line", i, score }),
    resetLines: () =>
      setState((b) => (b && Object.keys(b.lines).length ? { ...b, lines: {} } : b)),
    setPlayer: (p) => {
      player.current = p;
    },
  };
}

// both phones have a song loaded and their lengths agree (so it's very likely the same version)
export const songsMatch = (a, b) => !!(a && b && a.dur && b.dur && Math.abs(a.dur - b.dur) <= 2);

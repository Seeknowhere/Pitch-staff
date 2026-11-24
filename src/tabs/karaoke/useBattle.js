// State for a live battle with a friend: the room, who's in it, which song each of you has
// loaded, and the friend's line scores. Lives in App so the lobby can come before the song.
import { useCallback, useEffect, useRef, useState } from "react";
import { joinRoom, makeCode } from "../../lib/battleNet.js";
import { loadJSON, saveJSON } from "../../lib/storage.js";

// state: { code, host, status, peer: { name, host, song, dur, ready } | null, lastName,
//          started, round, synced, lines: { lineIndex: friend's score } } | null
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
  useEffect(() => () => net.current && net.current.leave(), []);

  // atLocal: the moment (this phone's clock, ms) the countdown should end and the music start
  const begin = useCallback((atLocal) => {
    setState((b) => b && { ...b, started: true, lines: {}, round: (b.round || 0) + 1 });
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
        } else if (m.type === "start") begin(m.at - offset.current);
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
    start: () => {
      const at = Date.now() + 3500;
      if (net.current) net.current.send({ type: "start", at });
      begin(at);
    },
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

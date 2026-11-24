// State for a live battle with a friend: the room, who's in it, which song each of you has
// loaded, and the friend's line scores. Lives in App so the lobby can come before the song.
import { useCallback, useEffect, useRef, useState } from "react";
import { joinRoom, makeCode } from "../../lib/battleNet.js";
import { loadJSON, saveJSON } from "../../lib/storage.js";

// state: { code, host, status, peer: { name, host, song, dur } | null, lastName,
//          started, round, lines: { lineIndex: friend's score } } | null
export function useBattle() {
  const [state, setState] = useState(null);
  const [myName, setMyName] = useState(() => loadJSON("tono.battle.name", ""));
  const net = useRef(null);
  const me = useRef({ name: "", host: false, song: "", dur: 0 });
  const starter = useRef(null); // Karaoke's start button, so "start" can come from either phone
  useEffect(() => () => net.current && net.current.leave(), []);

  const begin = useCallback(() => {
    setState((b) => b && { ...b, started: true, lines: {}, round: (b.round || 0) + 1 });
    if (starter.current) starter.current(true);
  }, []);

  const open = (code, host) => {
    if (net.current) net.current.leave();
    const name = myName.trim() || "Singer";
    saveJSON("tono.battle.name", name);
    me.current = { ...me.current, name, host };
    setState({ code, host, status: "connecting", peer: null, lastName: "", started: false, round: 0, lines: {} });
    net.current = joinRoom(code, me.current, {
      onStatus: (status) => setState((b) => b && { ...b, status }),
      onPeer: (peer) =>
        setState((b) => b && { ...b, peer, lastName: peer ? peer.name : b.lastName }),
      onMessage: (m) => {
        if (m.type === "start") begin();
        else if (m.type === "line")
          setState((b) => b && { ...b, lines: { ...b.lines, [m.i]: m.score } });
      },
    });
  };

  return {
    state,
    myName,
    setMyName,
    create: () => open(makeCode(), true),
    join: (code) => open(code, false),
    leave: () => {
      if (net.current) net.current.leave();
      net.current = null;
      setState(null);
    },
    // tell the other phone which song you have loaded (title + length in seconds)
    setSong: (song, dur) => {
      if (me.current.song === song && me.current.dur === dur) return;
      me.current = { ...me.current, song, dur };
      if (net.current) net.current.update(me.current);
    },
    start: () => {
      if (net.current) net.current.send({ type: "start" });
      begin();
    },
    sendLine: (i, score) => net.current && net.current.send({ type: "line", i, score }),
    resetLines: () =>
      setState((b) => (b && Object.keys(b.lines).length ? { ...b, lines: {} } : b)),
    setStarter: (fn) => {
      starter.current = fn;
    },
  };
}

// both phones have a song loaded and their lengths agree (so it's very likely the same version)
export const songsMatch = (a, b) => !!(a && b && a.dur && b.dur && Math.abs(a.dur - b.dur) <= 2);

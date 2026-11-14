import { useState, useCallback, useRef, useEffect } from "react";
import { detectPitch } from "../../lib/pitch.js";
import { micGate, getMicStream, SETTINGS } from "../../lib/settings.js";

export function useLessonMic(active) {
  const st = useRef({
    ctx: null,
    stream: null,
    src: null,
    an: null,
    raf: 0,
    feed: null,
  });
  const [on, setOn] = useState(false);
  const [err, setErr] = useState("");
  const ctx = () => {
    const s = st.current;
    if (!s.ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      s.ctx = new C();
    }
    if (s.ctx.state === "suspended") s.ctx.resume().catch(() => {});
    return s.ctx;
  };
  const stop = useCallback(() => {
    const s = st.current;
    cancelAnimationFrame(s.raf);
    if (s.stream) s.stream.getTracks().forEach((t) => t.stop());
    [s.src, s.an].forEach((n) => {
      if (n) {
        try {
          n.disconnect();
        } catch (e) {}
      }
    });
    s.stream = s.src = s.an = null;
    setOn(false);
  }, []);
  const start = async () => {
    const s = st.current;
    if (s.an) return true;
    setErr("");
    try {
      const c = ctx();
      const stream = await getMicStream();
      const src = c.createMediaStreamSource(stream),
        an = c.createAnalyser();
      an.fftSize = 2048;
      src.connect(an);
      Object.assign(s, { stream, src, an });
      const buf = new Float32Array(an.fftSize);
      const tick = () => {
        if (!s.an) return;
        s.an.getFloatTimeDomainData(buf);
        const d = detectPitch(buf, c.sampleRate, micGate());
        if (s.feed)
          s.feed(
            d.freq > 0 ? 69 + 12 * Math.log2(d.freq / SETTINGS.a4) : null,
            d.rms || 0,
            performance.now(),
          );
        s.raf = requestAnimationFrame(tick);
      };
      tick();
      setOn(true);
      return true;
    } catch (e) {
      stop();
      setErr(
        "The microphone isn't available here. Allow mic access, or open Tono from your GitHub Pages site.",
      );
      return false;
    }
  };
  useEffect(() => {
    if (!active) stop();
  }, [active, stop]);
  useEffect(
    () => () => {
      stop();
      if (st.current.ctx) st.current.ctx.close().catch(() => {});
    },
    [],
  );
  return {
    on,
    err,
    start,
    stop,
    ctx,
    setFeed: (fn) => {
      st.current.feed = fn;
    },
  };
}

// shared bits for exercises
export const useTimers = () => {
  const ids = useRef([]);
  useEffect(() => () => ids.current.forEach(clearTimeout), []);
  return {
    later: (fn, ms) => {
      const id = setTimeout(fn, ms);
      ids.current.push(id);
      return id;
    },
    clear: () => {
      ids.current.forEach(clearTimeout);
      ids.current = [];
    },
  };
};

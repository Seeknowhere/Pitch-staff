// One line of karaoke lyrics that lights up in time with the song.

// a line's words with start times; spreads them by length when the lyrics file has no word timing
function lineWords(line) {
  if (line.words && line.words.length)
    return line.words.map((w, i, arr) => ({
      ...w,
      end: i + 1 < arr.length ? arr[i + 1].t : line.end,
    }));
  const parts = (line.text || "").split(/\s+/).filter(Boolean);
  const total = parts.reduce((s, p) => s + p.length + 1, 0) || 1;
  const span = Math.max(0.3, (line.end - line.start) * 0.92);
  let acc = 0;
  return parts.map((w) => {
    const t = line.start + (span * acc) / total;
    acc += w.length + 1;
    return { t, w, end: line.start + (span * acc) / total };
  });
}

export function KaraokeLine({ line, t, size, dim }) {
  if (!line)
    return (
      <p className="kline" style={{ fontSize: size, opacity: 0.0 }}>
        ·
      </p>
    );
  const words = lineWords(line);
  // only fill word by word when the lyrics file has real word timing; otherwise light the whole line at its start
  const timed = !!(line.words && line.words.length);
  return (
    <p className={"kline" + (dim ? " dim" : "")} style={{ fontSize: size }}>
      {words.map((w, i) => {
        const p =
          t == null
            ? 0
            : !timed
              ? t >= line.start
                ? 1
                : 0
              : Math.max(
                  0,
                  Math.min(1, (t - w.t) / Math.max(0.05, w.end - w.t)),
                );
        return (
          <span key={i} className="kw" style={{ "--p": p * 100 + "%" }}>
            {w.w}{" "}
          </span>
        );
      })}
    </p>
  );
}

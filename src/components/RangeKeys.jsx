import { midiInfo, pretty } from "../lib/music.js";

// a strip of piano keys with your range (and optionally a song's range) marked
export function RangeKeys({ lo, hi, comfy, song }) {
  let a = lo,
    b = hi;
  if (song) {
    a = Math.min(a, song[0]);
    b = Math.max(b, song[1]);
  }
  const first = 12 * Math.floor((a - 2) / 12),
    last = 12 * Math.ceil((b + 2) / 12);
  const whites = [];
  for (let m = first; m <= last; m++) if (!midiInfo(m).sharp) whites.push(m);
  const W = 340,
    H = 64,
    kw = W / whites.length,
    xs = {};
  const fillW = (m) =>
    m >= comfy[0] && m <= comfy[1]
      ? "var(--accent)"
      : m >= lo && m <= hi
        ? "color-mix(in srgb, var(--accent) 42%, #f7f7f4)"
        : "#f7f7f4";
  const fillB = (m) =>
    m >= comfy[0] && m <= comfy[1]
      ? "color-mix(in srgb, var(--accent) 55%, #1d2027)"
      : m >= lo && m <= hi
        ? "color-mix(in srgb, var(--accent) 30%, #1d2027)"
        : "#1d2027";
  whites.forEach((m, i) => {
    xs[m] = i * kw;
  });
  const cx = (m) => (xs[m] != null ? xs[m] + kw / 2 : xs[m - 1] + kw);
  const label =
    "Piano keys: your range " +
    pretty(midiInfo(lo).label) +
    " to " +
    pretty(midiInfo(hi).label) +
    (song
      ? ", song " +
        pretty(midiInfo(song[0]).label) +
        " to " +
        pretty(midiInfo(song[1]).label)
      : "");
  return (
    <svg
      viewBox={"0 0 " + W + " " + (H + 16)}
      style={{ width: "100%", height: "auto", display: "block" }}
      role="img"
      aria-label={label}
    >
      {whites.map((m) => (
        <rect
          key={"w" + m}
          x={(xs[m] + 0.5).toFixed(1)}
          y="0.5"
          width={(kw - 1).toFixed(1)}
          height={H - 1}
          rx="3"
          fill={fillW(m)}
          stroke="var(--bg)"
        />
      ))}
      {whites
        .filter((m) => m < last && midiInfo(m + 1).sharp)
        .map((m) => (
          <rect
            key={"b" + m}
            x={(xs[m] + kw * 0.68).toFixed(1)}
            y="0.5"
            width={(kw * 0.64).toFixed(1)}
            height={(H * 0.58).toFixed(1)}
            rx="2"
            fill={fillB(m + 1)}
            stroke="var(--bg)"
          />
        ))}
      {song && (
        <line
          x1={cx(song[0]).toFixed(1)}
          y1={H - 9}
          x2={cx(song[1]).toFixed(1)}
          y2={H - 9}
          stroke="var(--you)"
          strokeWidth="5"
          strokeLinecap="round"
        />
      )}
      {song && song[1] > hi && (
        <line
          x1={cx(hi + 1).toFixed(1)}
          y1={H - 9}
          x2={cx(song[1]).toFixed(1)}
          y2={H - 9}
          stroke="var(--bad)"
          strokeWidth="5"
          strokeLinecap="round"
        />
      )}
      {song && song[0] < lo && (
        <line
          x1={cx(song[0]).toFixed(1)}
          y1={H - 9}
          x2={cx(lo - 1).toFixed(1)}
          y2={H - 9}
          stroke="var(--bad)"
          strokeWidth="5"
          strokeLinecap="round"
        />
      )}
      {whites
        .filter((m) => m % 12 === 0)
        .map((m) => (
          <text
            key={"t" + m}
            x={(xs[m] + 3).toFixed(1)}
            y={H + 12}
            fill="var(--muted)"
            fontSize="10"
            fontFamily="JetBrains Mono, monospace"
          >
            {midiInfo(m).label}
          </text>
        ))}
    </svg>
  );
}

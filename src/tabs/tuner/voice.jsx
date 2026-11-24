// Voice types (soprano, tenor...) and range helpers shared by My range and Song fit.
import { html } from "../../html.js";

// typical ranges (MIDI) used to suggest a voice type
const VOICES = [
  ["Bass", 40, 64],
  ["Baritone", 45, 69],
  ["Tenor", 48, 72],
  ["Alto", 53, 77],
  ["Mezzo-soprano", 57, 81],
  ["Soprano", 60, 84],
];

export function voiceType(lo, hi) {
  const mid = (lo + hi) / 2;
  let best = null,
    bd = Infinity;
  VOICES.forEach(([n, a, b]) => {
    const d = Math.abs(mid - (a + b) / 2) + 0.5 * Math.abs(lo - a);
    if (d < bd) {
      bd = d;
      best = n;
    }
  });
  return best;
}

export function spanWords(lo, hi) {
  const n = hi - lo + 1,
    oct = Math.round(((hi - lo) / 12) * 2) / 2;
  const o =
    oct < 0.5
      ? ""
      : oct === 0.5
        ? "about half an octave"
        : "about " +
          String(Math.floor(oct)) +
          (oct % 1 ? "½" : "") +
          " octave" +
          (oct > 1 ? "s" : "");
  return n + " notes" + (o ? ", " + o : "");
}

export const keyDot = (bg) =>
  html`<span
    style=${{
      width: 12,
      height: 12,
      borderRadius: 3,
      background: bg,
      flexShrink: 0,
    }}
  ></span>`;

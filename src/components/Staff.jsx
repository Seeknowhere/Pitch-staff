import {html} from "../html.js";
import {midiInfo} from "../lib/music.js";

const BOTTOM = 140,
  HALF = 7; // E4 bottom line; half a line gap = one diatonic step
export const yOf = (step) => BOTTOM - (step - 30) * HALF;

function NoteHead({ x, step, sharp, color, opacity }) {
  const s = Math.max(12, Math.min(50, step));
  const y = yOf(s);
  const ledgers = [];
  if (s <= 28) for (let k = 28; k >= s; k -= 2) ledgers.push(k);
  if (s >= 40) for (let k = 40; k <= s; k += 2) ledgers.push(k);
  const up = s < 34;
  return html`<g opacity=${opacity}>
    ${ledgers.map(
      (k) =>
        html`<line
          key=${k}
          x1=${x - 12}
          x2=${x + 12}
          y1=${yOf(k)}
          y2=${yOf(k)}
          stroke="var(--muted)"
          stroke-width="1.3"
        />`,
    )}
    ${sharp &&
    html`<text
      x=${x - 22}
      y=${y + 5}
      font-size="17"
      fill=${color}
      font-family="var(--font-music)"
      >♯</text
    >`}
    <ellipse
      cx=${x}
      cy=${y}
      rx="7.6"
      ry="5.4"
      transform=${`rotate(-22 ${x} ${y})`}
      fill=${color}
    />
    <line
      x1=${up ? x + 6.8 : x - 6.8}
      x2=${up ? x + 6.8 : x - 6.8}
      y1=${y}
      y2=${up ? y - 36 : y + 36}
      stroke=${color}
      stroke-width="1.6"
    />
  </g>`;
}

export function Staff({ trail, live, example, target }) {
  const lines = [30, 32, 34, 36, 38];
  const slots = trail.slice(-7);
  const startX = 108,
    gap = 32;
  return html`<svg
    viewBox="0 -4 400 276"
    width="100%"
    style=${{ minWidth: 320, display: "block" }}
    role="img"
    aria-label=${live
      ? "Staff showing " + midiInfo(live.midi).label
      : "Treble clef staff"}
  >
    ${lines.map(
      (s) =>
        html`<line
          key=${s}
          x1="8"
          x2="392"
          y1=${yOf(s)}
          y2=${yOf(s)}
          stroke="var(--muted)"
          stroke-opacity="0.75"
          stroke-width="1.2"
        />`,
    )}
    <line
      x1="8"
      x2="8"
      y1=${yOf(38)}
      y2=${yOf(30)}
      stroke="var(--muted)"
      stroke-opacity="0.75"
      stroke-width="1.2"
    />
    <text
      x="14"
      y=${yOf(30) + 15}
      font-size="76"
      fill="var(--fg)"
      font-family="var(--font-music)"
    >
      𝄞
    </text>
    <line
      x1="338"
      x2="338"
      y1="10"
      y2="262"
      stroke="var(--accent)"
      stroke-opacity="0.25"
      stroke-dasharray="3 5"
    />
    ${slots.map((t, i) => {
      const info = midiInfo(t.midi);
      const x = startX + i * gap;
      return html`<g key=${t.id}>
        <${NoteHead}
          x=${x}
          step=${info.step}
          sharp=${info.sharp}
          color="var(--fg)"
          opacity=${example ? 0.35 : 0.45 + (0.5 * (i + 1)) / slots.length}
        />
        <text
          x=${x}
          y="270"
          text-anchor="middle"
          font-size="9"
          fill="var(--muted)"
          font-family="var(--font-mono)"
          >${info.label}</text
        >
      </g>`;
    })}
    ${target &&
    (() => {
      const info = midiInfo(target.midi),
        sMin = Math.max(12, Math.min(50, info.step)),
        y = yOf(sMin);
      const col = target.matched ? "var(--good)" : "var(--fg)";
      return html`<g aria-hidden="true">
        ${sMin <= 28 &&
        Array.from(
          { length: Math.floor((28 - sMin) / 2) + 1 },
          (_, i) => 28 - 2 * i,
        ).map(
          (k) =>
            html`<line
              key=${"t" + k}
              x1="345"
              x2="375"
              y1=${yOf(k)}
              y2=${yOf(k)}
              stroke="var(--muted)"
              stroke-width="1.3"
            />`,
        )}
        ${sMin >= 40 &&
        Array.from(
          { length: Math.floor((sMin - 40) / 2) + 1 },
          (_, i) => 40 + 2 * i,
        ).map(
          (k) =>
            html`<line
              key=${"t" + k}
              x1="345"
              x2="375"
              y1=${yOf(k)}
              y2=${yOf(k)}
              stroke="var(--muted)"
              stroke-width="1.3"
            />`,
        )}
        <ellipse
          cx="360"
          cy=${y}
          rx="10"
          ry="7.5"
          transform=${`rotate(-22 360 ${y})`}
          fill=${target.matched
            ? "color-mix(in srgb, var(--good) 25%, transparent)"
            : "none"}
          stroke=${col}
          stroke-width="2"
          stroke-dasharray=${target.matched ? "" : "3 2"}
        />
        ${info.sharp &&
        html`<text
          x="334"
          y=${y + 5}
          font-size="15"
          fill=${col}
          font-family="var(--font-music)"
          >♯</text
        >`}
        <text
          x="360"
          y="10"
          text-anchor="middle"
          font-size="9"
          fill=${col}
          font-family="var(--font-mono)"
          >target ${info.label}</text
        >
      </g>`;
    })()}
    ${live &&
    (() => {
      const info = midiInfo(live.midi);
      return html`<g>
        <${NoteHead}
          x=${360}
          step=${info.step}
          sharp=${info.sharp}
          color="var(--accent)"
          opacity=${1}
        />
        <text
          x="360"
          y="270"
          text-anchor="middle"
          font-size="10"
          font-weight="600"
          fill="var(--accent)"
          font-family="var(--font-mono)"
          >${info.label}</text
        >
      </g>`;
    })()}
  </svg>`;
}

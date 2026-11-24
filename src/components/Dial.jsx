  import { html } from "../html.js";
  import { signed } from "../lib/music.js";
  
  // semicircle tuner dial: needle at -50..+50 cents, green zone of +/- tol
  export function Dial({ cents, tol, tone, lowLabel, highLabel, zoneSoft }) {
    const cx = 140,
      cy = 132,
      rad = 116;
    const pt = (c, rr) => {
      const a = (Math.max(-50, Math.min(50, c)) / 50) * (Math.PI / 2);
      return [cx + rr * Math.sin(a), cy - rr * Math.cos(a)];
    };
    const [zx0, zy0] = pt(-tol, rad),
      [zx1, zy1] = pt(tol, rad);
    const [nx, ny] = cents != null ? pt(cents, rad - 12) : [cx, cy - rad + 12];
    const col = cents == null ? "var(--muted)" : "var(--" + tone + ")";
    return html`<svg
      viewBox="0 0 280 146"
      style=${{
        width: "100%",
        maxWidth: 300,
        height: "auto",
        display: "block",
      }}
      role="img"
      aria-label=${cents == null
        ? "Tuner dial, waiting for a note"
        : "Tuner dial: " + signed(cents) + " cents"}
    >
      <path
        d=${"M" +
        (cx - rad) +
        " " +
        cy +
        " A" +
        rad +
        " " +
        rad +
        " 0 0 1 " +
        (cx + rad) +
        " " +
        cy}
        fill="none"
        stroke="var(--line)"
        strokeWidth="12"
        strokeLinecap="round"
      ></path>
      <path
        d=${"M" +
        zx0.toFixed(1) +
        " " +
        zy0.toFixed(1) +
        " A" +
        rad +
        " " +
        rad +
        " 0 0 1 " +
        zx1.toFixed(1) +
        " " +
        zy1.toFixed(1)}
        fill="none"
        stroke="var(--good)"
        strokeOpacity=${zoneSoft ? 0.5 : 1}
        strokeWidth="12"
        strokeLinecap="round"
      ></path>
      <line
        x1=${cx}
        y1=${cy - rad - 8}
        x2=${cx}
        y2=${cy - rad + 8}
        stroke="var(--muted)"
        strokeWidth="2"
      ></line>
      ${cents != null &&
      html`<line
        x1=${cx}
        y1=${cy}
        x2=${nx.toFixed(1)}
        y2=${ny.toFixed(1)}
        stroke=${col}
        strokeWidth="4"
        strokeLinecap="round"
        style=${{ transition: "all .08s linear" }}
      ></line>`}
      <circle cx=${cx} cy=${cy} r="7" fill=${col}></circle>
      <text
        x="14"
        y="144"
        fill="var(--muted)"
        fontSize="11"
        fontFamily="Instrument Sans, sans-serif"
      >
        ${lowLabel}
      </text>
      <text
        x="266"
        y="144"
        fill="var(--muted)"
        fontSize="11"
        fontFamily="Instrument Sans, sans-serif"
        textAnchor="end"
      >
        ${highLabel}
      </text>
    </svg>`;
  }

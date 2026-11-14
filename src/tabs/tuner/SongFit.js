// Song fit: does this song suit your range, and which key to sing it in.
import { useMemo } from "react";
import { RangeKeys } from "../../components/RangeKeys.js";
import { html } from "../../html.js";
import { fmt, pretty, midiInfo } from "../../lib/music.js";
import { loadRanges, comfyOf } from "../../lib/range.js";
import { keyDot } from "./voice.js";

// Practice: how the loaded song sits against the singer's saved range
export function SongFit({
  notes,
  tr,
  phrases,
  linesIn,
  nameOf,
  active,
  onPractice,
  onFind,
}) {
  const mine = useMemo(() => loadRanges()[0] || null, [active]);
  if (!notes.length) return null;
  if (!mine)
    return html`<section
      class="panel p-4 flex items-center gap-3"
      style=${{ borderStyle: "dashed" }}
    >
      <span class="text-sm muted" style=${{ flex: 1 }}
        >No range yet? Take the 1-minute test in Tuner to see how songs fit
        you.</span
      >
      <button
        class="link-btn text-sm"
        style=${{ whiteSpace: "nowrap" }}
        onClick=${onFind}
      >
        Find my range
      </button>
    </section>`;
  let slo = 999,
    shi = 0;
  notes.forEach((n) => {
    slo = Math.min(slo, n.midi + tr);
    shi = Math.max(shi, n.midi + tr);
  });
  const highs = new Set(),
    lows = new Set();
  notes.forEach((n) => {
    const m = n.midi + tr;
    if (m > mine.hi) highs.add(m);
    if (m < mine.lo) lows.add(m);
  });
  const out = highs.size + lows.size;
  const status = !out
    ? ["Fits you", "good"]
    : highs.size && lows.size
      ? ["Wider than your range", "warn"]
      : highs.size
        ? [out <= 3 ? "A bit high" : "High for you", "warn"]
        : [out <= 3 ? "A bit low" : "Low for you", "warn"];
  const hard = phrases
    .map((ph) => {
      let top = null,
        bottom = null;
      ph.notes.forEach((n) => {
        const m = n.midi + tr;
        if (m > mine.hi && (top == null || m > top)) top = m;
        if (m < mine.lo && (bottom == null || m < bottom)) bottom = m;
      });
      return top != null || bottom != null
        ? { ph, m: top != null ? top : bottom }
        : null;
    })
    .filter(Boolean);
  const outNames = [...highs, ...lows];
  return html`<section class="panel p-4 flex flex-col gap-3">
    <div class="flex items-center justify-between gap-2">
      <h3 class="display text-lg font-bold">Song vs your range</h3>
      <span class=${"tag tag-" + status[1]}>${status[0]}</span>
    </div>
    <${RangeKeys}
      lo=${mine.lo}
      hi=${mine.hi}
      comfy=${comfyOf(mine)}
      song=${[slo, shi]}
    />
    <div class="flex flex-wrap gap-3 text-xs muted">
      <span class="flex items-center gap-2"
        ><span
          style=${{
            width: 14,
            height: 5,
            borderRadius: 3,
            background: "var(--you)",
          }}
        ></span
        >Song
        ${pretty(midiInfo(slo).label)}–${pretty(midiInfo(shi).label)}</span
      >
      <span class="flex items-center gap-2"
        >${keyDot("var(--accent)")}You
        ${pretty(midiInfo(mine.lo).label)}–${pretty(
          midiInfo(mine.hi).label,
        )}</span
      >
      ${out > 0 &&
      html`<span class="flex items-center gap-2"
        ><span
          style=${{
            width: 14,
            height: 5,
            borderRadius: 3,
            background: "var(--bad)",
          }}
        ></span
        >Outside your range</span
      >`}
    </div>
    ${!out
      ? html`<p class="text-sm" style=${{ margin: 0 }}>
          Every note is inside your range. Nice pick!
        </p>`
      : html`<p class="text-sm" style=${{ margin: 0 }}>
            <b>${out} note${out > 1 ? "s" : ""}</b> (${outNames
              .map((m) => pretty(midiInfo(m).label))
              .join(", ")})
            ${(highs.size && lows.size
              ? "go outside"
              : highs.size
                ? "go above"
                : "go below"
            ).replace(/^go/, out > 1 ? "go" : "goes")}
            your range, in
            <b>${hard.length} phrase${hard.length > 1 ? "s" : ""}</b>:
          </p>
          <div class="flex flex-col gap-2">
            ${hard.slice(0, 5).map(({ ph, m }) => {
              const w = linesIn(ph.start, ph.end);
              return html`<div
                key=${ph.i}
                class="flex items-center gap-3"
                style=${{
                  padding: "8px 12px",
                  borderRadius: 12,
                  background: "var(--surface-2)",
                }}
              >
                <span class="mono text-xs muted">${fmt(ph.start)}</span>
                <span
                  class="text-sm"
                  style=${{
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  >${w.length ? w.join(" / ") : "Phrase " + (ph.i + 1)}</span
                >
                <span class="mono text-xs" style=${{ color: "var(--bad)" }}
                  >${pretty(midiInfo(m).label)}</span
                >
                <button
                  class="link-btn text-sm"
                  onClick=${() => onPractice(ph)}
                >
                  Practise
                </button>
              </div>`;
            })}
            ${hard.length > 5 &&
            html`<span class="text-xs muted"
              >…and ${hard.length - 5} more in the phrase list.</span
            >`}
          </div>
          <p class="text-xs muted" style=${{ margin: 0 }}>
            Tip:
            ${highs.size
              ? "sing the high notes lightly, or drop them an octave for now."
              : "sing the low notes softly, or take them up an octave for now."}${highs.size &&
            lows.size
              ? " Low ones can go up an octave."
              : ""}
          </p>`}
  </section>`;
}

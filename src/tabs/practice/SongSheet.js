// The song sheet: every lyric line with its notes.
import React, { useMemo, useState, useRef, useEffect } from "react";
import { html } from "../../html.js";
import { looksTagalog, wordsToNotes } from "../../lib/lyrics.js";
import { fmt, pretty, midiInfo } from "../../lib/music.js";

// ---- Practice: song sheet, the notes for every lyric line ----
function lineTags(ln, songLo, songHi) {
  const g = ln.notes,
    tags = [];
  if (!g.length) return tags;
  let jump = 0;
  for (let j = 1; j < g.length; j++)
    if (g[j].pos - g[j - 1].end < 0.35)
      jump = Math.max(jump, Math.abs(g[j].midi - g[j - 1].midi));
  if (jump >= 5) tags.push("Big jump");
  let fast = false;
  for (let j = 0; j < g.length && !fast; j++) {
    let c = 0;
    for (let q = j; q < g.length && g[q].pos < g[j].pos + 1; q++) c++;
    if (c >= 5) fast = true;
  }
  if (fast) tags.push("Fast run");
  const wide = songHi - songLo >= 7;
  if (wide && g.some((n) => n.midi >= songHi - 1)) tags.push("High note");
  if (wide && g.some((n) => n.midi <= songLo + 1)) tags.push("Low note");
  if (g.some((n) => n.end - n.pos >= 1.5)) tags.push("Long hold");
  return tags;
}

export function SongSheet({
  notes,
  spans,
  phrases,
  tr,
  nameOf,
  names,
  onNames,
  cursor,
  curIdx,
  playing,
  onPlayLine,
  onLoop,
  loop,
  lineInfo,
  onMe,
  you,
  onAnalyze,
  onPlayRange,
  onSaveWords,
  scrollLine,
}) {
  const [open, setOpen] = useState(-1);
  const timeRef = useRef(0);
  timeRef.current = cursor || 0;
  const refs = useRef({});
  useEffect(() => {
    if (!scrollLine || scrollLine.k < 0) return;
    const el = refs.current[scrollLine.k];
    if (el && el.scrollIntoView)
      setTimeout(
        () => el.scrollIntoView({ block: "center", behavior: "smooth" }),
        60,
      );
  }, [scrollLine && scrollLine.id]);
  const short = (m) => nameOf(m).replace(/-?\d+$/, "");
  const tl = useMemo(() => looksTagalog(spans), [spans]);
  const lines = useMemo(() => {
    const src = spans.length
      ? spans
      : phrases.map((p) => ({
          start: p.start,
          end: p.end,
          text: "",
          words: null,
        }));
    return src.map((l, li) => {
      const idx = [];
      notes.forEach((n, i) => {
        if (n.pos >= l.start - 0.08 && n.pos < l.end - 0.02) idx.push(i);
      });
      const ln = { ...l, li, idx, notes: idx.map((i) => notes[i]) };
      if (!(l.words && l.words.length) && l.text && idx.length) {
        const m = wordsToNotes(
          l.text,
          idx.map((i) => notes[i]),
          tl,
        );
        if (m) {
          ln.wordNotes = m.map((x) => ({
            w: x.w,
            idx: x.idx.map((j) => idx[j]),
          }));
          ln.guessed = true;
        }
      }
      // real word timing from the lyrics file (or your taps) wins
      if (l.words && l.words.length && idx.length) {
        ln.wordNotes = l.words.map((w, k) => {
          const end = k + 1 < l.words.length ? l.words[k + 1].t : l.end;
          const mine = idx.filter(
            (i) => notes[i].pos >= w.t - 0.08 && notes[i].pos < end - 0.02,
          );
          return { w: w.w, idx: mine };
        });
      }
      return ln;
    });
  }, [notes, spans, phrases, tl]);
  let songLo = 999,
    songHi = 0;
  notes.forEach((n) => {
    songLo = Math.min(songLo, n.midi);
    songHi = Math.max(songHi, n.midi);
  });
  const cur =
    cursor != null
      ? lines.findIndex((l) => cursor >= l.start - 0.05 && cursor < l.end)
      : -1;
  useEffect(() => {
    if (!playing || cur < 0) return;
    const el = refs.current[cur];
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top < 90 || r.bottom > window.innerHeight - 170) {
      try {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      } catch (e) {}
    }
  }, [cur, playing]);
  const youChip = (i) => {
    const r = you && you[i];
    if (!r)
      return html`<span
        class="mono"
        style=${{
          fontSize: 12,
          padding: "3px 6px",
          color: "var(--muted)",
          minWidth: 18,
          textAlign: "center",
        }}
      >
      </span>`;
    const st =
      r.c == null
        ? "miss"
        : Math.abs(r.c) <= 25
          ? "good"
          : Math.abs(r.c) <= 50
            ? "warn"
            : "bad";
    const label =
      r.c == null
        ? "–"
        : st === "bad"
          ? short(r.m + Math.round(r.c / 100))
          : short(r.m) + (st === "warn" ? (r.c < 0 ? "↓" : "↑") : "");
    const col = st === "miss" ? "var(--muted)" : "var(--" + st + ")";
    const tip =
      r.c == null
        ? "Not heard"
        : "You sang " +
          pretty(midiInfo(r.m + Math.round(r.c / 100)).label) +
          (Math.abs(r.c - 100 * Math.round(r.c / 100)) > 10
            ? ", " +
              Math.abs(r.c - 100 * Math.round(r.c / 100)) +
              "¢ " +
              (r.c - 100 * Math.round(r.c / 100) < 0 ? "flat" : "sharp")
            : "") +
          ". The song has " +
          pretty(midiInfo(r.m).label) +
          ".";
    return html`<span
      class="mono"
      title=${tip}
      aria-label=${tip}
      style=${{
        fontSize: 12,
        fontWeight: 700,
        padding: "3px 6px",
        borderRadius: 6,
        minWidth: 18,
        textAlign: "center",
        whiteSpace: "nowrap",
        color: col,
        background:
          st === "miss"
            ? "var(--surface-2)"
            : "color-mix(in srgb, " + col + " 15%, transparent)",
      }}
      >${label}</span
    >`;
  };
  const chip = (i, label) =>
    html`<span
      class="mono"
      style=${{
        fontSize: 12,
        fontWeight: 600,
        padding: "3px 6px",
        borderRadius: 6,
        background:
          i === curIdx
            ? "var(--accent)"
            : "color-mix(in srgb, var(--accent) 15%, transparent)",
        color: i === curIdx ? "var(--accent-ink)" : "var(--accent)",
        whiteSpace: "nowrap",
      }}
      >${label}</span
    >`;
  if (!notes.length)
    return html`<p class="muted text-sm">
      No melody found in this vocal yet.
    </p>`;
  return html`<div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="seg" role="group" aria-label="Note names">
        <button
          aria-pressed=${names !== "solfege" ? "true" : "false"}
          onClick=${() => onNames("letters")}
        >
          Letters
        </button>
        <button
          aria-pressed=${names === "solfege" ? "true" : "false"}
          onClick=${() => onNames("solfege")}
        >
          Do re mi
        </button>
      </div>
    </div>
    ${!spans.length &&
    html`<p class="text-xs muted" style=${{ margin: 0 }}>
      No lyrics for this song yet, so lines follow the melody's phrases. Add
      an .lrc file under Change to see the words.
    </p>`}
    ${lines.map((l, k) => {
      const isCur = k === cur,
        isOpen = k === open,
        tags = lineTags(l, songLo, songHi);
      const info = lineInfo ? lineInfo(l) : {};
      const hasYou = !!(you && l.idx.some((i) => you[i]));
      const scoreTag = (lbl, v) =>
        v == null
          ? null
          : html`<span
              class=${"tag tag-" +
              (v >= 80 ? "good" : v >= 50 ? "warn" : "bad")}
              >${lbl} ${v}%</span
            >`;
      const looping = loop && Math.abs(loop.a - Math.max(0, l.start)) < 0.05;
      let lo = 999,
        hi = 0,
        jump = 0;
      l.notes.forEach((n, j) => {
        lo = Math.min(lo, n.midi);
        hi = Math.max(hi, n.midi);
        if (j) jump = Math.max(jump, Math.abs(n.midi - l.notes[j - 1].midi));
      });
      return html`<section
        key=${k}
        ref=${(el) => {
          refs.current[k] = el;
        }}
        class="panel"
        style=${{
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          borderColor: isCur
            ? "color-mix(in srgb, var(--accent) 55%, transparent)"
            : undefined,
          borderRadius: 16,
        }}
      >
        <div class="flex items-center gap-2">
          <button
            class="flex items-center gap-2 min-w-0"
            style=${{
              flex: 1,
              background: "none",
              border: 0,
              padding: 0,
              color: "inherit",
              font: "inherit",
              cursor: "pointer",
              textAlign: "left",
            }}
            onClick=${() => setOpen(isOpen ? -1 : k)}
            aria-expanded=${isOpen ? "true" : "false"}
          >
            ${info.learned &&
            html`<span
              title="Learned: 85% or more twice in a row"
              aria-label="Learned"
              style=${{
                width: 20,
                height: 20,
                borderRadius: "50%",
                flexShrink: 0,
                display: "grid",
                placeItems: "center",
                background: "var(--good)",
                color: "var(--bg)",
                fontSize: 11,
                fontWeight: 800,
              }}
              >✓</span
            >`}
            <span class="mono text-xs muted"
              >${String(k + 1).padStart(2, "0")} ·
              ${fmt(Math.max(0, l.start))}</span
            >
            <span class="flex flex-wrap gap-1"
              >${tags.map(
                (t) =>
                  html`<span
                    key=${t}
                    class="tag"
                    style=${{
                      color: "var(--muted)",
                      background: "var(--surface-2)",
                    }}
                    >${t}</span
                  >`,
              )}${scoreTag("Last", info.last)}${scoreTag(
                "Best",
                info.best,
              )}</span
            >
          </button>
        </div>
        ${l.wordNotes
          ? html`<div
              class="flex flex-wrap"
              style=${{ gap: "10px 8px" }}
              onClick=${() => setOpen(isOpen ? -1 : k)}
            >
              ${l.wordNotes.map(
                (w, j) =>
                  html`<span
                    key=${j}
                    class="flex flex-col items-center"
                    style=${{ gap: 3 }}
                  >
                    <span class="flex gap-1" style=${{ minHeight: 22 }}
                      >${w.idx.length
                        ? w.idx
                            .slice(0, 3)
                            .map((i) => chip(i, short(notes[i].midi)))
                        : html`<span class="mono text-xs muted">·</span>`}${w
                        .idx.length > 3
                        ? html`<span class="text-xs muted">…</span>`
                        : ""}</span
                    >
                    ${hasYou &&
                    html`<span class="flex gap-1" style=${{ minHeight: 22 }}
                      >${w.idx
                        .slice(0, 3)
                        .map(
                          (i) => html`<span key=${i}>${youChip(i)}</span>`,
                        )}</span
                    >`}
                    <span style=${{ fontSize: 15, fontWeight: 600 }}
                      >${w.w}</span
                    >
                  </span>`,
              )}
            </div>`
          : html`<div
              class="flex flex-col gap-2"
              onClick=${() => setOpen(isOpen ? -1 : k)}
            >
              ${hasYou
                ? html`<div class="flex gap-2 items-start">
                    <span
                      class="flex flex-col"
                      style=${{
                        gap: 4,
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: ".08em",
                        textTransform: "uppercase",
                        color: "var(--muted)",
                        paddingTop: 3,
                      }}
                      ><span style=${{ height: 20 }}>Song</span
                      ><span style=${{ height: 20, color: "var(--you)" }}
                        >You</span
                      ></span
                    >
                    <div class="flex flex-wrap" style=${{ gap: "6px 4px" }}>
                      ${l.idx.map(
                        (i) =>
                          html`<span
                            key=${i}
                            class="flex flex-col items-center"
                            style=${{ gap: 4 }}
                            >${chip(i, short(notes[i].midi))}${youChip(
                              i,
                            )}</span
                          >`,
                      )}
                    </div>
                  </div>`
                : html`<div class="flex flex-wrap gap-1">
                    ${l.idx.map(
                      (i) =>
                        html`<span key=${i}
                          >${chip(i, short(notes[i].midi))}</span
                        >`,
                    )}
                  </div>`}
              ${l.text &&
              html`<span
                style=${{ fontSize: 16, fontWeight: 600, lineHeight: 1.35 }}
                >${l.text}</span
              >`}
            </div>`}
        <div class="flex flex-wrap gap-2">
          <button
            class="btn"
            style=${{ padding: "5px 10px", fontSize: 12 }}
            onClick=${() => onPlayLine(l)}
            aria-label=${"Play line " + (k + 1)}
          >
            ▶ Play
          </button>
          ${info.me &&
          html`<button
            class="btn"
            style=${{
              padding: "5px 10px",
              fontSize: 12,
              color: "var(--you)",
            }}
            onClick=${() => onMe && onMe(l)}
            aria-label=${"Hear your last try at line " + (k + 1)}
          >
            ▶ Me
          </button>`}
          <button
            class="btn"
            style=${{
              padding: "5px 10px",
              fontSize: 12,
              color: looping ? "var(--accent)" : undefined,
              borderColor: looping ? "var(--accent)" : undefined,
            }}
            onClick=${() => onLoop(l)}
            aria-label=${"Loop line " + (k + 1)}
          >
            ↻ ${looping ? "Looping" : "Loop"}
          </button>
          ${info.analyze &&
          html`<button
            class="btn"
            style=${{
              padding: "5px 10px",
              fontSize: 12,
              color: "var(--accent)",
              borderColor:
                "color-mix(in srgb, var(--accent) 45%, transparent)",
            }}
            onClick=${() => onAnalyze && onAnalyze(l)}
            aria-label=${"Analyze your try at line " + (k + 1)}
          >
            Analyze
          </button>`}
        </div>
        ${isOpen &&
        l.notes.length > 0 &&
        html`<${React.Fragment}>
          <svg
            viewBox="0 0 300 50"
            preserveAspectRatio="none"
            style=${{ width: "100%", height: 50, display: "block" }}
            aria-hidden="true"
          >
            ${(() => {
              const a = l.notes[0].pos,
                b = Math.max(a + 0.5, l.notes[l.notes.length - 1].end),
                L = lo - 1,
                H = hi + 1;
              return l.notes.map(
                (n, j) =>
                  html`<rect
                    key=${j}
                    x=${((300 * (n.pos - a)) / (b - a)).toFixed(1)}
                    y=${(44 - ((n.midi - L) / (H - L)) * 38).toFixed(1)}
                    width=${Math.max(
                      4,
                      (300 * (n.end - n.pos)) / (b - a) - 2,
                    ).toFixed(1)}
                    height="6"
                    rx="3"
                    fill=${l.idx[j] === curIdx
                      ? "var(--fg)"
                      : "var(--accent)"}
                  ></rect>`,
              );
            })()}
          </svg>
          <div
            class="flex flex-wrap items-center justify-between gap-2 text-xs muted"
          >
            <span
              >Range
              ${pretty(midiInfo(lo + tr).label)}–${pretty(
                midiInfo(hi + tr).label,
              )}</span
            >
            <span>Biggest jump ${jump} key${jump === 1 ? "" : "s"}</span>
          </div>
        <//>`}
      </section>`;
    })}
  </div>`;
}

// Analyze results: this run, progress charts and line-by-line feedback.
import React, { useState, useEffect } from "react";
import { BtTags } from "../../components/BtTags.js";
import { Sheet } from "../../components/Sheet.js";
import { TryChart, BreathTimingView } from "../../components/TryPanel.js";
import { html } from "../../html.js";
import { fmt } from "../../lib/music.js";
import { scoreTone, lineHistory, dayLabel } from "../../lib/runs.js";
import { btInfo, tryStats } from "../../lib/tries.js";

function Spark({ vals, w = 74, h = 22, tone }) {
  if (!vals || vals.length < 2) return null;
  const pts = vals.map((v, i) => [
    3 + (i * (w - 6)) / (vals.length - 1),
    h - 3 - (v / 100) * (h - 6),
  ]);
  const c = "var(--" + (tone || scoreTone(vals[vals.length - 1])) + ")";
  return html`<svg
    width=${w}
    height=${h}
    viewBox=${"0 0 " + w + " " + h}
    aria-hidden="true"
    style=${{ flexShrink: 0 }}
  >
    <polyline
      points=${pts
        .map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1))
        .join(" ")}
      fill="none"
      stroke=${c}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    ></polyline>
    <circle
      cx=${pts[pts.length - 1][0].toFixed(1)}
      cy=${pts[pts.length - 1][1].toFixed(1)}
      r="2.6"
      fill=${c}
    ></circle>
  </svg>`;
}

function HistChart({ pts }) {
  if (!pts.length) return html`<p class="text-xs muted">No scores yet.</p>`;
  const W = 300,
    H = 90,
    xs = pts.map((_, i) =>
      pts.length === 1 ? W / 2 : 18 + (i * (W - 36)) / (pts.length - 1),
    ),
    y = (v) => H - 16 - (v / 100) * (H - 26);
  let lastDay = "";
  return html`<svg
    viewBox=${"0 0 " + W + " " + H}
    style=${{ width: "100%", height: "auto", display: "block" }}
    role="img"
    aria-label="Scores for this line over time"
  >
    <line
      x1="0"
      x2=${W}
      y1=${y(80).toFixed(1)}
      y2=${y(80).toFixed(1)}
      stroke="var(--good)"
      strokeDasharray="3 4"
      opacity="0.5"
    ></line>
    <text
      x=${W - 2}
      y=${(y(80) - 4).toFixed(1)}
      fill="var(--good)"
      fontSize="9"
      textAnchor="end"
    >
      good
    </text>
    ${pts.length > 1 &&
    html`<polyline
      points=${pts
        .map((p, i) => xs[i].toFixed(1) + "," + y(p.s).toFixed(1))
        .join(" ")}
      fill="none"
      stroke="var(--line)"
      strokeWidth="1.5"
    ></polyline>`}
    ${pts.map((p, i) =>
      p.kind === "run"
        ? html`<circle
            key=${"p" + i}
            cx=${xs[i].toFixed(1)}
            cy=${y(p.s).toFixed(1)}
            r="4.5"
            fill="var(--accent)"
          ></circle>`
        : html`<circle
            key=${"p" + i}
            cx=${xs[i].toFixed(1)}
            cy=${y(p.s).toFixed(1)}
            r="3.5"
            fill="var(--surface)"
            stroke="var(--you)"
            strokeWidth="2"
          ></circle>`,
    )}
    ${pts.map((p, i) => {
      const d = dayLabel(p.at);
      if (d === lastDay) return null;
      lastDay = d;
      return html`<text
        key=${"d" + i}
        x=${xs[i].toFixed(1)}
        y=${H - 2}
        fill="var(--muted)"
        fontSize="9"
        textAnchor="middle"
        >${d}</text
      >`;
    })}
  </svg>`;
}

function SongTrend({ runs }) {
  const vals = runs.slice(-8);
  if (vals.length < 2)
    return html`<p class="text-sm muted">
      Sing the whole song a couple of times (Karaoke works) to see your trend
      here.
    </p>`;
  const W = 300,
    H = 110,
    lo = Math.max(0, Math.min(...vals.map((r) => r.score)) - 15),
    xs = vals.map((_, i) => 14 + (i * (W - 28)) / (vals.length - 1)),
    y = (v) => H - 18 - ((v - lo) / (100 - lo)) * (H - 30);
  const line = vals
    .map((r, i) => xs[i].toFixed(1) + "," + y(r.score).toFixed(1))
    .join(" ");
  return html`<svg
    viewBox=${"0 0 " + W + " " + H}
    style=${{ width: "100%", height: "auto", display: "block" }}
    role="img"
    aria-label="Whole-song score over time"
  >
    <polygon
      points=${xs[0].toFixed(1) +
      "," +
      (H - 18) +
      " " +
      line +
      " " +
      xs[xs.length - 1].toFixed(1) +
      "," +
      (H - 18)}
      fill="var(--accent)"
      opacity="0.12"
    ></polygon>
    <polyline
      points=${line}
      fill="none"
      stroke="var(--accent)"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    ></polyline>
    ${vals.map(
      (r, i) =>
        html`<g key=${i}
          ><circle
            cx=${xs[i].toFixed(1)}
            cy=${y(r.score).toFixed(1)}
            r="3.5"
            fill="var(--accent)"
          ></circle>
          <text
            x=${xs[i].toFixed(1)}
            y=${(y(r.score) - 8).toFixed(1)}
            fill="var(--fg)"
            fontSize="10"
            textAnchor="middle"
            fontFamily="var(--font-mono)"
            >${r.score}</text
          >
          <text
            x=${xs[i].toFixed(1)}
            y=${H - 3}
            fill="var(--muted)"
            fontSize="9"
            textAnchor="middle"
            >${dayLabel(r.at)}</text
          ></g
        >`,
    )}
  </svg>`;
}

export function AnalyzeView({
  songName,
  notes,
  phrases,
  spans,
  run,
  runs,
  tries,
  canHear,
  onHearMe,
  onHearSong,
  onPractise,
  planDraft,
  onPlan,
}) {
  const [view, setView] = useState("run");
  const [order, setOrder] = useState("weak");
  const [open, setOpen] = useState(null);
  const [dtab, setDtab] = useState("notes");
  useEffect(() => setOpen(null), [run]);
  useEffect(() => setDtab("notes"), [open]);
  const textOf = (ph) => {
    let best = null,
      bo = 0;
    spans.forEach((l) => {
      const o = Math.min(l.end, ph.end) - Math.max(l.start, ph.start);
      if (o > bo) {
        bo = o;
        best = l;
      }
    });
    return best ? best.text : "";
  };
  const items = phrases.map((ph, i) => ({
    i,
    ph,
    text: textOf(ph),
    rec: run && run.lines ? run.lines[i] : null,
    hist: lineHistory(i, runs, tries),
  }));
  const sungItems = items.filter((x) => x.rec);
  const shown =
    order === "weak"
      ? [...sungItems].sort((a, b) => a.rec.score - b.rec.score)
      : sungItems;
  const good = sungItems.filter((x) => x.rec.score >= 80).length,
    weak = sungItems.filter((x) => x.rec.score < 55).length;
  const breathLines = sungItems.filter(
      (x) => x.rec.bt && x.rec.bt.breaths.length,
    ).length,
    cutLines = sungItems.filter((x) => x.rec.bt && x.rec.bt.cut).length;
  const prev = runs.length >= 2 ? runs[runs.length - 2] : null;
  const diff =
    run && prev && run.at === runs[runs.length - 1].at
      ? run.score - prev.score
      : null;
  const latest = (x) => (x.hist.length ? x.hist[x.hist.length - 1].s : null);
  const improved = items
    .filter((x) => x.hist.length >= 2 && latest(x) - x.hist[0].s >= 10)
    .sort((a, b) => latest(b) - b.hist[0].s - (latest(a) - a.hist[0].s))
    .slice(0, 3);
  const tricky = items
    .filter((x) => x.hist.length && latest(x) < 60)
    .sort((a, b) => latest(a) - latest(b))
    .slice(0, 3);
  const lineTries = Object.values(tries || {}).reduce(
    (s, t) => s + (t && t.hist ? t.hist.length : t && t.last ? 1 : 0),
    0,
  );
  const linesGood = items.filter(
    (x) => latest(x) != null && latest(x) >= 80,
  ).length;
  const openItem = open != null ? items[open] : null;
  const openInfo = openItem && openItem.rec ? tryStats(openItem.rec) : null;
  const runPts = openItem
      ? openItem.hist.filter((p) => p.kind === "run")
      : [],
    tryPts = openItem ? openItem.hist.filter((p) => p.kind === "try") : [];
  const avg = (a) => Math.round(a.reduce((s, p) => s + p.s, 0) / a.length);
  const insight =
    openItem && runPts.length && tryPts.length >= 2
      ? avg(tryPts.slice(-3)) - runPts[runPts.length - 1].s >= 10
        ? "Better when you practise it alone (" +
          avg(tryPts.slice(-3)) +
          "%) than in the full song (" +
          runPts[runPts.length - 1].s +
          "%). Try singing the line before it too, so you're ready when it comes."
        : runPts[runPts.length - 1].s - avg(tryPts.slice(-3)) >= 10
          ? "You sing it better in the full song than alone. The music around it helps you find the notes."
          : null
      : null;
  const prow = (x, a, b) =>
    html`<button
      key=${x.i}
      onClick=${() => onPractise(x.ph)}
      class="flex items-center gap-3"
      style=${{
        width: "100%",
        padding: "9px 0",
        borderTop: "1px solid var(--line)",
        background: "none",
        border: 0,
        borderTopStyle: "solid",
        borderTopWidth: 1,
        borderTopColor: "var(--line)",
        color: "var(--fg)",
        font: "inherit",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      <span class="mono text-xs muted" style=${{ width: 20 }}
        >${String(x.i + 1).padStart(2, "0")}</span
      >
      <span
        class="text-sm font-semibold"
        style=${{
          flex: 1,
          minWidth: 0,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
        >${x.text || "Phrase " + (x.i + 1)}</span
      >
      <${Spark} vals=${x.hist.map((p) => p.s)} w=${56} h=${20} />
      <span class="mono text-xs" style=${{ whiteSpace: "nowrap" }}
        ><span class="muted">${a}</span> →
        <b style=${{ color: "var(--" + scoreTone(b) + ")" }}>${b}</b></span
      >
    </button>`;
  return html`<div class="flex flex-col gap-3">
    <div
      class="seg"
      role="group"
      aria-label="Analyze view"
      style=${{ display: "grid", gridTemplateColumns: "1fr 1fr" }}
    >
      <button
        aria-pressed=${view === "run" ? "true" : "false"}
        onClick=${() => setView("run")}
      >
        This run
      </button>
      <button
        aria-pressed=${view === "progress" ? "true" : "false"}
        onClick=${() => setView("progress")}
      >
        Progress
      </button>
    </div>
    ${view === "run" &&
    (!run
      ? html`<p class="text-sm muted">
          No whole-song run for this song yet. Sing it in Karaoke, or upload a
          recording above, and every line gets checked here.
        </p>`
      : html`<${React.Fragment}>
          <section class="panel p-4 flex items-center gap-3">
            <span
              class="flex flex-col gap-1"
              style=${{ flex: 1, minWidth: 0 }}
            >
              <span class="label"
                >${(run.src || "Your run") + " · " + dayLabel(run.at)}</span
              >
              <span
                class="display font-bold"
                style=${{
                  fontSize: 28,
                  color: "var(--" + scoreTone(run.score) + ")",
                }}
                >${run.score}%${diff
                  ? html` <span
                      style=${{
                        fontSize: 14,
                        color: diff > 0 ? "var(--good)" : "var(--muted)",
                      }}
                      >${diff > 0 ? "▲ " + diff : "▼ " + -diff}</span
                    >`
                  : ""}</span
              >
              <span class="text-xs muted"
                >${good} of ${sungItems.length} lines
                good${weak
                  ? " · " + weak + " to work on"
                  : ""}${sungItems.length < phrases.length
                  ? " · " + (phrases.length - sungItems.length) + " not sung"
                  : ""}</span
              >
              ${(breathLines > 0 || cutLines > 0) &&
              html`<span class="text-xs muted"
                >${[
                  breathLines
                    ? breathLines +
                      " line" +
                      (breathLines > 1 ? "s" : "") +
                      " with a mid-line breath"
                    : "",
                  cutLines ? cutLines + " ended short" : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}</span
              >`}
            </span>
            <${Spark} vals=${runs.map((r) => r.score)} w=${96} h=${40} />
          </section>
          ${planDraft &&
          html`<button
            class="link-btn text-sm"
            style=${{ alignSelf: "flex-start", textDecoration: "none" }}
            onClick=${onPlan}
          >
            ${planDraft.drills.length}
            drill${planDraft.drills.length > 1 ? "s" : ""} made from this run
            →
          </button>`}
          <div class="flex items-center justify-between">
            <span class="label"
              >${order === "weak"
                ? "Work on these first"
                : "Every line"}</span
            >
            <button
              class="link-btn text-xs"
              style=${{ textDecoration: "none", color: "var(--muted)" }}
              onClick=${() => setOrder(order === "weak" ? "song" : "weak")}
            >
              ${order === "weak" ? "Weakest first ▾" : "Song order ▾"}
            </button>
          </div>
          ${shown.map((x) => {
            const info = tryStats(x.rec);
            return html`<section
              key=${x.i}
              class="panel"
              style=${{
                padding: "12px 14px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                borderColor:
                  x.rec.score < 55
                    ? "color-mix(in srgb, var(--bad) 40%, var(--line))"
                    : undefined,
              }}
            >
              <div class="flex items-center gap-2 flex-wrap">
                <span class="mono text-xs muted"
                  >${String(x.i + 1).padStart(2, "0")} ·
                  ${fmt(x.ph.start)}</span
                >
                ${x.ph.tags.slice(0, 2).map(
                  (t) =>
                    html`<span
                      key=${t}
                      class="text-xs"
                      style=${{
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: "var(--surface-2)",
                        color: "var(--muted)",
                        fontWeight: 600,
                      }}
                      >${t}</span
                    >`,
                )}
                <span
                  class="display font-bold"
                  style=${{
                    marginLeft: "auto",
                    fontSize: 20,
                    color: "var(--" + scoreTone(x.rec.score) + ")",
                  }}
                  >${x.rec.score}%</span
                >
              </div>
              ${x.text &&
              html`<b style=${{ fontSize: 15, lineHeight: 1.3 }}
                >${x.text}</b
              >`}
              <div
                style=${{
                  padding: "6px 8px",
                  borderRadius: 10,
                  background: "var(--surface-2)",
                  border: "1px solid var(--line)",
                }}
              >
                <${TryChart} rec=${x.rec} notes=${notes} />
              </div>
              <${BtTags} tags=${btInfo(x.rec, notes, x.text).tags} />
              <div class="flex items-center gap-2">
                <span class="text-xs" style=${{ flex: 1 }}>${info.tip}</span
                ><${Spark} vals=${x.hist.map((p) => p.s)} />
              </div>
              <div class="flex items-center gap-2 flex-wrap">
                <button
                  class="btn"
                  style=${{
                    padding: "5px 10px",
                    fontSize: 12,
                    color: "var(--you)",
                  }}
                  disabled=${!canHear}
                  onClick=${() => onHearMe(x.rec)}
                  title=${canHear
                    ? ""
                    : "The recording isn't kept after you leave"}
                >
                  ▶ Me
                </button>
                <button
                  class="btn"
                  style=${{ padding: "5px 10px", fontSize: 12 }}
                  onClick=${() => onHearSong(x.ph)}
                >
                  ▶ Song
                </button>
                <button
                  class="btn"
                  style=${{ padding: "5px 10px", fontSize: 12 }}
                  onClick=${() => setOpen(x.i)}
                >
                  Details
                </button>
                <button
                  class="btn btn-primary"
                  style=${{
                    padding: "5px 10px",
                    fontSize: 12,
                    marginLeft: "auto",
                  }}
                  onClick=${() => onPractise(x.ph)}
                >
                  Practise this line →
                </button>
              </div>
            </section>`;
          })}
          ${!canHear &&
          html`<p class="text-xs muted">
            This is your last saved run. Recordings aren't kept after you
            leave, but the scores are.
          </p>`}
        <//>`)}
    ${view === "progress" &&
    html`<${React.Fragment}>
      <section class="panel p-4 flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <span class="label">Whole song</span>${runs.length >= 2 &&
          html`<span
            class="text-xs font-semibold"
            style=${{
              color:
                runs[runs.length - 1].score >= runs[0].score
                  ? "var(--good)"
                  : "var(--muted)",
            }}
            >${runs[runs.length - 1].score >= runs[0].score
              ? "▲ "
              : "▼ "}${Math.abs(runs[runs.length - 1].score - runs[0].score)}
            since your first run</span
          >`}
        </div>
        <${SongTrend} runs=${runs} />
        <div class="grid grid-cols-3 gap-2" style=${{ marginTop: 4 }}>
          ${[
            ["Runs", runs.length, ""],
            ["Line tries", lineTries, ""],
            ["Lines good", linesGood + "/" + phrases.length, "good"],
          ].map(
            ([l, v, t]) =>
              html`<div
                key=${l}
                style=${{
                  padding: "8px 10px",
                  borderRadius: 12,
                  background: "var(--surface-2)",
                }}
              >
                <div class="label" style=${{ fontSize: 10 }}>${l}</div>
                <b
                  class="display"
                  style=${{
                    fontSize: 18,
                    color: t ? "var(--" + t + ")" : undefined,
                  }}
                  >${v}</b
                >
              </div>`,
          )}
        </div>
      </section>
      <section class="panel" style=${{ padding: "12px 14px 4px" }}>
        <div class="flex justify-between" style=${{ paddingBottom: 6 }}>
          <span class="label">Most improved</span
          ><span class="text-xs muted">first → now</span>
        </div>
        ${improved.length
          ? improved.map((x) => prow(x, x.hist[0].s, latest(x)))
          : html`<p class="text-xs muted" style=${{ paddingBottom: 10 }}>
              Lines that get 10+ points better show up here.
            </p>`}
      </section>
      <section class="panel" style=${{ padding: "12px 14px 4px" }}>
        <div class="flex justify-between" style=${{ paddingBottom: 6 }}>
          <span class="label">Still tricky</span>${tricky.length > 0 &&
          html`<button
            class="link-btn text-xs"
            style=${{ textDecoration: "none" }}
            onClick=${() => onPractise(tricky[0].ph)}
          >
            Practise ${tricky.length > 1 ? "the first one" : "it"} →
          </button>`}
        </div>
        ${tricky.length
          ? tricky.map((x) => prow(x, x.hist[0].s, latest(x)))
          : html`<p class="text-xs muted" style=${{ paddingBottom: 10 }}>
              No lines under 60% right now. Nice.
            </p>`}
      </section>
    <//>`}
    <${Sheet}
      open=${!!(openItem && openInfo)}
      title=${openItem
        ? openItem.text
          ? "“" + openItem.text + "”"
          : "Phrase " + (openItem.i + 1)
        : ""}
      onClose=${() => setOpen(null)}
    >
      ${openItem &&
      openInfo &&
      html`<div class="flex flex-col gap-3">
        <span class="text-sm muted"
          >Line ${openItem.i + 1} · this run ${openItem.rec.score}%</span
        >
        <div
          class="seg"
          role="group"
          aria-label="Details"
          style=${{ display: "grid", gridTemplateColumns: "1fr 1.4fr 1fr" }}
        >
          ${[
            ["notes", "Notes"],
            ["bt", "Breath & timing"],
            ["time", "Over time"],
          ].map(
            ([k, l]) =>
              html`<button
                key=${k}
                aria-pressed=${dtab === k ? "true" : "false"}
                onClick=${() => setDtab(k)}
              >
                ${l}
              </button>`,
          )}
        </div>
        ${dtab === "bt" &&
        html`<${BreathTimingView}
          rec=${openItem.rec}
          notes=${notes}
          text=${openItem.text}
        />`}
        ${dtab === "notes" &&
        html`<${React.Fragment}>
          <div
            style=${{
              padding: 10,
              borderRadius: 14,
              background: "var(--surface-2)",
              border: "1px solid var(--line)",
            }}
          >
            <${TryChart} rec=${openItem.rec} notes=${notes} />
            <div
              class="flex gap-4 text-xs muted"
              style=${{ padding: "4px 4px 0" }}
            >
              <span class="flex items-center gap-1"
                ><span
                  style=${{
                    width: 14,
                    height: 6,
                    borderRadius: 3,
                    background: "var(--accent)",
                    opacity: 0.6,
                  }}
                ></span
                >Song</span
              >
              <span class="flex items-center gap-1"
                ><span
                  style=${{
                    width: 14,
                    height: 3,
                    borderRadius: 2,
                    background: "var(--you)",
                  }}
                ></span
                >You</span
              >
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2">
            ${openInfo.stats.map(
              (st) =>
                html`<div
                  key=${st.label}
                  style=${{
                    padding: "10px 12px",
                    borderRadius: 12,
                    background: "var(--surface-2)",
                  }}
                >
                  <div class="label" style=${{ fontSize: 10 }}>
                    ${st.label}
                  </div>
                  <div
                    class="display font-bold"
                    style=${{ fontSize: 18, color: "var(--" + st.tone + ")" }}
                  >
                    ${st.value}
                  </div>
                  <div class="text-xs muted">${st.note}</div>
                </div>`,
            )}
          </div>
          <div
            class="flex items-start gap-2 text-sm"
            style=${{
              padding: "12px 14px",
              borderRadius: 14,
              background: "color-mix(in srgb, var(--accent) 8%, transparent)",
              border:
                "1px solid color-mix(in srgb, var(--accent) 28%, transparent)",
            }}
          >
            <span aria-hidden="true">🎯</span
            ><span><b>Tip:</b> ${openInfo.tip}</span>
          </div>
        <//>`}
        ${dtab === "time" &&
        html`<div
          class="flex flex-col gap-2"
          style=${{
            padding: "12px 14px",
            borderRadius: 14,
            background: "var(--surface-2)",
            border: "1px solid var(--line)",
          }}
        >
          <div class="flex items-center justify-between flex-wrap gap-2">
            <span class="label">This line over time</span
            ><span class="text-xs muted"
              ><span style=${{ color: "var(--accent)" }}>●</span> whole-song
              runs <span style=${{ color: "var(--you)" }}>○</span> practice
              tries</span
            >
          </div>
          <${HistChart} pts=${openItem.hist} />
          ${insight && html`<span class="text-xs">${insight}</span>`}
        </div>`}
        <div class="grid grid-cols-2 gap-2">
          <button
            class="btn"
            style=${{ justifyContent: "center", minHeight: 46 }}
            disabled=${!canHear}
            onClick=${() => onHearMe(openItem.rec)}
          >
            ▶ Hear me
          </button>
          <button
            class="btn btn-primary"
            style=${{ justifyContent: "center", minHeight: 46 }}
            onClick=${() => {
              setOpen(null);
              onPractise(openItem.ph);
            }}
          >
            Practise this line →
          </button>
        </div>
      </div>`}
    <//>
  </div>`;
}

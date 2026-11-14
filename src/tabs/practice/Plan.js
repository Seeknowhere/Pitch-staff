// Practice plan cards and the guided drill flow.
import { useState, useMemo, useEffect } from "react";
import { html } from "../../html.js";
import { fmt } from "../../lib/music.js";
import { FlowHead } from "../lessons/Lessons.js";
import { lessonRange } from "../lessons/data.js";
import { Exercise } from "../lessons/exercises.js";
import { useLessonMic } from "../lessons/hooks.js";

export function PlanCard({ plan, onStart, onHide, onClear }) {
  const n = plan.drills.length,
    dn = plan.drills.filter((d) => plan.done[d.id] != null).length;
  const nextK = plan.drills.findIndex((d) => plan.done[d.id] == null);
  const when = new Date(plan.at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const avg = (xs) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  const before = plan.checks.length
    ? avg(plan.checks.map((c) => c.before))
    : null;
  const after =
    plan.after && plan.after.scores.length ? avg(plan.after.scores) : null;
  const icon = { slide: "↗", jump: "⤴", hold: "━", end: "↘", line: "♪" };
  return html`<section
    class="flex flex-col gap-2"
    style=${{
      padding: 14,
      borderRadius: 20,
      background:
        "radial-gradient(120% 120% at 100% 0%, color-mix(in srgb, var(--accent) 20%, transparent), transparent 60%), var(--surface)",
      border: "1px solid color-mix(in srgb, var(--accent) 35%, transparent)",
    }}
  >
    <div class="flex items-baseline justify-between gap-2">
      <span class="display font-bold" style=${{ fontSize: 20 }}
        >Your plan</span
      ><span class="text-xs muted">${dn} of ${n} done</span>
    </div>
    <span class="text-xs muted"
      >From your
      ${plan.source === "repeat" ? "Repeat after me scores" : "take"} on
      ${when}</span
    >
    ${plan.drills.map((d, k) => {
      const done = plan.done[d.id] != null,
        now = k === nextK;
      return html`<button
        key=${d.id}
        class="flex items-center gap-3"
        onClick=${() => onStart(k)}
        style=${{
          textAlign: "left",
          padding: 12,
          borderRadius: 14,
          font: "inherit",
          color: "var(--fg)",
          cursor: "pointer",
          background: now ? "var(--surface-2)" : "transparent",
          border:
            "1px solid " +
            (now
              ? "color-mix(in srgb, var(--accent) 40%, transparent)"
              : "var(--line)"),
        }}
      >
        <span
          style=${{
            width: 36,
            height: 36,
            borderRadius: 11,
            flexShrink: 0,
            display: "grid",
            placeItems: "center",
            fontSize: 17,
            fontWeight: 700,
            background: done
              ? "var(--good)"
              : "color-mix(in srgb, var(--accent) 15%, transparent)",
            color: done ? "var(--bg)" : "var(--accent)",
          }}
          >${done ? "✓" : icon[d.kind] || "♪"}</span
        >
        <span class="flex flex-col min-w-0" style=${{ flex: 1 }}
          ><b class="text-sm">${k + 1}. ${d.title}</b
          ><span class="text-xs muted">${d.why}</span></span
        >
        <span
          class="text-xs font-semibold"
          style=${{
            color: now ? "var(--accent)" : "var(--muted)",
            whiteSpace: "nowrap",
          }}
          >${done ? plan.done[d.id] + "%" : now ? "Start" : ""}</span
        >
      </button>`;
    })}
    ${after != null &&
    before != null &&
    html`<div class="text-sm" style=${{ padding: "8px 2px" }}>
      Re-check: <span class="mono muted">${before}%</span> →
      <b
        class="mono"
        style=${{ color: after >= before ? "var(--good)" : "var(--warn)" }}
        >${after}%</b
      >
      on these lines
    </div>`}
    <div
      class="flex flex-wrap items-center justify-between gap-2"
      style=${{ paddingTop: 2 }}
    >
      <span class="text-xs muted"
        >${plan.checks.length
          ? dn < n
            ? "Then a quick re-check of these lines"
            : ""
          : ""}</span
      >
      <span class="flex gap-3">
        <button
          class="link-btn text-xs"
          style=${{ color: "var(--muted)" }}
          onClick=${onHide}
        >
          Hide
        </button>
        <button
          class="link-btn text-xs"
          style=${{ color: "var(--muted)" }}
          onClick=${onClear}
        >
          Clear plan
        </button>
      </span>
    </div>
    ${dn === n &&
    html`<button
      class="btn btn-primary"
      style=${{ justifyContent: "center", minHeight: 44 }}
      onClick=${() => onStart(plan.checks.length ? "check" : 0)}
    >
      ${plan.checks.length
        ? after != null
          ? "Re-check again"
          : "Re-check these lines"
        : "Go again"}
    </button>`}
    ${dn < n &&
    html`<button
      class="btn btn-primary"
      style=${{ justifyContent: "center", minHeight: 44 }}
      onClick=${() => onStart(nextK)}
    >
      ${dn ? "Continue plan" : "Start plan"}
    </button>`}
  </section>`;
}

export function PlanFlow({
  plan,
  songTitle,
  buffer,
  start,
  onClose,
  onUpdate,
  onKaraoke,
}) {
  const first =
    start === "check" ? { v: "check", k: 0 } : { v: "drill", k: start };
  const [step, setStep] = useState(first);
  const [runKey, setRunKey] = useState(0);
  const [scores, setScores] = useState([]);
  const mic = useLessonMic(step.v === "drill" || step.v === "check");
  const range = useMemo(lessonRange, []);
  useEffect(() => {
    try {
      window.scrollTo(0, 0);
    } catch (e) {}
  }, [step.v, step.k]);
  const D = plan.drills,
    C = plan.checks;
  const total = D.length + (C.length ? 1 : 0);
  const nextUndone = (from) => {
    for (let i = 1; i <= D.length; i++) {
      const k = (from + i) % D.length;
      if (plan.done[D[k].id] == null) return k;
    }
    return -1;
  };
  const head = (p, label) =>
    html`<${FlowHead} p=${p} label=${label} onClose=${onClose} />`;
  const again = () => setRunKey((n) => n + 1);

  if (step.v === "drill") {
    const d = D[step.k];
    return html`<div class="flex flex-col gap-4">
      ${head(
        ((step.k + 0.5) / total) * 100,
        "Drill " + (step.k + 1) + "/" + D.length,
      )}
      <span class="label" style=${{ color: "var(--accent)" }}
        >From your
        ${plan.source === "repeat" ? "practice" : "take"}${songTitle
          ? " · " + songTitle
          : ""}</span
      >
      <h2
        class="display font-bold"
        style=${{ fontSize: 26, lineHeight: 1.15, margin: 0 }}
      >
        ${d.title}
      </h2>
      <p class="text-sm muted" style=${{ margin: 0 }}>
        ${d.detail} ${d.why}.
      </p>
      ${d.spec.stages &&
      html`<div class="flex gap-2">
        ${d.spec.stages.map(
          (s, i) =>
            html`<span
              key=${s}
              class="flex flex-col items-center gap-1"
              style=${{ flex: 1 }}
              ><span
                style=${{
                  width: "100%",
                  height: 6,
                  borderRadius: 3,
                  background: "var(--line)",
                }}
              ></span
              ><span class="text-xs muted">${s}</span></span
            >`,
        )}
      </div>`}
      <${Exercise}
        key=${runKey + "-d" + step.k}
        spec=${d.spec}
        range=${range}
        mic=${mic}
        onDone=${(res) => {
          const next = {
            ...plan,
            done: {
              ...plan.done,
              [d.id]: Math.max(plan.done[d.id] || 0, res.score),
            },
          };
          onUpdate(next);
          setStep({ v: "drillDone", k: step.k, res });
        }}
      />
      <div
        class="flex items-start gap-2 text-sm"
        style=${{
          padding: "10px 12px",
          borderRadius: 12,
          background: "color-mix(in srgb, var(--accent) 8%, transparent)",
          border:
            "1px solid color-mix(in srgb, var(--accent) 28%, transparent)",
        }}
      >
        <span aria-hidden="true">🎯</span><span>${d.tip}</span>
      </div>
    </div>`;
  }
  if (step.v === "drillDone") {
    const d = D[step.k],
      res = step.res,
      nk = nextUndone(step.k);
    return html`<div class="flex flex-col gap-4">
      ${head(
        ((step.k + 1) / total) * 100,
        "Drill " + (step.k + 1) + "/" + D.length,
      )}
      <div
        class="flex flex-col items-center gap-1 text-center"
        style=${{ paddingTop: 10 }}
      >
        <span class="display font-bold" style=${{ fontSize: 24 }}
          >${d.title}</span
        >
        <span
          class="display font-bold"
          style=${{
            fontSize: 56,
            lineHeight: 1,
            color: res.score >= 70 ? "var(--good)" : "var(--accent)",
          }}
          >${res.score}%</span
        >
        <span class="text-sm muted"
          >${res.score >= 85
            ? "Nailed it."
            : res.score >= 70
              ? "Good. That's getting solid."
              : "Keep at it. One more go often helps."}</span
        >
      </div>
      ${res.tip &&
      html`<div
        class="flex items-start gap-2 text-sm"
        style=${{
          padding: "12px 14px",
          borderRadius: 14,
          background: "color-mix(in srgb, var(--accent) 8%, transparent)",
          border:
            "1px solid color-mix(in srgb, var(--accent) 30%, transparent)",
        }}
      >
        <span aria-hidden="true">🎯</span><span><b>Tip:</b> ${res.tip}</span>
      </div>`}
      <div class="grid grid-cols-2 gap-2">
        <button
          class="btn"
          style=${{ justifyContent: "center", minHeight: 48 }}
          onClick=${() => {
            again();
            setStep({ v: "drill", k: step.k });
          }}
        >
          Try again
        </button>
        ${nk >= 0
          ? html`<button
              class="btn btn-primary"
              style=${{ justifyContent: "center", minHeight: 48 }}
              onClick=${() => {
                again();
                setStep({ v: "drill", k: nk });
              }}
            >
              Next drill →
            </button>`
          : C.length
            ? html`<button
                class="btn btn-primary"
                style=${{ justifyContent: "center", minHeight: 48 }}
                onClick=${() => {
                  again();
                  setScores([]);
                  setStep({ v: "check", k: 0 });
                }}
              >
                Re-check →
              </button>`
            : html`<button
                class="btn btn-primary"
                style=${{ justifyContent: "center", minHeight: 48 }}
                onClick=${onClose}
              >
                Done
              </button>`}
      </div>
    </div>`;
  }
  if (step.v === "check") {
    const c = C[step.k];
    const spec = {
      type: "pattern",
      fixed: c.notes,
      rounds: 1,
      tol: 0.5,
      source: buffer
        ? { buffer, start: Math.max(0, c.start - 0.1), end: c.end + 0.1 }
        : null,
      steps: [600],
    };
    return html`<div class="flex flex-col gap-4">
      ${head(
        ((D.length + (step.k + 0.5) / C.length) / total) * 100,
        "Re-check " + (step.k + 1) + "/" + C.length,
      )}
      <span class="label" style=${{ color: "var(--accent)" }}>Re-check</span>
      <h2
        class="display font-bold"
        style=${{ fontSize: 24, lineHeight: 1.2, margin: 0 }}
      >
        ${c.text ? "“" + c.text + "”" : "Phrase at " + fmt(c.start)}
      </h2>
      <p class="text-sm muted" style=${{ margin: 0 }}>
        ${buffer
          ? "Listen to the original line, then sing it back."
          : "Listen to the notes, then sing them back."}
        Before your plan you got ${c.before}%.
      </p>
      <${Exercise}
        key=${runKey + "-c" + step.k}
        spec=${spec}
        range=${range}
        mic=${mic}
        onDone=${(res) => {
          const sc = [...scores];
          sc[step.k] = res.score;
          setScores(sc);
          if (step.k + 1 < C.length) {
            again();
            setStep({ v: "check", k: step.k + 1 });
          } else {
            onUpdate({ ...plan, after: { at: Date.now(), scores: sc } });
            setStep({ v: "compare" });
          }
        }}
      />
    </div>`;
  }
  // compare before and after
  const sc = scores;
  const better = C.filter((c, i) => sc[i] > c.before).length;
  const worst = C.map((c, i) => ({ c, s: sc[i] })).sort(
    (a, b) => a.s - b.s,
  )[0];
  const worstDrill = worst ? D.findIndex((d) => d.line === worst.c.li) : -1;
  return html`<div class="flex flex-col gap-4">
    ${head(100, "Re-check")}
    <div
      class="flex flex-col items-center gap-1 text-center"
      style=${{ paddingTop: 8 }}
    >
      <span style=${{ fontSize: 40 }} aria-hidden="true"
        >${better ? "📈" : "💪"}</span
      >
      <span class="display font-bold" style=${{ fontSize: 28 }}
        >${better === C.length
          ? "You improved!"
          : better
            ? "Getting better!"
            : "Keep going"}</span
      >
      <span class="text-sm muted"
        >Before your plan and after it, line by line.</span
      >
    </div>
    <section class="panel p-4 flex flex-col gap-3">
      <span class="label">Before → after</span>
      ${C.map(
        (c, i) =>
          html`<div key=${i} class="flex flex-col gap-1">
            <span class="flex justify-between gap-2 text-sm"
              ><span
                style=${{
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                >${c.text
                  ? "“" + c.text + "”"
                  : "Phrase at " + fmt(c.start)}</span
              ><span class="mono text-xs" style=${{ whiteSpace: "nowrap" }}
                ><span class="muted">${c.before}%</span> →
                <b
                  style=${{
                    color: sc[i] >= c.before ? "var(--good)" : "var(--warn)",
                  }}
                  >${sc[i]}%</b
                ></span
              ></span
            >
            <span
              style=${{
                position: "relative",
                display: "block",
                height: 8,
                borderRadius: 999,
                background: "var(--line)",
                overflow: "hidden",
              }}
            >
              <span
                style=${{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: Math.max(c.before, sc[i]) + "%",
                  background:
                    sc[i] >= c.before ? "var(--good)" : "var(--warn)",
                }}
              ></span>
              <span
                style=${{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: Math.min(c.before, sc[i]) + "%",
                  background: "var(--muted)",
                }}
              ></span>
            </span>
          </div>`,
      )}
    </section>
    ${worst &&
    worst.s < 80 &&
    html`<div
      class="flex items-start gap-2 text-sm"
      style=${{
        padding: "12px 14px",
        borderRadius: 14,
        background: "color-mix(in srgb, var(--good) 8%, transparent)",
        border: "1px solid color-mix(in srgb, var(--good) 28%, transparent)",
      }}
    >
      <span aria-hidden="true">💡</span
      ><span
        >${worst.c.text ? "“" + worst.c.text + "”" : "That phrase"} still
        needs a little
        work.${worstDrill >= 0
          ? " Run drill " + (worstDrill + 1) + " once more tomorrow."
          : ""}</span
      >
    </div>`}
    <div class="grid grid-cols-2 gap-2">
      <button
        class="btn"
        style=${{ justifyContent: "center", minHeight: 48 }}
        onClick=${() => {
          again();
          setStep({ v: "drill", k: Math.max(0, worstDrill) });
        }}
      >
        Redo a drill
      </button>
      <button
        class="btn btn-primary"
        style=${{ justifyContent: "center", minHeight: 48 }}
        onClick=${onKaraoke}
      >
        Sing it in Karaoke
      </button>
    </div>
  </div>`;
}

/* ---------- Lessons ---------- */

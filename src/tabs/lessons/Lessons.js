// The Lessons tab.
import { useMemo, useState, useEffect } from "react";
import { Icon } from "../../components/Icon.js";
import { html } from "../../html.js";
import { playPiano } from "../../lib/audio.js";
import { saveJSON, MATCH_KEY } from "../../lib/storage.js";
import { COURSES, SOON, bumpStreak, streakNow, loadLessons, WARMUP, LESSON_KEY, dayKey, lessonRange } from "./data.js";
import { Exercise, patternFor, nm } from "./exercises.js";
import { useLessonMic } from "./hooks.js";

const Bar = ({ p, tone = "accent", h = 6 }) =>
  html`<span
    style=${{
      display: "block",
      height: h,
      borderRadius: 999,
      background: "var(--line)",
      overflow: "hidden",
    }}
    ><span
      style=${{
        display: "block",
        width: Math.max(0, Math.min(100, p)) + "%",
        height: "100%",
        background: "var(--" + tone + ")",
        transition: "width .3s",
      }}
    ></span
  ></span>`;

export const FlowHead = ({ p, label, onClose, title }) =>
  html`<div class="flex items-center gap-3">
    <button class="icon-btn" onClick=${onClose} aria-label="Leave lesson">
      <${Icon} name="x" size=${18} />
    </button>
    ${title
      ? html`<span
          class="display font-bold"
          style=${{ flex: 1, fontSize: 18 }}
          >${title}</span
        >`
      : html`<span style=${{ flex: 1 }}><${Bar} p=${p} /></span>`}
    <span class="mono text-xs muted">${label}</span>
  </div>`;

export function Lessons({ active, onGo, onFocus }) {
  const [st, setSt] = useState(loadLessons);
  const [view, setView] = useState({ v: "home" });
  const [runKey, setRunKey] = useState(0);
  const flow = view.v === "lesson" || view.v === "warm";
  const mic = useLessonMic(
    active && flow && (view.v === "warm" || view.step === "do"),
  );
  const range = useMemo(lessonRange, [active, view.v]);
  useEffect(() => {
    onFocus && onFocus(active && flow);
  }, [active, flow]);
  useEffect(() => () => onFocus && onFocus(false), []);
  useEffect(() => {
    try {
      window.scrollTo(0, 0);
    } catch (e) {}
  }, [view.v, view.step, view.k]);
  const save = (next) => {
    setSt(next);
    saveJSON(LESSON_KEY, next);
  };
  const course = view.c != null ? COURSES.find((c) => c.id === view.c) : null;
  const unlocked = (c, i) => i === 0 || st.done[c.lessons[i - 1].id] != null;
  const doneCount = (c) =>
    c.lessons.filter((l) => st.done[l.id] != null).length;
  const today = dayKey();
  const warmStep = st.warm && st.warm.date === today ? st.warm.step : 0;
  const streak = streakNow(st);
  const findRange = () => {
    saveJSON(MATCH_KEY + ".mode", "range");
    onGo && onGo("live");
  };

  // ---- lesson flow ----
  if (view.v === "lesson" && course) {
    const li = view.l,
      L = course.lessons[li];
    const close = () => setView({ v: "course", c: course.id });
    const steps = ["learn", "do", "result"],
      si = steps.indexOf(view.step);
    const head = html`<${FlowHead}
      p=${((si + 1) / 3) * 100}
      label=${si + 1 + "/3"}
      onClose=${close}
    />`;
    if (view.step === "learn") {
      const preview = () => {
        const ctx = mic.ctx();
        if (L.type === "hold") playPiano(ctx, range.center, 2);
        if (L.type === "pattern") {
          const p = patternFor(L, range),
            b = Math.max(
              range.full.lo,
              Math.min(
                range.lo,
                range.center - Math.round(Math.max(...p) / 2),
              ),
            );
          p.forEach((x, j) =>
            setTimeout(() => playPiano(ctx, b + x, 1.5), j * 600),
          );
        }
      };
      return html`<div class="flex flex-col gap-4">
        ${head}
        <span class="label" style=${{ color: "var(--accent)" }}
          >${course.title} · Lesson ${li + 1}</span
        >
        <h2
          class="display font-bold"
          style=${{ fontSize: 28, lineHeight: 1.15, margin: 0 }}
        >
          ${L.title}
        </h2>
        <p style=${{ margin: 0, fontSize: 15, lineHeight: 1.55 }}>
          ${L.learn}
        </p>
        <section class="panel p-4 flex flex-col gap-2">
          <span class="label">How to do it</span>
          <ol
            class="text-sm flex flex-col gap-1"
            style=${{ margin: 0, paddingLeft: 20 }}
          >
            ${L.steps.map((s, i) => html`<li key=${i}>${s}</li>`)}
          </ol>
        </section>
        ${(L.type === "hold" || L.type === "pattern") &&
        html`<button
          class="panel p-3 flex items-center gap-3"
          style=${{
            textAlign: "left",
            color: "var(--fg)",
            font: "inherit",
            cursor: "pointer",
          }}
          onClick=${preview}
        >
          <span class="round-btn primary" style=${{ width: 44, height: 44 }}
            ><${Icon} name="play" size=${18}
          /></span>
          <span class="flex flex-col"
            ><b class="text-sm">Hear the exercise</b
            ><span class="text-xs muted"
              >${L.type === "hold"
                ? "The kind of note you'll sing"
                : "The pattern you'll sing back"}</span
            ></span
          >
        </button>`}
        <div
          class="flex items-start gap-2 text-sm"
          style=${{
            padding: "12px 14px",
            borderRadius: 14,
            background: "color-mix(in srgb, var(--good) 8%, transparent)",
            border:
              "1px solid color-mix(in srgb, var(--good) 30%, transparent)",
          }}
        >
          <span aria-hidden="true">💡</span><span>${L.tip}</span>
        </div>
        ${!range.saved &&
        (L.type === "hold" || L.type === "pattern" || L.type === "siren") &&
        html`<p class="text-xs muted" style=${{ margin: 0 }}>
          Notes are set to a middle range that suits most voices, and any
          octave counts.
          <button class="link-btn" onClick=${findRange}>Find my range</button>
          to fit them to you.
        </p>`}
        <button
          class="btn btn-primary"
          style=${{ justifyContent: "center", minHeight: 48, fontSize: 16 }}
          onClick=${() => {
            setRunKey((n) => n + 1);
            setView({ ...view, step: "do" });
          }}
        >
          I'm ready
        </button>
      </div>`;
    }
    if (view.step === "do")
      return html`<div class="flex flex-col gap-4">
        ${head}
        <${Exercise}
          key=${runKey}
          spec=${L}
          range=${range}
          mic=${mic}
          onDone=${(res) => {
            let next = { ...st, done: { ...st.done } };
            if (res.pass)
              next.done[L.id] = Math.max(next.done[L.id] || 0, res.score);
            save(bumpStreak(next));
            setView({ ...view, step: "result", res });
          }}
        />
      </div>`;
    const res = view.res,
      nextL = li + 1 < course.lessons.length ? li + 1 : null;
    return html`<div class="flex flex-col gap-4">
      ${head}
      <div
        class="flex flex-col items-center gap-1 text-center"
        style=${{ paddingTop: 10 }}
      >
        <span
          style=${{
            width: 64,
            height: 64,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            background:
              "color-mix(in srgb, var(--" +
              (res.pass ? "good" : "warn") +
              ") 15%, transparent)",
            color: "var(--" + (res.pass ? "good" : "warn") + ")",
            fontSize: 30,
            fontWeight: 700,
          }}
          >${res.pass ? "✓" : "↻"}</span
        >
        <span class="display font-bold" style=${{ fontSize: 28 }}
          >${res.simple
            ? "Lesson done"
            : res.pass
              ? "Lesson passed"
              : "Almost there"}</span
        >
        ${!res.simple &&
        html`<span
            class="display font-bold"
            style=${{ fontSize: 56, lineHeight: 1, color: "var(--accent)" }}
            >${res.score}%</span
          >
          <span class="text-sm muted"
            >${res.pass
              ? "Pass mark 70%"
              : "Get 70% to pass and unlock the next lesson"}</span
          >`}
      </div>
      ${res.stats.length > 0 &&
      html`<section class="panel p-4 flex flex-col gap-3">
        <span class="label">What Tono heard</span>
        ${res.stats.map(
          (s) =>
            html`<div key=${s.label} class="flex flex-col gap-1">
              <span class="flex justify-between text-sm"
                ><span>${s.label}</span
                ><span
                  class="mono text-xs"
                  style=${{
                    color: s.pct >= 70 ? "var(--good)" : "var(--warn)",
                  }}
                  >${s.value}</span
                ></span
              >
              <${Bar}
                p=${s.pct}
                tone=${s.pct >= 70 ? "good" : "warn"}
                h=${5}
              />
            </div>`,
        )}
      </section>`}
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
            setRunKey((n) => n + 1);
            setView({ ...view, step: "do", res: null });
          }}
        >
          Try again
        </button>
        ${res.pass && nextL != null
          ? html`<button
              class="btn btn-primary"
              style=${{ justifyContent: "center", minHeight: 48 }}
              onClick=${() =>
                setView({
                  v: "lesson",
                  c: course.id,
                  l: nextL,
                  step: "learn",
                })}
            >
              Next lesson →
            </button>`
          : html`<button
              class="btn btn-primary"
              style=${{ justifyContent: "center", minHeight: 48 }}
              onClick=${close}
            >
              ${res.pass ? "Back to course" : "Back"}
            </button>`}
      </div>
      ${res.pass &&
      nextL == null &&
      course.id === "pitch" &&
      html`<button
        class="btn btn-ghost"
        style=${{ alignSelf: "center" }}
        onClick=${() => onGo && onGo("learn")}
      >
        Try a real song in Practice →
      </button>`}
    </div>`;
  }

  // ---- daily warm-up ----
  if (view.v === "warm") {
    const k = view.k,
      W = WARMUP[k];
    const close = () => setView({ v: "home" });
    const advance = () => {
      const nk = k + 1;
      let next = { ...st, warm: { date: today, step: nk } };
      if (nk >= WARMUP.length) next = bumpStreak(next);
      save(next);
      setRunKey((n) => n + 1);
      setView(
        nk >= WARMUP.length
          ? { v: "warm", k: WARMUP.length, finished: true }
          : { v: "warm", k: nk },
      );
    };
    if (view.finished || k >= WARMUP.length)
      return html`<div
        class="flex flex-col items-center gap-4 text-center"
        style=${{ paddingTop: 30 }}
      >
        <span style=${{ fontSize: 54 }} aria-hidden="true">🎉</span>
        <span class="display font-bold" style=${{ fontSize: 28 }}
          >Warm-up done!</span
        >
        <span class="muted"
          >Your voice is ready.
          ${streakNow(st) > 1
            ? "That's " + streakNow(st) + " days in a row."
            : "Come back tomorrow to start a streak."}</span
        >
        <button
          class="btn btn-primary"
          style=${{ minHeight: 48, padding: "0 24px", fontSize: 16 }}
          onClick=${close}
        >
          Back to lessons
        </button>
      </div>`;
    return html`<div class="flex flex-col gap-4">
      <${FlowHead}
        title="Daily warm-up"
        label=${"Step " + (k + 1) + " of " + WARMUP.length}
        onClose=${close}
      />
      <div class="flex gap-1">
        ${WARMUP.map(
          (w, i) =>
            html`<span
              key=${i}
              style=${{
                flex: 1,
                height: 6,
                borderRadius: 3,
                background:
                  i < k
                    ? "var(--good)"
                    : i === k
                      ? "var(--accent)"
                      : "var(--line)",
              }}
            ></span>`,
        )}
      </div>
      <div class="flex flex-col gap-1">
        <span class="display font-bold" style=${{ fontSize: 26 }}
          >${W.title}</span
        >
        <span class="text-sm muted">${W.how}</span>
      </div>
      ${view.res
        ? html`<section class="tuner-card" style=${{ gap: 8 }}>
              <span
                style=${{ fontSize: 34, color: "var(--good)" }}
                aria-hidden="true"
                >✓</span
              >
              <span class="display font-bold" style=${{ fontSize: 22 }}
                >${view.res.simple
                  ? "Done"
                  : view.res.score >= 70
                    ? "Nice!"
                    : "Good effort"}</span
              >
              ${!view.res.simple &&
              html`<span class="text-sm muted"
                >${view.res.stats[0]
                  ? view.res.stats[0].label + ": " + view.res.stats[0].value
                  : ""}</span
              >`}
            </section>
            <button
              class="btn btn-primary"
              style=${{
                justifyContent: "center",
                minHeight: 48,
                fontSize: 16,
              }}
              onClick=${advance}
            >
              ${k + 1 >= WARMUP.length
                ? "Finish"
                : "Next: " + WARMUP[k + 1].title + " →"}
            </button>`
        : html`<${Exercise}
              key=${runKey + "-" + k}
              spec=${W}
              range=${range}
              mic=${mic}
              onDone=${(res) => setView({ ...view, res })}
            />
            <button
              class="btn btn-ghost"
              style=${{ alignSelf: "center" }}
              onClick=${advance}
            >
              Skip this step
            </button>`}
    </div>`;
  }

  // ---- course page ----
  if (view.v === "course" && course) {
    const dc = doneCount(course);
    return html`<div class="flex flex-col gap-4">
      <div class="flex items-center gap-3">
        <button
          class="icon-btn"
          onClick=${() => setView({ v: "home" })}
          aria-label="Back to lessons"
        >
          <${Icon} name="back" size=${18} />
        </button>
        <span class="label">Course ${COURSES.indexOf(course) + 1}</span>
      </div>
      <h2 class="display font-bold" style=${{ fontSize: 30, margin: 0 }}>
        ${course.title}
      </h2>
      <p class="muted text-sm" style=${{ margin: 0 }}>${course.about}</p>
      <div class="flex items-center gap-3">
        <span style=${{ flex: 1 }}
          ><${Bar} p=${(100 * dc) / course.lessons.length} /></span
        ><span class="mono text-xs muted"
          >${dc} / ${course.lessons.length}</span
        >
      </div>
      <div class="flex flex-col gap-1">
        ${course.lessons.map((L, i) => {
          const done = st.done[L.id] != null,
            open = unlocked(course, i),
            now = open && !done;
          return html`<button
            key=${L.id}
            disabled=${!open}
            onClick=${() =>
              setView({ v: "lesson", c: course.id, l: i, step: "learn" })}
            class="flex items-center gap-3"
            style=${{
              textAlign: "left",
              padding: "10px 12px",
              borderRadius: 14,
              font: "inherit",
              color: "var(--fg)",
              cursor: open ? "pointer" : "default",
              background: now ? "var(--surface-2)" : "transparent",
              border:
                "1px solid " +
                (now
                  ? "color-mix(in srgb, var(--accent) 40%, transparent)"
                  : "transparent"),
              opacity: open ? 1 : 0.55,
            }}
          >
            <span
              style=${{
                width: 30,
                height: 30,
                borderRadius: "50%",
                flexShrink: 0,
                display: "grid",
                placeItems: "center",
                fontWeight: 700,
                fontSize: 13,
                background: done
                  ? "var(--good)"
                  : now
                    ? "var(--accent)"
                    : "transparent",
                color: done || now ? "var(--bg)" : "var(--muted)",
                border: done || now ? "0" : "2px solid var(--line)",
              }}
              >${done ? "✓" : i + 1}</span
            >
            <span class="flex flex-col min-w-0" style=${{ flex: 1 }}
              ><b class="text-sm">${L.title}</b
              ><span class="text-xs muted"
                >${L.meta}${done && st.done[L.id] < 100
                  ? " · best " + st.done[L.id] + "%"
                  : ""}</span
              ></span
            >
            ${now &&
            html`<span
              class="text-sm font-semibold"
              style=${{ color: "var(--accent)" }}
              >Start</span
            >`}
            ${!open && html`<${Icon} name="lock" size=${16} />`}
          </button>`;
        })}
      </div>
    </div>`;
  }

  // ---- home ----
  const curCourse =
    COURSES.find((c) => doneCount(c) < c.lessons.length) ||
    COURSES[COURSES.length - 1];
  return html`<div class="flex flex-col gap-4">
    ${streak > 0 &&
    html`<div class="flex gap-2">
      <span class="chip"
        ><span aria-hidden="true">🔥</span><b class="mono">${streak}</b
        ><span class="muted text-xs">day streak</span></span
      >
    </div>`}
    <section
      class="flex flex-col gap-3"
      style=${{
        padding: 16,
        borderRadius: 20,
        background:
          "radial-gradient(120% 120% at 100% 0%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 60%), var(--surface)",
        border: "1px solid var(--line)",
      }}
    >
      <span class="label" style=${{ color: "var(--accent)" }}>Today</span>
      <span
        class="display font-bold"
        style=${{ fontSize: 24, lineHeight: 1.15 }}
        >Daily warm-up</span
      >
      <span class="text-sm muted"
        >5 min · 5
        exercises${range.saved
          ? ", set to your range (" +
            nm(range.full.lo) +
            "–" +
            nm(range.full.hi) +
            ")"
          : ""}</span
      >
      <div class="flex gap-1">
        ${WARMUP.map(
          (w, i) =>
            html`<span
              key=${i}
              title=${w.title}
              style=${{
                flex: 1,
                height: 6,
                borderRadius: 3,
                background: i < warmStep ? "var(--good)" : "var(--line)",
              }}
            ></span>`,
        )}
      </div>
      <button
        class="btn btn-primary"
        style=${{ alignSelf: "flex-start", minHeight: 44, padding: "0 22px" }}
        onClick=${() => {
          setRunKey((n) => n + 1);
          setView({ v: "warm", k: warmStep >= WARMUP.length ? 0 : warmStep });
        }}
      >
        ${warmStep >= WARMUP.length
          ? "Done today ✓ · Go again"
          : warmStep > 0
            ? "Continue warm-up"
            : "Start warm-up"}
      </button>
    </section>
    ${!range.saved &&
    html`<div
      class="panel p-3 flex items-center gap-3"
      style=${{ borderStyle: "dashed" }}
    >
      <span class="text-sm muted" style=${{ flex: 1 }}
        >Take the 1-minute range test so lessons fit your voice.</span
      >
      <button
        class="link-btn text-sm"
        style=${{ whiteSpace: "nowrap" }}
        onClick=${findRange}
      >
        Find my range
      </button>
    </div>`}
    <span class="label">Courses</span>
    <div class="flex flex-col gap-2">
      ${COURSES.map((c, ci) => {
        const dc = doneCount(c),
          cur = c === curCourse && dc < c.lessons.length;
        return html`<button
          key=${c.id}
          onClick=${() => setView({ v: "course", c: c.id })}
          class="flex flex-col gap-3"
          style=${{
            textAlign: "left",
            padding: 14,
            borderRadius: 16,
            font: "inherit",
            color: "var(--fg)",
            cursor: "pointer",
            background: cur
              ? "linear-gradient(135deg, var(--surface-2), var(--surface))"
              : "var(--surface)",
            border:
              "1px solid " +
              (cur
                ? "color-mix(in srgb, var(--accent) 40%, transparent)"
                : "var(--line)"),
          }}
        >
          <span class="flex items-center gap-3">
            <span
              class="display font-bold"
              style=${{
                width: 34,
                height: 34,
                borderRadius: 10,
                display: "grid",
                placeItems: "center",
                background:
                  "color-mix(in srgb, var(--accent) 15%, transparent)",
                color: "var(--accent)",
              }}
              >${ci + 1}</span
            >
            <span class="flex flex-col min-w-0" style=${{ flex: 1 }}
              ><b>${c.title}</b
              ><span class="text-xs muted"
                >${c.sub} · ${dc} of ${c.lessons.length}</span
              ></span
            >
            <span
              class="text-sm font-semibold"
              style=${{ color: cur ? "var(--accent)" : "var(--muted)" }}
              >${dc === c.lessons.length
                ? "Review"
                : dc > 0
                  ? "Continue"
                  : "Start"}</span
            >
          </span>
          <${Bar}
            p=${(100 * dc) / c.lessons.length}
            tone=${dc === c.lessons.length ? "good" : "accent"}
          />
        </button>`;
      })}
      ${SOON.map(
        (t, i) =>
          html`<div
            key=${t}
            class="flex items-center gap-3"
            style=${{
              padding: "12px 14px",
              borderRadius: 14,
              background: "var(--surface-2)",
              border: "1px solid var(--line)",
              opacity: 0.6,
            }}
          >
            <span
              style=${{
                width: 34,
                height: 34,
                borderRadius: 10,
                display: "grid",
                placeItems: "center",
                color: "var(--muted)",
              }}
              ><${Icon} name="lock" size=${16}
            /></span>
            <span class="flex flex-col"
              ><b class="text-sm">${COURSES.length + i + 1} · ${t}</b
              ><span class="text-xs muted">Coming soon</span></span
            >
          </div>`,
      )}
    </div>
  </div>`;
}

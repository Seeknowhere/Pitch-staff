// Your saved "Repeat after me" tries per line, and breath-timing feedback.
import { wordsToNotes, looksTagalog } from "./lyrics.js";
import { pretty, midiInfo } from "./music.js";
import { loadJSON, saveJSON } from "./storage.js";

// ---- your tries per phrase (Repeat after me), saved per song ----
const TRIES_KEY = "pitchstaff.tries.v2"; // v2: phrases follow lyric lines

export const loadTries = (song) => (song ? loadJSON(TRIES_KEY, {})[song] || {} : {});

export const saveTries = (song, t) => {
  if (!song) return;
  const all = loadJSON(TRIES_KEY, {});
  all[song] = t;
  saveJSON(TRIES_KEY, all);
};

export function tryStats(rec) {
  const rows = rec.rows,
    n = rows.length;
  const right = rows.filter((r) => r.c != null && Math.abs(r.c) <= 50).length;
  const high = rows.filter((r) => r.c != null && r.c > 50).length,
    low = rows.filter((r) => r.c != null && r.c < -50).length,
    miss = rows.filter((r) => r.c == null).length;
  const near = rows
    .filter((r) => r.c != null && Math.abs(r.c) <= 150)
    .map((r) => r.c);
  const lean = near.length
    ? Math.round(near.reduce((a, b) => a + b, 0) / near.length)
    : 0;
  const scoops = rows.filter((r) => r.sc);
  const sds = rows.map((r) => r.sd).filter((x) => x != null);
  const sd = sds.length ? sds.reduce((a, b) => a + b, 0) / sds.length : null;
  const nm2 = (m) => pretty(midiInfo(m).label);
  const parts = [];
  if (high) parts.push(high + " too high");
  if (low) parts.push(low + " too low");
  if (miss) parts.push(miss + " not heard");
  const stats = [
    {
      label: "Notes right",
      value: right + " of " + n,
      note: parts.join(", ") || "every note landed",
      tone: right / n >= 0.8 ? "good" : right / n >= 0.5 ? "warn" : "bad",
    },
    {
      label: "High or low",
      value:
        Math.abs(lean) < 10
          ? "Right on"
          : Math.abs(lean) < 30
            ? lean < 0
              ? "A bit flat"
              : "A bit sharp"
            : lean < 0
              ? "Flat"
              : "Sharp",
      note:
        Math.abs(lean) < 10
          ? "centred on the notes"
          : "about " +
            Math.abs(lean) +
            "¢ " +
            (lean < 0 ? "low" : "high") +
            " overall",
      tone:
        Math.abs(lean) < 15 ? "good" : Math.abs(lean) < 30 ? "warn" : "bad",
    },
    {
      label: "Landing",
      value: scoops.length ? "Scooped " + scoops.length : "Clean",
      note: scoops.length
        ? "slid up into " +
          [...new Set(scoops.map((r) => nm2(r.m)))].slice(0, 2).join(" and ")
        : "hit notes straight away",
      tone: scoops.length ? "warn" : "good",
    },
    {
      label: "Steady",
      value: sd == null ? "—" : sd < 12 ? "Good" : sd < 20 ? "OK" : "Wobbly",
      note:
        sd == null
          ? "no long notes here"
          : sd < 12
            ? "held notes stayed put"
            : "long notes wavered",
      tone:
        sd == null ? "muted" : sd < 12 ? "good" : sd < 20 ? "warn" : "bad",
    },
  ];
  let worst = null;
  rows.forEach((r, i) => {
    const v = r.c == null ? 999 : Math.abs(r.c);
    if (v > 50 && (!worst || v > worst.v)) worst = { i, v, r };
  });
  let tip;
  if (worst && worst.r.c != null)
    tip =
      "On " +
      nm2(worst.r.m) +
      " you sang " +
      nm2(worst.r.m + Math.round(worst.r.c / 100)) +
      ". Play the line, then hum that note before you sing it.";
  else if (worst)
    tip =
      "Tono couldn't hear " +
      nm2(worst.r.m) +
      ". Sing every note out, even the short ones.";
  else if (scoops.length)
    tip =
      "You came in low and slid up to " +
      nm2(scoops[0].m) +
      ". Hear it first, then start right on it.";
  else if (Math.abs(lean) >= 25)
    tip =
      lean < 0
        ? "You sat a little flat. Keep your breath moving and aim slightly higher."
        : "You sat a little sharp. Relax your throat and aim slightly lower.";
  else if (sd != null && sd >= 20)
    tip =
      "Long notes wavered. Take a fuller breath and keep the same vowel the whole way.";
  else tip = "Clean line! Try it without the guide next.";
  return { stats, tip, worst };
}

// words and advice for a line's breath and timing
export function btInfo(rec, notes, text) {
  const bt = rec.bt || { breaths: [], cut: null, pace: "steady" };
  const ph = rec.rows.map(
    (r) =>
      notes.find((n) => Math.abs(n.pos - r.p) < 0.002) || {
        pos: r.p,
        end: r.p + 0.2,
        midi: r.m,
      },
  );
  const wtn = text ? wordsToNotes(text, ph, looksTagalog([{ text }])) : null;
  const wordOf = (i) => {
    const e = wtn && wtn.find((x) => x.idx.includes(i));
    return e
      ? "“" + e.w.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "") + "”"
      : "note " + (i + 1);
  };
  const late = rec.late,
    s1 = (v) => Math.abs(v).toFixed(1).replace(/^0/, "0") + " s";
  let worst = null;
  rec.rows.forEach((r, i) => {
    if (
      r.c != null &&
      Math.abs(r.c) <= 50 &&
      r.dt != null &&
      Math.abs(r.dt) >= 0.12 &&
      (!worst || Math.abs(r.dt) > Math.abs(worst.dt))
    )
      worst = { i, dt: r.dt };
  });
  const timing =
    late != null
      ? Math.abs(late) < 0.1
        ? {
            label: "Timing",
            value: "On time",
            tone: "good",
            note: worst
              ? wordOf(worst.i) +
                " came " +
                s1(worst.dt) +
                (worst.dt > 0 ? " late" : " early")
              : "came in with the song",
          }
        : {
            label: "Timing",
            value:
              late > 0
                ? late > 0.3
                  ? "Late"
                  : "A bit late"
                : late < -0.3
                  ? "Early"
                  : "A bit early",
            tone: Math.abs(late) > 0.3 ? "bad" : "warn",
            note:
              "about " +
              s1(late) +
              (late > 0 ? " behind" : " ahead") +
              (worst ? ", worst on " + wordOf(worst.i) : ""),
          }
      : worst
        ? {
            label: "Timing",
            value: "Uneven",
            tone: "warn",
            note:
              wordOf(worst.i) +
              " came " +
              s1(worst.dt) +
              (worst.dt > 0 ? " late" : " early"),
          }
        : {
            label: "Timing",
            value: "Even",
            tone: "good",
            note: "notes came in evenly",
          };
  const pace = {
    label: "Pace",
    value:
      bt.pace === "rushed"
        ? "Rushed"
        : bt.pace === "dragged"
          ? "Dragged"
          : "Steady",
    tone: bt.pace === "steady" ? "good" : "warn",
    note:
      bt.pace === "rushed"
        ? "notes got earlier through the line"
        : bt.pace === "dragged"
          ? "notes got later through the line"
          : "didn't rush or drag",
  };
  const breath = bt.breaths.length
    ? {
        label: "Breath",
        value:
          bt.breaths.length > 1
            ? bt.breaths.length + " extra breaths"
            : "Mid-line breath",
        tone: "warn",
        note:
          "you breathed after " +
          bt.breaths
            .slice(0, 2)
            .map((x) => wordOf(x.i))
            .join(" and "),
      }
    : {
        label: "Breath",
        value: "Good",
        tone: "good",
        note: "no extra breaths",
      };
  const end = bt.cut
    ? {
        label: "Line end",
        value: "Cut short",
        tone: "bad",
        note: "last note " + bt.cut.s.toFixed(1) + " s early",
      }
    : {
        label: "Line end",
        value: "Held",
        tone: "good",
        note: "held to the end",
      };
  const dri = rec.rows.findIndex((r) => r.dr);
  const drift =
    dri >= 0
      ? "You went a little " +
        rec.rows[dri].dr.dir +
        " as you got " +
        rec.rows[dri].dr.with +
        " on " +
        wordOf(dri) +
        "." +
        (rec.rows[dri].dr.dir === "flat"
          ? " Keep the breath moving to the very end of the note."
          : " Ease off a little; pushing makes the pitch climb.")
      : null;
  const tip =
    bt.cut && bt.breaths.length
      ? "Take a full breath before the line so you don't need one after " +
        wordOf(bt.breaths[0].i) +
        ", and hold " +
        wordOf(bt.cut.i) +
        " for its whole length."
      : bt.cut
        ? "Hold " +
          wordOf(bt.cut.i) +
          " for its whole length. Plan your breath before the line so there's air left at the end."
        : bt.breaths.length
          ? "Breathe before the line so you don't need one after " +
            wordOf(bt.breaths[0].i) +
            ". Sip the air: steady, not all at once."
          : late != null && late > 0.15
            ? "Come in right with the song. Breathe a beat early so you're ready on the first word."
            : late != null && late < -0.15
              ? "You jumped in early. Wait for the beat, then start."
              : bt.pace === "rushed"
                ? "Don't rush: tap the beat and let each note take its full time."
                : bt.pace === "dragged"
                  ? "Keep it moving: you fell behind towards the end. Think ahead to the next word."
                  : "Breath and timing look good on this line.";
  const tags = [];
  if (late != null)
    tags.push(
      Math.abs(late) < 0.15
        ? ["⏱ on time", "good"]
        : [
            "⏱ " + s1(late) + (late > 0 ? " late" : " early"),
            Math.abs(late) > 0.3 ? "bad" : "warn",
          ],
    );
  if (bt.pace !== "steady")
    tags.push([bt.pace === "rushed" ? "🏃 rushed" : "🐢 dragged", "warn"]);
  if (bt.breaths.length) tags.push(["💨 breath mid-line", "warn"]);
  if (bt.cut) tags.push(["✂ last note short", "bad"]);
  return { stats: [timing, pace, breath, end], drift, tip, tags };
}

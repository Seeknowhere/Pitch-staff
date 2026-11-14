import { loadRanges, comfyOf } from "../../lib/range.js";
import { loadJSON } from "../../lib/storage.js";

export const LESSON_KEY = "pitchstaff.lessons.v1";

export const loadLessons = () => {
  const v = loadJSON(LESSON_KEY, {});
  return {
    done: {},
    streak: { last: "", count: 0 },
    warm: null,
    ...(v && typeof v === "object" ? v : {}),
  };
};

export const dayKey = (d = new Date()) =>
  d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();

export function bumpStreak(st) {
  const today = dayKey();
  if (st.streak && st.streak.last === today) return st;
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const count =
    st.streak && st.streak.last === dayKey(y) ? st.streak.count + 1 : 1;
  return { ...st, streak: { last: today, count } };
}

export const streakNow = (st) => {
  if (!st.streak || !st.streak.last) return 0;
  const y = new Date();
  y.setDate(y.getDate() - 1);
  return st.streak.last === dayKey() || st.streak.last === dayKey(y)
    ? st.streak.count
    : 0;
};

// the notes lessons use: your comfortable range if you've tested it, otherwise a middle range most voices reach (any octave counts)
export function lessonRange() {
  const r = loadRanges()[0];
  if (r) {
    const [a, b] = comfyOf(r);
    return {
      lo: a,
      hi: Math.max(a + 4, b),
      center: Math.round((a + b) / 2),
      saved: true,
      full: r,
    };
  }
  return {
    lo: 53,
    hi: 62,
    center: 57,
    saved: false,
    full: { lo: 50, hi: 66 },
  };
}

export const COURSES = [
  {
    id: "found",
    title: "Foundations",
    sub: "Breathing, posture, warm-ups",
    about:
      "The basics every singer builds on: how to stand, breathe and warm up so singing feels easy.",
    lessons: [
      {
        id: "f1",
        title: "Stand like a singer",
        meta: "Posture check · 2 min",
        type: "check",
        learn:
          "Good posture gives your breath room to work. You don't need to stand stiff, just tall and loose.",
        steps: [
          "Feet hip-width apart, knees soft, not locked.",
          "Shoulders down and relaxed, not raised.",
          "Chin level, as if a string pulls the top of your head up.",
          "Jaw loose, tongue resting behind your bottom teeth.",
        ],
        tip: "Check your posture in a mirror the first few times.",
      },
      {
        id: "f2",
        title: "Belly breathing",
        meta: "Guided breathing · 2 min",
        type: "breath",
        rounds: 4,
        inhale: 4,
        exhale: 6,
        learn:
          "Singers breathe low, so the belly and sides expand instead of the shoulders. Low breaths give you steady air for long notes.",
        steps: [
          "Put one hand on your belly.",
          "Breathe in through your nose for 4 counts and feel your hand move out.",
          "Breathe out slowly on a soft “sss” for 6 counts.",
        ],
        tip: "If you feel dizzy, stop and breathe normally for a bit.",
      },
      {
        id: "f3",
        title: "Long, even hiss",
        meta: "Breath control · 3 min",
        type: "hiss",
        target: 15,
        tries: 3,
        learn:
          "A long, even hiss trains you to let air out slowly. That control is what keeps long notes steady.",
        steps: [
          "Take a low belly breath.",
          "Hiss “sss” quietly and evenly, like a slow tyre leak.",
          "Keep going until you run out, without squeezing at the end.",
        ],
        tip: "Hold the phone about an arm's length away so the hiss isn't too loud for the mic.",
      },
      {
        id: "f4",
        title: "Gentle hum",
        meta: "Wake up your voice · 3 min",
        type: "hold",
        hold: 3,
        tol: 50,
        tries: 3,
        notes: "center",
        verb: "Hum",
        learn:
          "Humming is the gentlest way to wake your voice up. Lips closed, teeth apart, and feel a little buzz around your lips and nose.",
        steps: [
          "Listen to the piano note.",
          "Hum it softly on “mmm”.",
          "Keep the hum easy and steady until the ring fills.",
        ],
        tip: "Quiet is fine. You never need to push for these.",
      },
      {
        id: "f5",
        title: "Lip trills",
        meta: "Air and sound together · 4 min",
        type: "pattern",
        pattern: [0, 2, 4, 2, 0],
        rounds: 3,
        rise: 1,
        tol: 0.6,
        verb: "Trill",
        learn:
          "Blow air through loose lips so they buzz like “brrr”, and add your voice. Singers use lip trills every day because they balance air and sound.",
        steps: [
          "Listen to the five-note pattern.",
          "Trill it back on “brrr”, following the notes up and down.",
          "Each round starts one note higher.",
        ],
        tip: "If your lips won't buzz, press a finger lightly into each cheek. Humming the pattern works too.",
      },
      {
        id: "f6",
        title: "Sirens",
        meta: "Stretch your voice · 3 min",
        type: "siren",
        tries: 3,
        learn:
          "Slide smoothly from low to high like a siren, on “oo” or a lip trill. It stretches your voice gently and smooths the jump between your low and high notes.",
        steps: [
          "Start on a low, comfy note.",
          "Glide up slowly and smoothly, as high as feels easy.",
          "Let it get light and soft at the top. Don't push.",
        ],
        tip: "Stop if anything scratches or hurts.",
      },
    ],
  },
  {
    id: "pitch",
    title: "Pitch",
    sub: "Match notes, jumps, scales",
    about:
      "Sing the note you mean to sing. Learn to match a note, hold it in tune, and move between notes cleanly.",
    lessons: [
      {
        id: "p1",
        title: "Match a note",
        meta: "Hear it, sing it, hold it · 4 min",
        type: "hold",
        hold: 1,
        tol: 35,
        tries: 5,
        notes: "random",
        learn:
          "Everything in singing starts here: hearing a note and singing the same one back.",
        steps: [
          "Listen to the piano note.",
          "Sing it on “ah”.",
          "Hold it until the ring fills.",
        ],
        tip: "Any octave counts, so sing wherever it feels natural.",
      },
      {
        id: "p2",
        title: "Slide into the note",
        meta: "Find the pitch from below · 4 min",
        type: "hold",
        hold: 1,
        tol: 30,
        tries: 5,
        notes: "random",
        verb: "Slide up to",
        learn:
          "If you can't find a note straight away, start a little below it and glide up until it locks in. Your ear learns what “in tune” feels like.",
        steps: [
          "Listen to the piano note.",
          "Start lower on “ah” and slide up slowly.",
          "Stop when the ring turns green, and hold.",
        ],
        tip: "Keep it gentle. If your throat feels tight, take a breath and try lower.",
      },
      {
        id: "p3",
        title: "Hold it in tune",
        meta: "Stay steady for 4 seconds · 4 min",
        type: "hold",
        hold: 4,
        tol: 25,
        tries: 3,
        notes: "center",
        verb: "Hold",
        learn:
          "Finding the note is half the job. Now keep it there, with steady air and the same vowel the whole time.",
        steps: [
          "Listen to the note.",
          "Sing it on “ah” and keep your breath flowing.",
          "Hold it steady for 4 seconds.",
        ],
        tip: "If it wobbles, take a fuller breath first and sing a little softer.",
      },
      {
        id: "p4",
        title: "Steps: do re mi",
        meta: "One note at a time · 5 min",
        type: "pattern",
        pattern: [0, 2, 4, 2, 0],
        rounds: 3,
        rise: 2,
        tol: 0.5,
        learn:
          "Melodies mostly move in small steps. Here you'll move up and down one note at a time: do, re, mi, re, do.",
        steps: [
          "Listen to the pattern.",
          "Sing it back on “la” or do-re-mi.",
          "Give each note its own moment.",
        ],
        tip: "Sing each note a little longer than feels natural so Tono can catch it.",
      },
      {
        id: "p5",
        title: "Small jumps",
        meta: "Thirds and fourths · 5 min",
        type: "pattern",
        pattern: [0, 4, 0, 5, 0],
        rounds: 3,
        rise: 2,
        tol: 0.5,
        learn:
          "Now skip a note or two. Hear the jump in your head before you sing it.",
        steps: [
          "Listen to the pattern.",
          "Imagine the next note before you sing it.",
          "Sing it back cleanly, without sliding.",
        ],
        tip: "If a jump keeps missing, slide into it slowly a few times, then try it clean.",
      },
      {
        id: "p6",
        title: "Big jumps",
        meta: "Fifths and octaves · 5 min",
        type: "pattern",
        pattern: [0, 7, 0, 12, 0],
        rounds: 2,
        rise: 2,
        tol: 0.5,
        bigFallback: [0, 7, 0, 5, 0],
        learn:
          "Big leaps take confidence. Keep the low note relaxed and let the high note float rather than reaching for it.",
        steps: [
          "Listen to the pattern.",
          "Breathe before the big jump.",
          "Let the top note be lighter than the bottom one.",
        ],
        tip: "The octave is the same note, higher. Think of it as the same note, just lighter.",
      },
      {
        id: "p7",
        title: "Your first scale",
        meta: "Five notes up and down · 5 min",
        type: "pattern",
        pattern: [0, 2, 4, 5, 7, 5, 4, 2, 0],
        rounds: 2,
        rise: 2,
        tol: 0.5,
        learn:
          "Do re mi fa sol fa mi re do. Scales train your ear and voice to move evenly through a range of notes.",
        steps: [
          "Listen to the scale.",
          "Sing it back on “la” or do-re-mi.",
          "Keep every note the same loudness.",
        ],
        tip: "Take a breath before you start so you don't run out at the top.",
      },
      {
        id: "p8",
        title: "Checkpoint",
        meta: "Sing a short melody · 3 min",
        type: "pattern",
        pattern: [0, 2, 4, 0, 4, 5, 7],
        rounds: 2,
        rise: 2,
        tol: 0.5,
        learn:
          "Put it together: steps, small jumps and a held top note in one short tune.",
        steps: [
          "Listen to the melody.",
          "Sing it back on “la”.",
          "Use everything you've practised.",
        ],
        tip: "Pass this one and you're ready for real songs in Practice.",
      },
    ],
  },
];

export const SOON = ["Control", "Range", "Agility", "Ear training"];

export const WARMUP = [
  {
    title: "Breath hold",
    short: "Hiss on one breath",
    type: "hiss",
    target: 15,
    tries: 1,
    how: "Take a low breath, then hiss “sss” quietly and evenly for as long as you comfortably can.",
  },
  {
    title: "Gentle hum",
    short: "Hum on a comfy note",
    type: "hold",
    hold: 3,
    tol: 50,
    tries: 2,
    notes: "center",
    verb: "Hum",
    how: "Lips closed, teeth apart. Hum the piano note softly until the ring fills.",
  },
  {
    title: "Lip trills",
    short: "5-note pattern, rising",
    type: "pattern",
    pattern: [0, 2, 4, 2, 0],
    rounds: 3,
    rise: 1,
    tol: 0.6,
    verb: "Trill",
    how: "Buzz your lips (“brrr”) and follow the piano. Each round starts a note higher.",
  },
  {
    title: "Sirens",
    short: "Slide low to high on “oo”",
    type: "siren",
    tries: 1,
    how: "Glide from a low comfy note up as high as feels easy, then let it go.",
  },
  {
    title: "First scale",
    short: "Do re mi fa sol, in your range",
    type: "pattern",
    pattern: [0, 2, 4, 5, 7, 5, 4, 2, 0],
    rounds: 1,
    rise: 0,
    tol: 0.5,
    how: "Sing the scale back on “la”, every note the same loudness.",
  },
];

import { SETTINGS } from "./settings.js";

/* ---------- music helpers ---------- */
  export const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  export const LETTERS = "CDEFGAB";
  export function midiInfo(m) {
    const name = NAMES[((m % 12) + 12) % 12];
    const octave = Math.floor(m / 12) - 1;
    const letter = name[0];
    return { name, letter, sharp: name.length > 1, octave, label: name + octave, step: octave * 7 + LETTERS.indexOf(letter) };
  }
  

  export function freqToMidi(f) {
    const exact = 69 + 12 * Math.log2(f / SETTINGS.a4);
    const midi = Math.round(exact);
    return { midi, cents: Math.round((exact - midi) * 100) };
  }
  export const pretty = (s) => s.replace("#", "♯");
  export const fmt = (s) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
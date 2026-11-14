// App-wide settings: A4 tuning, mic sensitivity, mic choice, AI notes.
import { useState, useEffect } from "react";
import { html } from "../html.js";
import { saveSettings, SETTINGS } from "../lib/settings.js";

export function SettingsPanel({ listening, level, onClose, onMicChange, onChange }) {
  const [devices, setDevices] = useState([]);
  const [, force] = useState(0);
  useEffect(() => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices)
      return;
    navigator.mediaDevices
      .enumerateDevices()
      .then((d) => setDevices(d.filter((x) => x.kind === "audioinput")))
      .catch(() => {});
  }, [listening]);
  const set = (k, v) => {
    SETTINGS[k] = v;
    saveSettings();
    force((n) => n + 1);
    onChange && onChange();
  };
  const small = { padding: "5px 10px", fontSize: 13 };
  return html`<section class="panel p-4 sm:p-5 flex flex-col gap-4">
    <div class="flex items-start justify-between gap-3">
      <div>
        <h2 class="display text-lg font-bold">Settings</h2>
        <p class="text-xs muted">
          These apply to the whole app and are saved on this device.
        </p>
      </div>
      <button class="btn btn-ghost" style=${small} onClick=${onClose}>
        Done
      </button>
    </div>
    <div class="flex flex-col gap-2">
      <span class="label">Tuning reference (A4)</span>
      <div class="flex flex-wrap items-center gap-2">
        <div class="seg" role="group" aria-label="A4 presets">
          ${[432, 440, 442].map(
            (v) =>
              html`<button
                key=${v}
                aria-pressed=${SETTINGS.a4 === v ? "true" : "false"}
                onClick=${() => set("a4", v)}
              >
                ${v} Hz
              </button>`,
          )}
        </div>
        <button
          class="btn"
          style=${small}
          onClick=${() => set("a4", Math.max(415, SETTINGS.a4 - 1))}
          aria-label="Lower A4 by 1 hertz"
        >
          −
        </button>
        <span class="mono text-sm">A4 = ${SETTINGS.a4} Hz</span>
        <button
          class="btn"
          style=${small}
          onClick=${() => set("a4", Math.min(466, SETTINGS.a4 + 1))}
          aria-label="Raise A4 by 1 hertz"
        >
          +
        </button>
      </div>
      <p class="text-xs muted">
        440 Hz is standard. Change it only if your instrument or song is tuned
        differently. It shifts the piano, guide notes and note detection
        together; songs you already uploaded keep the setting they were
        analyzed with.
      </p>
    </div>
    <div class="flex flex-col gap-2">
      <label class="label" for="sens">Mic sensitivity</label>
      <div class="flex items-center gap-3">
        <span class="text-xs muted">Less</span>
        <input
          id="sens"
          type="range"
          min="1"
          max="10"
          step="1"
          value=${SETTINGS.sens}
          onInput=${(e) => set("sens", parseInt(e.target.value, 10))}
          onChange=${(e) => set("sens", parseInt(e.target.value, 10))}
          style=${{ flex: 1, accentColor: "var(--accent)" }}
        />
        <span class="text-xs muted">More</span>
        <span class="mono text-xs" style=${{ width: 20, textAlign: "right" }}
          >${SETTINGS.sens}</span
        >
      </div>
      ${listening &&
      html`<div class="level" style=${{ height: 6 }} title="Input level">
        <div style=${{ width: level * 100 + "%" }}></div>
      </div>`}
      <p class="text-xs muted">
        Turn it up if the app misses your voice. Turn it down if it reacts to
        background noise.
      </p>
    </div>
    <div class="flex flex-col gap-2">
      <label class="label" for="mic-pick">Microphone</label>
      ${devices.length > 1
        ? html`<select
            id="mic-pick"
            class="btn"
            style=${{ justifyContent: "flex-start", maxWidth: "100%" }}
            value=${SETTINGS.micId}
            onChange=${(e) => {
              set("micId", e.target.value);
              onMicChange && onMicChange();
            }}
          >
            <option value="">System default</option>
            ${devices.map(
              (d, i) =>
                html`<option key=${d.deviceId || i} value=${d.deviceId}>
                  ${d.label || "Microphone " + (i + 1)}
                </option>`,
            )}
          </select>`
        : html`<p class="text-sm muted">
            Using the default
            microphone.${devices.length === 0
              ? " Other microphones show up here after you allow mic access."
              : ""}
          </p>`}
    </div>
    <div class="flex flex-col gap-2">
      <span class="label">Note detection</span>
      <button
        class="switch"
        role="switch"
        aria-checked=${SETTINGS.ai ? "true" : "false"}
        onClick=${() => set("ai", !SETTINGS.ai)}
        style=${{ fontSize: 14, alignSelf: "flex-start" }}
      >
        <span class="track"><span class="knob"></span></span>High-accuracy
        notes (AI)
      </button>
      <p class="text-xs muted">
        Experimental. Uses Spotify's Basic Pitch model on this device to split
        notes where it hears a new syllable starting on the same pitch. It
        helps a little with fast lines, can add a few extra notes, takes a
        while on slower phones, and is a one-time 2.5 MB download. The result
        is saved per song. Applies to the next song you load.
      </p>
    </div>
    <div class="flex flex-col gap-1">
      <span class="label">Credits</span>
      <p class="text-xs muted">
        Splitting songs into voice and music uses an MDX-Net model from
        <a
          href="https://github.com/Anjok07/ultimatevocalremovergui"
          target="_blank"
          rel="noopener"
          style=${{ color: "var(--accent)" }}
          >Ultimate Vocal Remover</a
        >
        (MIT licence), run with ONNX Runtime. Thanks to UVR and its
        developers.
      </p>
    </div>
  </section>`;
}

/* ---------- AI note detection (Spotify Basic Pitch, runs on this device) ---------- */

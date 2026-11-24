// App-wide settings: A4 tuning, mic sensitivity, mic choice, AI notes.
import { useState, useEffect } from "react";
import { saveSettings, SETTINGS } from "../lib/settings.js";

export function SettingsPanel({
  listening,
  level,
  onClose,
  onMicChange,
  onChange,
}) {
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
  return (
    <section className="panel p-4 sm:p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="display text-lg font-bold">Settings</h2>
          <p className="text-xs muted">
            These apply to the whole app and are saved on this device.
          </p>
        </div>
        <button className="btn btn-ghost" style={small} onClick={onClose}>
          Done
        </button>
      </div>
      <div className="flex flex-col gap-2">
        <span className="label">Tuning reference (A4)</span>
        <div className="flex flex-wrap items-center gap-2">
          <div className="seg" role="group" aria-label="A4 presets">
            {[432, 440, 442].map((v) => (
              <button
                key={v}
                aria-pressed={SETTINGS.a4 === v ? "true" : "false"}
                onClick={() => set("a4", v)}
              >
                {v} Hz
              </button>
            ))}
          </div>
          <button
            className="btn"
            style={small}
            onClick={() => set("a4", Math.max(415, SETTINGS.a4 - 1))}
            aria-label="Lower A4 by 1 hertz"
          >
            −
          </button>
          <span className="mono text-sm">A4 = {SETTINGS.a4} Hz</span>
          <button
            className="btn"
            style={small}
            onClick={() => set("a4", Math.min(466, SETTINGS.a4 + 1))}
            aria-label="Raise A4 by 1 hertz"
          >
            +
          </button>
        </div>
        <p className="text-xs muted">
          {
            "440 Hz is standard. Change it only if your instrument or song is tuned\n        differently. It shifts the piano, guide notes and note detection\n        together; songs you already uploaded keep the setting they were\n        analyzed with."
          }
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <label className="label" htmlFor="sens">
          Mic sensitivity
        </label>
        <div className="flex items-center gap-3">
          <span className="text-xs muted">Less</span>
          <input
            id="sens"
            type="range"
            min="1"
            max="10"
            step="1"
            value={SETTINGS.sens}
            onInput={(e) => set("sens", parseInt(e.target.value, 10))}
            onChange={(e) => set("sens", parseInt(e.target.value, 10))}
            style={{ flex: 1, accentColor: "var(--accent)" }}
          />
          <span className="text-xs muted">More</span>
          <span
            className="mono text-xs"
            style={{ width: 20, textAlign: "right" }}
          >
            {SETTINGS.sens}
          </span>
        </div>
        {listening && (
          <div className="level" style={{ height: 6 }} title="Input level">
            <div style={{ width: level * 100 + "%" }} />
          </div>
        )}
        <p className="text-xs muted">
          {
            "Turn it up if the app misses your voice. Turn it down if it reacts to\n        background noise."
          }
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <label className="label" htmlFor="mic-pick">
          Microphone
        </label>
        {devices.length > 1 ? (
          <select
            id="mic-pick"
            className="btn"
            style={{ justifyContent: "flex-start", maxWidth: "100%" }}
            value={SETTINGS.micId}
            onChange={(e) => {
              set("micId", e.target.value);
              onMicChange && onMicChange();
            }}
          >
            <option value="">System default</option>
            {devices.map((d, i) => (
              <option key={d.deviceId || i} value={d.deviceId}>
                {d.label || "Microphone " + (i + 1)}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-sm muted">
            {"Using the default\n            microphone."}
            {devices.length === 0
              ? " Other microphones show up here after you allow mic access."
              : ""}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <span className="label">Note detection</span>
        <button
          className="switch"
          role="switch"
          aria-checked={SETTINGS.ai ? "true" : "false"}
          onClick={() => set("ai", !SETTINGS.ai)}
          style={{ fontSize: 14, alignSelf: "flex-start" }}
        >
          <span className="track">
            <span className="knob" />
          </span>
          {"High-accuracy\n        notes (AI)"}
        </button>
        <p className="text-xs muted">
          {
            "Experimental. Uses Spotify's Basic Pitch model on this device to split\n        notes where it hears a new syllable starting on the same pitch. It\n        helps a little with fast lines, can add a few extra notes, takes a\n        while on slower phones, and is a one-time 2.5 MB download. The result\n        is saved per song. Applies to the next song you load."
          }
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <span className="label">Credits</span>
        <p className="text-xs muted">
          Splitting songs into voice and music uses an MDX-Net model from
          <a
            href="https://github.com/Anjok07/ultimatevocalremovergui"
            target="_blank"
            rel="noopener"
            style={{ color: "var(--accent)" }}
          >
            Ultimate Vocal Remover
          </a>
          {
            "(MIT licence), run with ONNX Runtime. Thanks to UVR and its\n        developers."
          }
        </p>
      </div>
    </section>
  );
}

/* ---------- AI note detection (Spotify Basic Pitch, runs on this device) ---------- */

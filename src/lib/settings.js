/* ---------- app-wide settings ---------- */
export const SETTINGS_KEY = "pitchstaff.settings.v1";
export const SETTINGS = (() => {
  const d = { a4: 440, sens: 4, micId: "", ai: false };
  try {
    return {
      ...d,
      ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") || {}),
    };
  } catch (e) {
    return d;
  }
})();
export function saveSettings() {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        a4: SETTINGS.a4,
        sens: SETTINGS.sens,
        micId: SETTINGS.micId,
        ai: SETTINGS.ai,
      }),
    );
  } catch (e) {}
}

// loudness below this is treated as silence for live listening (sensitivity 1 = least, 10 = most)
  export const micGate = () => 0.04 * Math.pow(0.6, SETTINGS.sens - 1);
  export async function getMicStream() {
    const base = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    if (SETTINGS.micId) {
      try { return await navigator.mediaDevices.getUserMedia({ audio: { ...base, deviceId: { exact: SETTINGS.micId } } }); }
      catch (e) { if (e && e.name === "NotAllowedError") throw e; SETTINGS.micId = ""; saveSettings(); }
    }
    return navigator.mediaDevices.getUserMedia({ audio: base });
  }
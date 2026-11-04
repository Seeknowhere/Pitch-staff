export function loadJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "null");
    return v == null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

export function saveJSON(key, v) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch (e) {}
}

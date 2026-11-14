import { loadJSON } from "./storage.js";

export const RANGE_KEY = "pitchstaff.range.v1";

export const loadRanges = () => {
  const v = loadJSON(RANGE_KEY, []);
  return Array.isArray(v)
    ? v.filter(
        (r) => r && typeof r.lo === "number" && typeof r.hi === "number",
      )
    : [];
};

export const comfyOf = (r) =>
  r.hi - r.lo >= 10
    ? [r.lo + 3, r.hi - 3]
    : r.hi - r.lo >= 4
      ? [r.lo + 1, r.hi - 1]
      : [r.lo, r.hi];

export function cssVar(name) {
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim() || "#888"
  );
}

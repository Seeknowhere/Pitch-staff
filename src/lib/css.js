// Read a CSS color variable (like --good) so canvas charts match the theme.
export function cssVar(name) {
  return (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
    "#888"
  );
}

export const median = (arr) => {
  if (!arr.length) return NaN;
  const s = [...arr].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

export const mean = (arr) => arr.reduce((s, v) => s + v, 0) / (arr.length || 1);

export function pearson(x, y) {
  const mx = mean(x),
    my = mean(y);
  let a = 0,
    b = 0,
    c = 0;
  for (let i = 0; i < x.length; i++) {
    a += (x[i] - mx) * (y[i] - my);
    b += (x[i] - mx) ** 2;
    c += (y[i] - my) ** 2;
  }
  return b && c ? a / Math.sqrt(b * c) : 0;
}

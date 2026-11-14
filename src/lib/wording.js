export const howMuch = (c) => {
  const a = Math.abs(c);
  return a < 10
    ? "right on"
    : a < 25
      ? "a tiny bit"
      : a < 50
        ? "a little"
        : a < 100
          ? "quite a bit"
          : "a lot";
};

const lowHigh = (c) => (c > 0 ? "high (sharp)" : "low (flat)");

export const pianoKeys = (n) => n + (n === 1 ? " piano key" : " piano keys");

function plainVerdict(r) {
  if (r.missed) return "Not sung";
  const a = Math.abs(r.cents);
  if (a <= 25) return "Right on";
  if (a <= 50) return "A little too " + (r.cents > 0 ? "high" : "low");
  return (
    "Wrong note, " +
    pianoKeys(Math.abs(Math.round(r.cents / 100))) +
    " too " +
    (r.cents > 0 ? "high" : "low")
  );
}

function spotText(s, plain) {
  if (!plain) return s.why;
  const parts = [];
  if (s.kind === "missing")
    parts.push(
      "It's hard to hear you here. Sing a bit louder, or check that you come in on time.",
    );
  else if (s.kind === "lean")
    parts.push(
      "You're singing " +
        howMuch(s.avg) +
        " too " +
        lowHigh(s.avg) +
        " in this part.",
    );
  else if (s.kind === "wrong") parts.push("A few wrong notes in this part.");
  if (s.late)
    parts.push(
      s.meanDev > 0
        ? "You're coming in late here, about " +
            Math.abs(s.meanDev).toFixed(1) +
            " seconds behind."
        : "You're rushing here, about " +
            Math.abs(s.meanDev).toFixed(1) +
            " seconds ahead.",
    );
  return parts.join(" ");
}

/* ---------- vocal technique ---------- */

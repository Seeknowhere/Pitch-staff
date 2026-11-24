export function Ring({ p, label, value, tone = "good", size = 104 }) {
  const rr = size / 2 - 6,
    C = 2 * Math.PI * rr;
  return (
    <span
      style={{ position: "relative", width: size, height: size, flexShrink: 0 }}
    >
      <svg
        width={size}
        height={size}
        viewBox={"0 0 " + size + " " + size}
        role="img"
        aria-label={label + " " + Math.round(p * 100) + " percent"}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={rr}
          fill="none"
          stroke="var(--line)"
          strokeWidth="6"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={rr}
          fill="none"
          stroke={"var(--" + tone + ")"}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={
            (C * Math.max(0, Math.min(1, p))).toFixed(1) + " " + C.toFixed(1)
          }
          transform={"rotate(-90 " + size / 2 + " " + size / 2 + ")"}
        />
      </svg>
      <span
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span className="label" style={{ fontSize: 10 }}>
          {label}
        </span>
        <span
          className="display font-bold"
          style={{ fontSize: 28, lineHeight: 1, color: "var(--" + tone + ")" }}
        >
          {value}
        </span>
      </span>
    </span>
  );
}

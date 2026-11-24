export function Stat({ label, value, note, tone }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="label">{label}</span>
      <span
        className="mono text-lg font-semibold"
        style={{ color: tone ? "var(--" + tone + ")" : "var(--fg)" }}
      >
        {value}
      </span>
      {note && <span className="text-xs muted">{note}</span>}
    </div>
  );
}

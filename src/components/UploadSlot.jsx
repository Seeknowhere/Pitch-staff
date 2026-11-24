// A file upload box with a step number and hint.
import { useRef } from "react";
import { fmt } from "../lib/music.js";

export function UploadSlot({ id, step, title, hint, slot, onPick }) {
  const ref = useRef(null);
  const busy = slot && slot.busy;
  return (
    <div className="panel p-4 flex flex-col gap-3 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="label">Step {step}</span>
        {slot && slot.data && (
          <span className="mono text-xs" style={{ color: "var(--good)" }}>
            Ready
          </span>
        )}
      </div>
      <h3 className="display text-lg font-bold">{title}</h3>
      {slot && slot.data ? (
        <div className="text-sm min-w-0">
          <p className="font-semibold" style={{ overflowWrap: "anywhere" }}>
            {slot.name}
          </p>
          <p className="muted mono text-xs">
            {fmt(slot.data.duration)} · {slot.data.notes.length} notes found
          </p>
        </div>
      ) : (
        <p className="muted text-sm">{hint}</p>
      )}
      {busy && (
        <div className="flex flex-col gap-1">
          <div className="level">
            <div style={{ width: Math.round(slot.progress * 100) + "%" }} />
          </div>
          <span className="mono text-xs muted">
            {slot.progress < 0.01
              ? "Reading file…"
              : "Analyzing " + Math.round(slot.progress * 100) + "%"}
          </span>
        </div>
      )}
      {slot && slot.error && (
        <p className="text-sm" style={{ color: "var(--bad)" }}>
          {slot.error}
        </p>
      )}
      <div>
        <button
          className={"btn" + (slot && slot.data ? "" : " btn-primary")}
          disabled={busy}
          onClick={() => ref.current && ref.current.click()}
        >
          {slot && slot.data ? "Replace file" : "Upload audio"}
        </button>
      </div>
      <input
        id={id}
        ref={ref}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files && e.target.files[0];
          e.target.value = "";
          if (f) onPick(f);
        }}
      />
    </div>
  );
}

/* ---------- Analyze: a whole-song run, scored line by line ---------- */

// A bottom sheet / pop-up panel.
import { useEffect } from "react";

// a panel that slides up from the bottom, for settings that don't need to be on screen all the time
export function Sheet({ open, title, onClose, children }) {
  useEffect(() => {
    if (!open) return;
    const k = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [open]);
  if (!open) return null;
  return (
    <div
      className="sheet-wrap"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-head">
          <h2 className="display text-lg font-bold">{title}</h2>
          <button
            className="btn btn-ghost"
            style={{ padding: "6px 12px" }}
            onClick={onClose}
          >
            Done
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
/* ---------- split a normal song into vocal + music, on the device ---------- */

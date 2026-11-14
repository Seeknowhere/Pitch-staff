import { useEffect } from "react";
import { html } from "../html.js";

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
  return html`<div
    class="sheet-wrap"
    onClick=${(e) => {
      if (e.target === e.currentTarget) onClose();
    }}
  >
    <div class="sheet" role="dialog" aria-modal="true" aria-label=${title}>
      <div class="sheet-head">
        <h2 class="display text-lg font-bold">${title}</h2>
        <button
          class="btn btn-ghost"
          style=${{ padding: "6px 12px" }}
          onClick=${onClose}
        >
          Done
        </button>
      </div>
      <div class="sheet-body">${children}</div>
    </div>
  </div>`;
}
/* ---------- split a normal song into vocal + music, on the device ---------- */

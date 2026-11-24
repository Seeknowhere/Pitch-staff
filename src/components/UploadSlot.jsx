// A file upload box with a step number and hint.
import { useRef } from "react";
import { html } from "../html.js";
import { fmt } from "../lib/music.js";

export function UploadSlot({ id, step, title, hint, slot, onPick }) {
  const ref = useRef(null);
  const busy = slot && slot.busy;
  return html`<div class="panel p-4 flex flex-col gap-3 min-w-0">
    <div class="flex items-center justify-between gap-2">
      <span class="label">Step ${step}</span>
      ${slot &&
      slot.data &&
      html`<span class="mono text-xs" style=${{ color: "var(--good)" }}
        >Ready</span
      >`}
    </div>
    <h3 class="display text-lg font-bold">${title}</h3>
    ${slot && slot.data
      ? html`<div class="text-sm min-w-0">
          <p class="font-semibold" style=${{ overflowWrap: "anywhere" }}>
            ${slot.name}
          </p>
          <p class="muted mono text-xs">
            ${fmt(slot.data.duration)} · ${slot.data.notes.length} notes found
          </p>
        </div>`
      : html`<p class="muted text-sm">${hint}</p>`}
    ${busy &&
    html`<div class="flex flex-col gap-1">
      <div class="level">
        <div style=${{ width: Math.round(slot.progress * 100) + "%" }}></div>
      </div>
      <span class="mono text-xs muted"
        >${slot.progress < 0.01
          ? "Reading file…"
          : "Analyzing " + Math.round(slot.progress * 100) + "%"}</span
      >
    </div>`}
    ${slot &&
    slot.error &&
    html`<p class="text-sm" style=${{ color: "var(--bad)" }}>
      ${slot.error}
    </p>`}
    <div>
      <button
        class=${"btn" + (slot && slot.data ? "" : " btn-primary")}
        disabled=${busy}
        onClick=${() => ref.current && ref.current.click()}
      >
        ${slot && slot.data ? "Replace file" : "Upload audio"}
      </button>
    </div>
    <input
      id=${id}
      ref=${ref}
      type="file"
      class="hidden"
      onChange=${(e) => {
        const f = e.target.files && e.target.files[0];
        e.target.value = "";
        if (f) onPick(f);
      }}
    />
  </div>`;
}

/* ---------- Analyze: a whole-song run, scored line by line ---------- */

import { html } from "../html.js";  

export function Stat({ label, value, note, tone }) {
  return html`<div class="flex flex-col gap-1 min-w-0">
    <span class="label">${label}</span>
    <span
      class="mono text-lg font-semibold"
      style=${{ color: tone ? "var(--" + tone + ")" : "var(--fg)" }}
      >${value}</span
    >
    ${note && html`<span class="text-xs muted">${note}</span>`}
  </div>`;
}

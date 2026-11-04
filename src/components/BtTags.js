import { html } from "../html.js";  

export  function BtTags({ tags }) {
    if (!tags.length) return null;
    return html`<div class="flex flex-wrap gap-1">
      ${tags.map(
        ([t, tone]) =>
          html`<span
            key=${t}
            class="text-xs"
            style=${{
              padding: "2px 8px",
              borderRadius: 999,
              fontWeight: 700,
              background:
                "color-mix(in srgb, var(--" + tone + ") 14%, transparent)",
              color: "var(--" + tone + ")",
            }}
            >${t}</span
          >`,
      )}
    </div>`;
  }
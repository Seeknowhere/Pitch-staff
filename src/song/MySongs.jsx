// "My songs" in the song picker: songs you've loaded before, kept on this device.
// Tap one to load it straight away; the bin removes it to free up space.
import React, { useEffect, useState } from "react";
import { listSongs, onSongsChanged, removeSong } from "../lib/songLibrary.js";

const mb = (n) =>
  n >= 1e9
    ? (n / 1e9).toFixed(1) + " GB"
    : Math.max(1, Math.round(n / 1e6)) + " MB";
function when(t) {
  const days = Math.floor((Date.now() - t) / 864e5);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return days + " days ago";
  return new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function MySongs({ onLoad, current }) {
  const [list, setList] = useState(null);
  const [confirm, setConfirm] = useState(null); // id waiting for a second tap to remove
  const [busy, setBusy] = useState(null);
  useEffect(() => {
    const load = () =>
      listSongs()
        .then(setList)
        .catch(() => setList([]));
    load();
    return onSongsChanged(load);
  }, []);
  if (!list || !list.length) return null;
  const total = list.reduce((a, s) => a + (s.size || 0), 0);
  return (
    <section className="flex flex-col gap-2">
      <span className="label">My songs</span>
      <div className="my-songs">
        {list.map((s) => {
          const isCurrent = current === s.id;
          return (
            <div
              className={"my-song" + (isCurrent ? " current" : "")}
              key={s.id}
            >
              <button
                className="my-song-main"
                disabled={busy != null}
                onClick={async () => {
                  setBusy(s.id);
                  try {
                    await onLoad(s);
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                <span
                  className="font-semibold"
                  style={{ overflowWrap: "anywhere" }}
                >
                  {s.title}
                  {isCurrent ? " ✓" : ""}
                </span>
                <span className="text-xs muted">
                  {busy === s.id
                    ? "Loading…"
                    : [
                        s.split
                          ? "Split by Tono"
                          : s.music
                            ? "Vocal + music"
                            : "Vocal only",
                        mb(s.size),
                        when(s.usedAt),
                      ].join(" · ")}
                </span>
              </button>
              <button
                className={
                  "btn btn-ghost my-song-del" +
                  (confirm === s.id ? " sure" : "")
                }
                aria-label={
                  confirm === s.id
                    ? "Tap again to remove " + s.title
                    : "Remove " + s.title
                }
                onClick={() => {
                  if (confirm !== s.id) return setConfirm(s.id);
                  setConfirm(null);
                  removeSong(s.id).catch(() => {});
                }}
                onBlur={() => confirm === s.id && setConfirm(null)}
              >
                {confirm === s.id ? "Remove?" : "🗑"}
              </button>
            </div>
          );
        })}
      </div>
      <span className="text-xs muted">
        Saved on this device only · {mb(total)} used
      </span>
    </section>
  );
}

// The sample song library.
import { useState, useEffect } from "react";
import { Icon } from "../components/Icon.jsx";
import { html } from "../html.js";
import { driveFile, DRIVE_FOLDER, sortSongFiles, DRIVE_KEY, driveList } from "../lib/drive.js";

export function SongLibrary({ onLoad, current, inline }) {
  const [songs, setSongs] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(null); // { id, step }
  const [open, setOpen] = useState(!!inline);
  const blockedHere = !DRIVE_KEY || !/github\.io$/.test(location.hostname);
  useEffect(() => {
    if (!open || songs || blockedHere) return;
    driveList(DRIVE_FOLDER)
      .then((fs) =>
        setSongs(
          fs.filter(
            (f) => f.mimeType === "application/vnd.google-apps.folder",
          ),
        ),
      )
      .catch(() =>
        setErr(
          "Couldn't reach the song folder. Check your connection and try again.",
        ),
      );
  }, [open]);
  const load = async (song) => {
    setErr("");
    setBusy({ id: song.id, step: "Finding files…" });
    try {
      const parts = sortSongFiles(await driveList(song.id));
      if (!parts.vocal) throw new Error("no vocal");
      let lyricText = null;
      if (parts.lrc) {
        setBusy({ id: song.id, step: "Getting lyrics…" });
        lyricText = await (await driveFile(parts.lrc)).text();
      }
      setBusy({ id: song.id, step: "Downloading vocal…" });
      const vBlob = await driveFile(parts.vocal);
      let iBlob = null;
      if (parts.inst) {
        setBusy({ id: song.id, step: "Downloading music…" });
        iBlob = await driveFile(parts.inst);
      }
      await onLoad({
        name: song.name,
        vocal: new File([vBlob], parts.vocal.name, {
          type: vBlob.type || "audio/mpeg",
        }),
        inst: iBlob
          ? new File([iBlob], parts.inst.name, {
              type: iBlob.type || "audio/mpeg",
            })
          : null,
        lyricText,
        lyricName: parts.lrc ? parts.lrc.name : null,
      });
      if (!inline) setOpen(false);
    } catch (e) {
      setErr(
        e && e.message === "no vocal"
          ? "That song folder has no audio files."
          : "Couldn't download that song. Try again in a moment.",
      );
    }
    setBusy(null);
  };
  return html`<div
    class=${inline ? "flex flex-col gap-3" : "panel p-4 flex flex-col gap-3"}
  >
    <div
      class="flex flex-wrap items-center justify-between gap-3"
      hidden=${inline}
    >
      <div class="min-w-0">
        <span class="label">Sample songs</span>
        <p class="text-sm">
          ${current
            ? html`Now loaded: <b>${current}</b>`
            : "Pick a song to load its vocal, music and lyrics in one go."}
        </p>
      </div>
      <button
        class=${"btn" + (open ? "" : " btn-primary")}
        onClick=${() => setOpen((v) => !v)}
        aria-expanded=${open ? "true" : "false"}
      >
        ${open ? "Close" : "Browse songs"}
      </button>
    </div>
    ${open &&
    (blockedHere
      ? html`<p class="text-sm muted">
          ${!DRIVE_KEY
            ? "The song library isn't connected yet."
            : "The song library works on your Tono website (seeknowhere.github.io). Here, upload the files yourself below."}
        </p>`
      : html`<div class="flex flex-col gap-2">
          ${err &&
          html`<p class="text-sm" style=${{ color: "var(--bad)" }}>
            ${err}
          </p>`}
          ${!songs &&
          !err &&
          html`<p class="text-sm muted">Loading songs…</p>`}
          ${songs &&
          songs.length === 0 &&
          html`<p class="text-sm muted">
            No songs yet. Add a folder per song inside Tono › Songs in your
            Google Drive.
          </p>`}
          ${songs &&
          songs.map(
            (sg) =>
              html`<div key=${sg.id} class="song-row">
                <span class="flex items-center gap-3 min-w-0">
                  <span class="song-ico"
                    ><${Icon} name="music" size=${20}
                  /></span>
                  <span
                    class="display font-bold"
                    style=${{ overflowWrap: "anywhere" }}
                    >${sg.name}</span
                  >
                </span>
                ${busy && busy.id === sg.id
                  ? html`<span class="text-xs muted">${busy.step}</span>`
                  : current === sg.name
                    ? html`<span
                        class="flex items-center gap-1 text-xs"
                        style=${{ color: "var(--good)" }}
                        ><${Icon} name="check" size=${16} />Loaded</span
                      >`
                    : html`<button
                        class="btn btn-primary"
                        style=${{ padding: "6px 14px", fontSize: 13 }}
                        disabled=${!!busy}
                        onClick=${() => load(sg)}
                      >
                        Load
                      </button>`}
              </div>`,
          )}
          <p class="text-xs muted">
            Add more in Google Drive › Tono › Songs. Each song downloads once,
            then loads instantly.
          </p>
        </div>`)}
  </div>`;
}

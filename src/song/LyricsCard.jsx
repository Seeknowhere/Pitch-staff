// Adding and syncing lyrics for the chosen song.
import { useState, useRef, useEffect } from "react";
import { html } from "../html.js";
import { saveBlob } from "../lib/audio.js";
import { bestLyricShift, findLyrics, cleanSongName, parseLrc, lyricSpans } from "../lib/lyrics.js";
import { fmt, signed } from "../lib/music.js";
import { parseUltraStar, toUltraStar } from "../lib/ultrastar.js";

export function LyricsCard({ orig, lyrics, updateLyrics, count, hint, musicName }) {
  const [find, setFind] = useState(null); // { q, busy, results, msg }
  const [lineMsg, setLineMsg] = useState("");
  const [err, setErr] = useState("");
  const ref = useRef(null);
  const origName = orig && orig.data ? orig.name : null;
  useEffect(() => {
    setErr("");
    setLineMsg("");
    setFind(null);
  }, [origName]);
  const dur = orig && orig.data ? orig.data.duration : 0;
  const runFind = async (q) => {
    if (!q) return;
    setFind({ q, busy: true });
    try {
      const r = await findLyrics(q, dur);
      setFind({
        q,
        results: r.synced,
        msg: r.synced.length
          ? ""
          : r.plainOnly
            ? "Found lyrics, but without timing. Tono needs timed lyrics. Try another search or upload a file."
            : "No timed lyrics found. Try fewer words, like just the title, or upload a file.",
      });
    } catch (e) {
      setFind({
        q,
        results: [],
        msg: "Couldn't reach the lyrics library. Check your connection, or upload a lyrics file.",
      });
    }
  };
  // search once by itself when a new song has no lyrics yet
  useEffect(() => {
    if (origName && !lyrics) runFind(cleanSongName(origName));
  }, [origName]);
  const useFound = (x) => {
    const lines = parseLrc(x.syncedLyrics || "");
    if (!lines.filter((l) => l.text).length) {
      setErr("Those lyrics couldn't be read.");
      return;
    }
    const sh =
      orig && orig.data ? bestLyricShift(lines, orig.data.notes) : null;
    const offset = sh && sh.sure ? sh.off : 0;
    updateLyrics({
      name: x.trackName + " · " + x.artistName,
      lines,
      offset,
      from: "lrclib",
    });
    setFind(null);
    setLineMsg(
      offset
        ? "Lined up with the singing (shifted " +
            signed(offset.toFixed(2)) +
            " s). Nudge below if it's still off."
        : "Added. Check the timing in Practice; nudge below if it's off.",
    );
  };
  const lineUp = () => {
    if (!lyrics || !orig || !orig.data) return;
    const sh = bestLyricShift(lyrics.lines, orig.data.notes);
    if (sh && Math.abs(sh.off - lyrics.offset) < 0.2)
      setLineMsg("These lyrics already line up with the singing.");
    else if (sh && sh.sure) {
      updateLyrics({ ...lyrics, offset: sh.off });
      setLineMsg(
        "Lined up with the singing (shift " +
          signed(sh.off.toFixed(2)) +
          " s).",
      );
    } else
      setLineMsg(
        "Couldn't find a clear match. These lyrics may be from a different version. Use the shift buttons.",
      );
  };
  const pickLyrics = async (file) => {
    setErr("");
    let text = "";
    try {
      text = await file.text();
    } catch (e) {
      setErr("That file couldn't be read.");
      return;
    }
    if (/^\s*#(TITLE|ARTIST|BPM|GAP|MP3|AUDIO|VERSION)\s*:/im.test(text)) {
      const us = parseUltraStar(text);
      if (!us || !us.lines.length) {
        setErr(
          "This looks like an UltraStar file, but no notes were found in it.",
        );
        return;
      }
      updateLyrics({
        name: file.name,
        lines: us.lines,
        offset: 0,
        us: us.notes.map((n) => [
          n.midi,
          Math.round(n.pos * 1000) / 1000,
          Math.round(n.end * 1000) / 1000,
          { silence: 0, dip: 1, pitch: 2 }[n.cut],
        ]),
      });
      return;
    }
    const lines = parseLrc(text);
    if (!lines.filter((l) => l.text).length) {
      setErr(
        "No timed lines found. Use an .lrc file (lines like [00:12.30] followed by the words) or an UltraStar .txt file.",
      );
      return;
    }
    updateLyrics({ name: file.name, lines, offset: 0 });
  };
  const [expMsg, setExpMsg] = useState("");
  const exportUs = async () => {
    if (!orig || !orig.data) return;
    const spans = lyricSpans(lyrics, orig.data.duration);
    const base =
      (orig.name || "song")
        .replace(/\.[^.]+$/, "")
        .replace(/[\\/:*?"<>|]+/g, "")
        .trim() || "song";
    const parts = base.split(/\s+-\s+/);
    const txt = toUltraStar({
      title: parts.length > 1 ? parts.slice(1).join(" - ") : base,
      artist: parts.length > 1 ? parts[0] : "",
      audio: orig.name,
      instrumental: musicName,
      notes: orig.data.notes,
      spans,
    });
    try {
      await saveBlob(new Blob([txt], { type: "text/plain" }), base + ".txt");
      setExpMsg("Saved.");
    } catch (e) {
      setExpMsg(
        e && e.code === "declined"
          ? "Save cancelled."
          : "Saving isn't available here.",
      );
    }
  };
  const btn = { padding: "5px 10px", fontSize: 13 };
  return html`<div class="panel p-4 flex flex-wrap items-center gap-3">
    <div class="flex-1 min-w-0" style=${{ minWidth: 200 }}>
      <span class="label">Optional</span>
      <h3 class="display text-lg font-bold">
        Timed lyrics (.lrc or UltraStar .txt)
      </h3>
      ${lyrics
        ? html`<p class="text-sm" style=${{ overflowWrap: "anywhere" }}>
            <b>${lyrics.name}</b>
            <span class="muted mono text-xs"
              >· ${count}
              lines${lyrics.us ? " · exact notes from the chart" : ""} · saved
              for this song</span
            >
          </p>`
        : html`<p class="muted text-sm">
            ${origName
              ? hint
              : "Upload the song first, then add its lyrics file."}
          </p>`}
      ${err &&
      html`<p class="text-sm" style=${{ color: "var(--bad)" }}>${err}</p>`}
      ${lyrics &&
      orig &&
      orig.data &&
      html`<p class="text-xs muted" style=${{ marginTop: 4 }}>
        <button class="link-btn" onClick=${exportUs}>
          Save as UltraStar file</button
        >${expMsg
          ? " · " + expMsg
          : " · plays in UltraStar and other karaoke games"}
      </p>`}
      ${lyrics &&
      orig &&
      orig.data &&
      !lyrics.us &&
      html`<p class="text-xs muted" style=${{ marginTop: 4 }}>
        <button class="link-btn" onClick=${lineUp}>
          Line up with the singing</button
        >${lineMsg ? " · " + lineMsg : ""}
      </p>`}
    </div>
    ${lyrics &&
    html`<div class="flex items-center gap-2">
      <button
        class="btn"
        style=${btn}
        onClick=${() =>
          updateLyrics({
            ...lyrics,
            offset: Math.round((lyrics.offset - 0.25) * 100) / 100,
          })}
      >
        −0.25 s
      </button>
      <span
        class="mono text-xs"
        style=${{ minWidth: 92, textAlign: "center" }}
        >${lyrics.offset === 0
          ? "No shift"
          : "Shift " + signed(lyrics.offset.toFixed(2)) + " s"}</span
      >
      <button
        class="btn"
        style=${btn}
        onClick=${() =>
          updateLyrics({
            ...lyrics,
            offset: Math.round((lyrics.offset + 0.25) * 100) / 100,
          })}
      >
        +0.25 s
      </button>
      <button
        class="btn btn-ghost"
        style=${btn}
        onClick=${() => updateLyrics(null)}
      >
        Remove
      </button>
    </div>`}
    <button
      class=${"btn" + (lyrics ? "" : " btn-primary")}
      disabled=${!origName}
      onClick=${() => runFind(find ? find.q : cleanSongName(origName))}
    >
      Find lyrics
    </button>
    <button
      class="btn"
      disabled=${!origName}
      onClick=${() => ref.current && ref.current.click()}
    >
      ${lyrics ? "Replace with a file" : "Upload a file"}
    </button>
    ${find &&
    html`<div class="flex flex-col gap-2" style=${{ flexBasis: "100%" }}>
      <form
        class="flex gap-2"
        onSubmit=${(e) => {
          e.preventDefault();
          runFind(e.target.elements.q.value.trim());
        }}
      >
        <input
          name="q"
          class="input"
          aria-label="Search lyrics"
          defaultValue=${find.q}
          key=${find.q}
          style=${{
            flex: 1,
            minWidth: 0,
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid var(--line)",
            background: "var(--surface-2)",
            color: "var(--fg)",
          }}
        />
        <button class="btn" type="submit" disabled=${find.busy}>
          ${find.busy ? "Searching…" : "Search"}
        </button>
      </form>
      ${find.msg && html`<p class="text-xs muted">${find.msg}</p>`}
      ${(find.results || []).map((x) => {
        const d = dur && x.duration ? x.duration - dur : null;
        return html`<div
          key=${x.id}
          class="file-row"
          style=${{ padding: "8px 12px" }}
        >
          <span class="flex flex-col min-w-0" style=${{ flex: 1 }}>
            <span
              class="text-sm font-semibold"
              style=${{ overflowWrap: "anywhere" }}
              >${x.trackName}</span
            >
            <span class="text-xs muted" style=${{ overflowWrap: "anywhere" }}
              >${x.artistName}${x.duration
                ? " · " + fmt(x.duration)
                : ""}${d == null
                ? ""
                : Math.abs(d) <= 3
                  ? " · same length as your song"
                  : " · " +
                    Math.round(Math.abs(d)) +
                    " s " +
                    (d > 0 ? "longer" : "shorter")}</span
            >
          </span>
          <button
            class="btn"
            style=${{ padding: "5px 12px", fontSize: 13 }}
            onClick=${() => useFound(x)}
          >
            Use
          </button>
        </div>`;
      })}
      ${!find.busy &&
      html`<p class="text-xs muted">
        Timed lyrics from
        <a
          href="https://lrclib.net"
          target="_blank"
          rel="noopener"
          style=${{ color: "var(--accent)" }}
          >LRCLIB</a
        >, a free community library.
      </p>`}
    </div>`}
    <input
      ref=${ref}
      type="file"
      class="hidden"
      onChange=${(e) => {
        const f = e.target.files && e.target.files[0];
        e.target.value = "";
        if (f) pickLyrics(f);
      }}
    />
  </div>`;
}

/* ---------- sing-back scoring (Learn) ---------- */

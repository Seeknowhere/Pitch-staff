// "Pick a song" sheet: song, vocal, instrumental and lyrics files.
import { useState, useRef, useEffect } from "react";
import { Icon } from "../components/Icon.jsx";
import { saveBlob } from "../lib/audio.js";
import { lyricSpans } from "../lib/lyrics.js";
import { hasWebGPU } from "../lib/split.js";
import { pianoKeys } from "../lib/wording.js";
import { LyricsCard } from "./LyricsCard.jsx";
import { SongLibrary } from "./SongLibrary.jsx";

function FileRow({ id, title, sub, slot, onPick, disabled }) {
  const ref = useRef(null);
  const ready = slot && (slot.data || slot.buffer);
  return (
    <div className="file-row">
      <span className="flex flex-col min-w-0" style={{ flex: 1 }}>
        <span className="font-semibold text-sm">{title}</span>
        <span className="text-xs muted" style={{ overflowWrap: "anywhere" }}>
          {slot && slot.busy
            ? slot.progress != null
              ? "Analyzing " + Math.round(slot.progress * 100) + "%"
              : "Reading…"
            : slot && slot.error
              ? slot.error
              : ready
                ? slot.name
                : sub}
        </span>
      </span>
      {ready && (
        <span style={{ color: "var(--good)" }}>
          <Icon name="check" size={18} />
        </span>
      )}
      <button
        className="btn"
        style={{ padding: "6px 12px", fontSize: 13 }}
        disabled={disabled || (slot && slot.busy)}
        onClick={() => ref.current && ref.current.click()}
      >
        {ready ? "Replace" : "Upload"}
      </button>
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

// the song picker: sample songs first, then your own files
function SplitRow({ split, onSplit, onCancel }) {
  const ref = useRef(null);
  const [gpu, setGpu] = useState(null);
  useEffect(() => {
    hasWebGPU().then(setGpu);
  }, []);
  const busy = split && !split.error && !split.done;
  const pct = busy ? Math.round((split.p || 0) * 100) : 0;
  const left =
    busy && split.stage === "split" && split.p > 0.02 && split.t0
      ? Math.max(0, ((Date.now() - split.t0) / 1000) * (1 / split.p - 1))
      : null;
  const msg = !split
    ? gpu === false
      ? "Any song file with singing and music. This device can't use its graphics chip, so splitting may take 10+ minutes."
      : "Any song file with singing and music. Tono splits the voice from the music on your device, about a minute on most laptops."
    : split.error
      ? split.error
      : split.done
        ? split.fromSaved
          ? "Split " + split.name + " before, so it's ready right away."
          : "Split " + split.name + ". Tono remembers it, so next time it's instant."
        : split.stage === "decode"
          ? "Reading " + split.name + "…"
          : split.stage === "model"
            ? "Downloading the splitter (once): " + pct + "%"
            : split.stage === "start"
              ? "Starting the splitter…"
              : "Splitting voice from music… " +
                pct +
                "%" +
                (left != null
                  ? " · about " +
                    (left < 60
                      ? Math.ceil(left / 5) * 5 + " s"
                      : Math.ceil(left / 60) + " min") +
                    " left"
                  : "");
  return (
    <div
      className="file-row"
      style={{
        flexDirection: "column",
        alignItems: "stretch",
        gap: 10,
        borderColor: "color-mix(in srgb, var(--accent) 45%, var(--line))",
      }}
    >
      <div className="flex items-center gap-3">
        <span className="flex flex-col min-w-0" style={{ flex: 1 }}>
          <span className="font-semibold text-sm">Load a song</span>
          <span
            className="text-xs muted"
            role="status"
            style={{
              overflowWrap: "anywhere",
              color: split && split.error ? "var(--warn)" : undefined,
            }}
          >
            {msg}
          </span>
        </span>
        {busy ? (
          <button
            className="btn"
            style={{ padding: "6px 12px", fontSize: 13 }}
            onClick={onCancel}
          >
            Stop
          </button>
        ) : (
          <button
            className="btn btn-primary"
            style={{ padding: "6px 12px", fontSize: 13 }}
            onClick={() => ref.current && ref.current.click()}
          >
            Choose song
          </button>
        )}
        <input
          id="setup-song"
          ref={ref}
          type="file"
          accept="audio/*,.mp3,.m4a,.wav,.flac,.ogg"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files && e.target.files[0];
            e.target.value = "";
            if (f) onSplit(f);
          }}
        />
      </div>
      {split && split.done && split.files && (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="muted">Save the split files:</span>
          <button
            className="link-btn text-xs"
            onClick={() =>
              saveBlob(split.files.vocal, split.base + " (vocal).wav")
            }
          >
            Save vocal
          </button>
          <button
            className="link-btn text-xs"
            onClick={() =>
              saveBlob(split.files.music, split.base + " (music).wav")
            }
          >
            Save music
          </button>
          <span className="muted">
            WAV, about {Math.max(1, Math.round(split.files.vocal.size / 1e6))}MB
            each
          </span>
        </div>
      )}
      {busy && (
        <div
          style={{
            height: 6,
            borderRadius: 3,
            background: "var(--line)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: pct + "%",
              background: "var(--accent)",
              transition: "width .3s",
            }}
          />
        </div>
      )}
    </div>
  );
}

export function SongSetup({
  vocal,
  music,
  lyricsEntry,
  updateLyrics,
  onPickVocal,
  onPickMusic,
  onLoadSample,
  sampleName,
  sync,
  onSync,
  onAutoSync,
  syncMsg,
  keyWarn,
  onDone,
  onContinue,
  canSplit,
  split,
  onSplit,
  onCancelSplit,
}) {
  const ready = vocal && vocal.data;
  const spans = ready ? lyricSpans(lyricsEntry, vocal.data.duration) : [];
  const small = { padding: "5px 10px", fontSize: 13 };
  return (
    <div className="flex flex-col gap-5">
      {canSplit && (
        <section className="flex flex-col gap-2">
          <span className="label">Your song</span>
          <SplitRow split={split} onSplit={onSplit} onCancel={onCancelSplit} />
        </section>
      )}
      <section className="flex flex-col gap-2">
        <span className="label">Sample songs</span>
        <SongLibrary
          inline={true}
          onLoad={async (x) => {
            await onLoadSample(x);
            onDone && onDone();
          }}
          current={ready ? sampleName : null}
        />
      </section>
      <section className="flex flex-col gap-2">
        <span className="label">
          {canSplit
            ? "Or upload the vocal and music separately"
            : "Or use your own files"}
        </span>
        <div className="file-list">
          <FileRow
            id="setup-vocal"
            title="Vocal (acapella)"
            sub="Needed. The singer's voice on its own."
            slot={vocal}
            onPick={onPickVocal}
          />
          <FileRow
            id="setup-music"
            title="Instrumental"
            sub="For Karaoke. The song without vocals."
            slot={music}
            onPick={onPickMusic}
            disabled={!ready}
          />
          <LyricsCard
            orig={vocal}
            musicName={music && music.buffer ? music.name : null}
            lyrics={lyricsEntry}
            updateLyrics={updateLyrics}
            count={spans.length}
            hint="Optional. Timed lyrics show while you sing."
          />
        </div>
        {keyWarn !== 0 && music && music.buffer && (
          <p className="text-xs" style={{ color: "var(--warn)" }}>
            This instrumental seems to be {pianoKeys(Math.abs(keyWarn))}
            {keyWarn > 0 ? "higher" : "lower"}
            {
              " than the vocal, so they may clash.\n        Look for a version in the original key."
            }
          </p>
        )}
      </section>
      {ready && music && music.buffer && (
        <section className="flex flex-col gap-2">
          <span className="label">Music timing</span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="btn"
              style={small}
              onClick={() => onSync(Math.round((sync - 0.1) * 100) / 100)}
            >
              −0.1 s
            </button>
            <span
              className="mono text-xs"
              style={{ minWidth: 110, textAlign: "center" }}
            >
              {sync === 0
                ? "No shift"
                : "Music " +
                  (sync > 0
                    ? "skips " + sync.toFixed(2) + " s"
                    : "waits " + (-sync).toFixed(2) + " s")}
            </span>
            <button
              className="btn"
              style={small}
              onClick={() => onSync(Math.round((sync + 0.1) * 100) / 100)}
            >
              +0.1 s
            </button>
            <button
              className="btn btn-ghost"
              style={small}
              onClick={onAutoSync}
            >
              Auto-sync
            </button>
          </div>
          <p className="text-xs muted">
            {syncMsg ||
              "Lines the music up with the vocal. Check it by ear in Karaoke's options."}
          </p>
        </section>
      )}
      {onContinue && ready && (
        <button
          className="btn btn-primary"
          style={{ justifyContent: "center", minHeight: 50, fontSize: 16 }}
          onClick={onContinue}
        >
          Continue
        </button>
      )}
    </div>
  );
}

/* ---------- app ---------- */
/* ---------- practice plan: drills built from your mistakes ---------- */

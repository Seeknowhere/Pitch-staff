// The battle album: battles both singers chose to keep, as a scrapbook. The list shows each
// battle as a little collage; tapping one opens its full collage, the remix and the scores.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../components/Icon.jsx";
import { saveBlob } from "../../lib/audio.js";
import {
  listBattles,
  onAlbumChanged,
  removeBattle,
} from "../../lib/battleAlbum.js";

const mb = (n) =>
  n >= 1e9
    ? (n / 1e9).toFixed(1) + " GB"
    : Math.max(1, Math.round(n / 1e6)) + " MB";
function when(t) {
  const days = Math.floor((Date.now() - t) / 864e5);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
}
const sizeOf = (b) =>
  [...b.myPhotos, ...b.theirPhotos].reduce((a, p) => a + (p.size || 0), 0) +
  (b.remix ? b.remix.size : 0);

// your photos and theirs, taking turns, so the collage mixes both singers
function mixPhotos(b) {
  const out = [];
  for (let i = 0; i < Math.max(b.myPhotos.length, b.theirPhotos.length); i++) {
    if (b.myPhotos[i]) out.push({ blob: b.myPhotos[i], me: true });
    if (b.theirPhotos[i]) out.push({ blob: b.theirPhotos[i], me: false });
  }
  return out;
}
// object URLs for a battle's photos, freed when no longer shown
function usePhotoUrls(b, max) {
  const list = useMemo(() => mixPhotos(b).slice(0, max), [b, max]);
  const urls = useMemo(
    () => list.map((p) => URL.createObjectURL(p.blob)),
    [list],
  );
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  return list.map((p, i) => ({ ...p, url: urls[i] }));
}

// where each photo sits in a collage (percent of the board) and how it's tilted
const TILE_SLOTS = [
  { l: 6, t: 9, w: 47, r: -8 },
  { l: 43, t: 17, w: 45, r: 6 },
  { l: 20, t: 45, w: 42, r: -2 },
];
const BOARD_SLOTS = [
  { l: 4, t: 5, w: 37, r: -7, tape: [12, 2, -12] },
  { l: 56, t: 3, w: 40, r: 6, tape: [70, 1, 9] },
  { l: 32, t: 32, w: 35, r: -2, tape: [42, 30, 4] },
  { l: 3, t: 61, w: 33, r: 5 },
  { l: 61, t: 56, w: 34, r: -9, tape: [70, 54, -16] },
  { l: 36, t: 68, w: 28, r: 8 },
];

function Polaroid({ p, slot, caption }) {
  return (
    <div
      className="pola"
      style={{
        left: slot.l + "%",
        top: slot.t + "%",
        width: slot.w + "%",
        transform: "rotate(" + slot.r + "deg)",
      }}
    >
      <img
        src={p.url}
        alt={p.me ? "You singing" : "Your friend singing"}
        className={p.me ? "me" : "them"}
      />
      {caption && <span className="pola-cap">{caption}</span>}
    </div>
  );
}

function Sticker({ result, you, opp, style }) {
  const cls = result > 0 ? "win" : result < 0 ? "loss" : "draw";
  return (
    <div className={"album-sticker " + cls} style={style}>
      <span className="mono">
        {result > 0 ? "WIN" : result < 0 ? "LOSS" : "DRAW"}
      </span>
      <b>
        {you}–{opp}
      </b>
    </div>
  );
}

function Tile({ b, onOpen }) {
  const photos = usePhotoUrls(b, 3);
  return (
    <button className="album-tile" onClick={onOpen}>
      <div className="album-tile-board">
        {photos.map((p, i) => (
          <Polaroid key={p.url} p={p} slot={TILE_SLOTS[i]} />
        ))}
        {photos.length > 0 && (
          <div
            className="tape"
            style={{ left: "18%", top: "4%", transform: "rotate(-14deg)" }}
          ></div>
        )}
        {photos.length > 1 && (
          <div
            className="tape"
            style={{ left: "62%", top: "12%", transform: "rotate(10deg)" }}
          ></div>
        )}
        {!photos.length && (
          <span className="album-tile-song">{b.song || "Battle"}</span>
        )}
        <Sticker
          result={b.result}
          you={b.you}
          opp={b.opp}
          style={{ right: 8, bottom: 10, transform: "rotate(12deg)" }}
        />
      </div>
      <span className="font-semibold" style={{ fontSize: 15 }}>
        vs {b.rival}
      </span>
      <span className="text-xs muted">
        {[b.song, when(b.at)].filter(Boolean).join(" · ")}
      </span>
    </button>
  );
}

// the remix with a gold/blue timeline of who's singing, filling in as it plays
function RemixPlayer({ b }) {
  const url = useMemo(
    () => (b.remix ? URL.createObjectURL(b.remix) : null),
    [b],
  );
  const audio = useRef(null);
  const [pos, setPos] = useState(0);
  const [on, setOn] = useState(false);
  useEffect(
    () => () => {
      if (audio.current) audio.current.pause();
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  if (!url) return null;
  const dur = b.remixDur || 1;
  const bars = Array.from({ length: 40 }, (_, i) => {
    const t = ((i + 0.5) / 40) * dur;
    const sg = (b.remixSegs || []).find((s) => t >= s.from && t < s.to);
    return {
      who: sg ? sg.who : 0,
      h: 10 + Math.round(30 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6))),
      done: t <= pos,
    };
  });
  const toggle = () => {
    if (!audio.current) {
      const a = new Audio(url);
      a.ontimeupdate = () => setPos(a.currentTime);
      a.onended = () => {
        setOn(false);
        setPos(0);
      };
      audio.current = a;
    }
    if (on) {
      audio.current.pause();
      setOn(false);
    } else {
      audio.current.play().catch(() => {});
      setOn(true);
    }
  };
  return (
    <div className="album-remix">
      <div className="flex items-center gap-3">
        <button
          className="album-play"
          onClick={toggle}
          aria-label={on ? "Pause the battle remix" : "Play the battle remix"}
        >
          <Icon name={on ? "pause" : "play"} size={22} />
        </button>
        <div className="flex flex-col" style={{ minWidth: 0 }}>
          <span className="display font-bold" style={{ fontSize: 18 }}>
            Battle remix
          </span>
          <span className="text-xs muted">
            {Math.round(dur) < 60
              ? "0:" + String(Math.round(dur)).padStart(2, "0")
              : "1:00"}{" "}
            · each line sung by whoever won it
          </span>
        </div>
      </div>
      <div
        className="album-bars"
        role="img"
        aria-label={
          "Remix timeline: gold is " + b.myName + ", blue is " + b.rival
        }
      >
        {bars.map((x, i) => (
          <span
            key={i}
            className={
              (x.who > 0 ? "you" : x.who < 0 ? "opp" : "both") +
              (on || pos > 0 ? (x.done ? "" : " later") : "")
            }
            style={{ height: x.h }}
          ></span>
        ))}
      </div>
      <div className="flex gap-4 text-xs muted">
        <span className="flex items-center gap-2">
          <span className="album-key you"></span>
          {b.myName}
        </span>
        <span className="flex items-center gap-2">
          <span className="album-key opp"></span>
          {b.rival}
        </span>
      </div>
      <DownloadRemix b={b} />
    </div>
  );
}

// a copy of the remix to keep (both singers agreed to this when they saved the battle)
function DownloadRemix({ b }) {
  const [msg, setMsg] = useState("");
  const name =
    [b.myName + " vs " + b.rival, b.song, "remix"]
      .filter(Boolean)
      .join(" - ")
      .replace(/[^\w\- ]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60) + ".wav";
  return (
    <div className="flex flex-col gap-1">
      <button
        className="btn"
        style={{ alignSelf: "flex-start" }}
        onClick={async () => {
          try {
            await saveBlob(b.remix, name);
            setMsg(
              "Downloaded. If you post it, apps may mute it because of the song's music.",
            );
          } catch (e) {
            setMsg(
              e && e.code === "declined"
                ? "Download cancelled."
                : "Downloading isn't available here.",
            );
          }
        }}
      >
        ⬇ Download remix
      </button>
      {msg && <span className="text-xs muted">{msg}</span>}
    </div>
  );
}

function Detail({ b, onBack }) {
  const photos = usePhotoUrls(b, 6);
  const [sure, setSure] = useState(false);
  const rows = [
    ["Lines won", b.you, b.opp],
    [
      "Overall",
      b.myAvg != null ? b.myAvg + "%" : "—",
      b.theirAvg != null ? b.theirAvg + "%" : "—",
    ],
    ["Perfect lines", b.myPerfect, b.theirPerfect],
    [
      "Best combo",
      b.myCombo != null ? "×" + b.myCombo : "—",
      b.theirCombo != null ? "×" + b.theirCombo : "—",
    ],
  ];
  return (
    <section
      className="flex flex-col gap-4"
      style={{ maxWidth: 520, width: "100%", margin: "0 auto" }}
    >
      <button
        className="btn btn-ghost"
        style={{ alignSelf: "flex-start", padding: "6px 10px" }}
        onClick={onBack}
      >
        <span className="flex items-center gap-1">
          <Icon name="back" size={18} />
          Album
        </span>
      </button>
      <div className="flex flex-col gap-1">
        <h2
          className="display font-bold"
          style={{
            fontSize: 30,
            lineHeight: 1.05,
            margin: 0,
            letterSpacing: "-0.02em",
          }}
        >
          <span style={{ color: "#f3d18c" }}>{b.myName}</span> vs{" "}
          <span style={{ color: "#9cc4ff" }}>{b.rival}</span>
        </h2>
        <span className="text-sm muted">
          {new Date(b.at).toLocaleString([], {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
      </div>
      <div className="album-board">
        {photos.map((p, i) => (
          <React.Fragment key={p.url}>
            <Polaroid
              p={p}
              slot={BOARD_SLOTS[i]}
              caption={p.me ? b.myName : b.rival}
            />
            {BOARD_SLOTS[i].tape && (
              <div
                className="tape big"
                style={{
                  left: BOARD_SLOTS[i].tape[0] + "%",
                  top: BOARD_SLOTS[i].tape[1] + "%",
                  transform: "rotate(" + BOARD_SLOTS[i].tape[2] + "deg)",
                }}
              ></div>
            )}
          </React.Fragment>
        ))}
        {!photos.length && (
          <span className="album-tile-song">No photos this time</span>
        )}
        <div
          className={
            "album-winner " +
            (b.result > 0 ? "win" : b.result < 0 ? "loss" : "draw")
          }
        >
          <span className="mono">{b.result ? "WINNER" : "DRAW"}</span>
          <b>{b.result > 0 ? b.myName : b.result < 0 ? b.rival : "Both!"}</b>
        </div>
        <div className="album-stub">
          <span className="mono">THE SONG</span>
          <b>{b.song || "Battle"}</b>
          <span className="mono">
            {b.you} – {b.opp} lines
          </span>
        </div>
      </div>
      <RemixPlayer b={b} />
      <div className="album-stats" role="table" aria-label="Scores">
        <div role="row" className="head">
          <span role="columnheader"></span>
          <span role="columnheader" style={{ color: "#f3d18c" }}>
            {b.myName}
          </span>
          <span role="columnheader" style={{ color: "#9cc4ff" }}>
            {b.rival}
          </span>
        </div>
        {rows.map(([k, a, c]) => (
          <div role="row" key={k}>
            <span role="rowheader" className="muted">
              {k}
            </span>
            <span role="cell">{a}</span>
            <span role="cell">{c}</span>
          </div>
        ))}
      </div>
      <button
        className="btn btn-ghost album-remove"
        onClick={() => {
          if (!sure) return setSure(true);
          removeBattle(b.id).catch(() => {});
          onBack();
        }}
        onBlur={() => setSure(false)}
      >
        {sure ? "Tap again to remove it" : "Remove from album"}
      </button>
    </section>
  );
}

export function BattleAlbum({ onBack }) {
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);
  useEffect(() => {
    const load = () =>
      listBattles()
        .then(setList)
        .catch(() => setList([]));
    load();
    return onAlbumChanged(load);
  }, []);
  const current = open && list ? list.find((b) => b.id === open) : null;
  if (current) return <Detail b={current} onBack={() => setOpen(null)} />;
  const wins = (list || []).filter((b) => b.result > 0).length,
    losses = (list || []).filter((b) => b.result < 0).length;
  return (
    <section
      className="flex flex-col gap-5"
      style={{ maxWidth: 560, width: "100%", margin: "0 auto" }}
    >
      <button
        className="btn btn-ghost"
        style={{ alignSelf: "flex-start", padding: "6px 10px" }}
        onClick={onBack}
      >
        <span className="flex items-center gap-1">
          <Icon name="back" size={18} />
          Modes
        </span>
      </button>
      <div className="flex flex-col gap-1">
        <h2
          className="display font-bold"
          style={{
            fontSize: 34,
            lineHeight: 1.05,
            margin: 0,
            letterSpacing: "-0.02em",
          }}
        >
          Battle album
        </h2>
        <p className="text-sm muted" style={{ margin: 0 }}>
          Battles you both chose to keep. On this phone only.
        </p>
      </div>
      {list && list.length > 0 ? (
        <>
          <div className="album-record">
            <div>
              <b>{list.length}</b>
              <span>battles</span>
            </div>
            <div>
              <b style={{ color: "#f3d18c" }}>{wins}</b>
              <span>wins</span>
            </div>
            <div>
              <b style={{ color: "#9cc4ff" }}>{losses}</b>
              <span>losses</span>
            </div>
          </div>
          <div className="album-grid">
            {list.map((b) => (
              <Tile key={b.id} b={b} onOpen={() => setOpen(b.id)} />
            ))}
          </div>
          <p
            className="text-xs muted"
            style={{ textAlign: "center", margin: 0 }}
          >
            {list.length} {list.length === 1 ? "battle" : "battles"} ·{" "}
            {mb(list.reduce((a, b) => a + sizeOf(b), 0))} on this phone
          </p>
        </>
      ) : list ? (
        <p className="text-sm muted">
          No battles saved yet. After a battle, tap “Save to album” on the
          results. If your friend taps it too, it lands here.
        </p>
      ) : null}
    </section>
  );
}

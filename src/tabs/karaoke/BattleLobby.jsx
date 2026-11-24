// Karaoke starts with a choice: sing solo or battle a friend.
// A battle goes: create or join a room → agree on the song in the lobby → host starts it on both phones.
import React, { useState } from "react";
import { Icon } from "../../components/Icon.jsx";
import { fmt } from "../../lib/music.js";
import { songsMatch } from "./useBattle.js";

export function KaraokeModePick({ onSolo, onBattle }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="empty-hero">
        <h2 className="display text-3xl font-bold" style={{ letterSpacing: "-0.02em" }}>
          How do you want to sing?
        </h2>
      </div>
      <div className="mode-cards">
        <button className="mode-card" onClick={onSolo}>
          <span className="mode-emoji" aria-hidden="true">🎤</span>
          <span className="display font-bold text-xl">Sing solo</span>
          <span className="text-sm muted">Sing a song and beat your own best score.</span>
        </button>
        <button className="mode-card battle" onClick={onBattle}>
          <span className="mode-emoji" aria-hidden="true">⚔️</span>
          <span className="display font-bold text-xl">Battle a friend</span>
          <span className="text-sm muted">
            Challenge a friend, line by line. Best singer takes it.
          </span>
        </button>
      </div>
    </section>
  );
}

export function BattleJoin({ ctl, onBack }) {
  const [code, setCode] = useState("");
  return (
    <section className="flex flex-col gap-4" style={{ maxWidth: 420, width: "100%", margin: "0 auto" }}>
      <BackLink onClick={onBack} label="Modes" />
      <h2 className="display text-2xl font-bold">Battle a friend</h2>
      <label className="flex flex-col gap-1" htmlFor="battle-name">
        <span className="label">Your name</span>
        <input
          id="battle-name"
          className="battle-input"
          value={ctl.myName}
          maxLength={16}
          onChange={(e) => ctl.setMyName(e.target.value)}
        />
      </label>
      <button
        className="btn btn-primary"
        style={{ justifyContent: "center", minHeight: 48 }}
        onClick={ctl.create}
      >
        Create battle
      </button>
      <span className="text-xs muted" style={{ textAlign: "center" }}>
        or join a friend's battle with their code
      </span>
      <div className="flex gap-2">
        <input
          className="battle-input mono"
          aria-label="Battle code"
          inputMode="numeric"
          maxLength={4}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          style={{ flex: 1, letterSpacing: "0.3em", textAlign: "center" }}
        />
        <button className="btn" disabled={code.length !== 4} onClick={() => ctl.join(code)}>
          Join
        </button>
      </div>
      <p className="text-xs muted">Only your names and line scores are shared, never your voice.</p>
    </section>
  );
}

// mySong: { song, dur } for the song loaded on this phone (song "" when none)
// picker: the song picker to show while you still need a song
// onChangeSong: open the song sheet to swap songs
export function BattleLobby({ ctl, mySong, picker, onChangeSong }) {
  const b = ctl.state;
  const peer = b.peer;
  const hostSong = b.host ? mySong : peer && peer.host ? peer : null;
  const haveSong = !!mySong.song;
  const match = songsMatch(mySong, peer);
  const canStart = b.host && peer && haveSong && peer.song;
  return (
    <section className="flex flex-col gap-4" style={{ maxWidth: 520, width: "100%", margin: "0 auto" }}>
      <BackLink onClick={ctl.leave} label="Leave battle" />
      <div className="battle-lobby">
        <span className="label">Battle code</span>
        <span className="display font-bold mono" style={{ fontSize: 44, letterSpacing: "0.15em", lineHeight: 1 }}>
          {b.code}
        </span>
        {b.status === "error" ? (
          <p className="text-sm" style={{ color: "var(--bad)" }}>
            Couldn't connect. Check your internet and try again.
          </p>
        ) : b.status === "connecting" ? (
          <p className="text-sm muted">Connecting…</p>
        ) : !peer ? (
          <p className="text-sm muted">
            {b.lastName
              ? b.lastName + " left. Waiting for them to come back…"
              : "Share this code with a friend so they can join."}
          </p>
        ) : null}
        <div className="lobby-players">
          <PlayerRow you name={ctl.myName.trim() || "You"} song={mySong} host={b.host} />
          {peer && <PlayerRow name={peer.name} song={peer} host={peer.host} />}
        </div>
      </div>

      {!haveSong ? (
        <>
          <div>
            <h3 className="display text-xl font-bold">
              {b.host ? "Pick the battle song" : "Load the battle song"}
            </h3>
            <p className="text-sm muted">
              {b.host
                ? "Your friend will need the same song on their phone."
                : hostSong && hostSong.song
                  ? hostSong.name + " picked “" + hostSong.song + "”" + (hostSong.dur ? " (" + fmt(hostSong.dur) + ")" : "") + ". Load the same song."
                  : "Waiting for " + (peer ? peer.name : "the host") + " to pick a song. You can load it as soon as you know which."}
            </p>
          </div>
          {picker}
        </>
      ) : (
        <div className="flex flex-col gap-2">
          {peer && peer.song && !match && (
            <p className="text-sm" style={{ color: "var(--warn)" }}>
              Your songs look like different versions ({fmt(mySong.dur)} vs {fmt(peer.dur)}), so
              your scores won't line up. Load the same file as {peer.name}.
            </p>
          )}
          <button className="btn" style={{ alignSelf: "flex-start" }} onClick={onChangeSong}>
            Change song
          </button>
        </div>
      )}

      {b.host ? (
        <button
          className="btn btn-primary"
          style={{ justifyContent: "center", minHeight: 52, fontSize: 16 }}
          disabled={!canStart}
          onClick={ctl.start}
        >
          {!peer
            ? "Waiting for a friend…"
            : !haveSong || !peer.song
              ? "Waiting for both songs…"
              : "Start battle ⚔️"}
        </button>
      ) : (
        peer && (
          <p className="text-sm muted" style={{ textAlign: "center" }}>
            {haveSong ? "Ready! Waiting for " + peer.name + " to start…" : ""}
          </p>
        )
      )}
      <p className="text-xs muted" style={{ textAlign: "center" }}>
        Wear headphones: you'll get a quick headphone check before the countdown if you haven't done one.
      </p>
    </section>
  );
}

function PlayerRow({ name, song, host, you }) {
  return (
    <div className={"lobby-player" + (you ? " you" : "")}>
      <span className="font-semibold">
        {name}
        {you ? " (you)" : ""}
        {host ? " · host" : ""}
      </span>
      <span className="text-xs muted" style={{ overflowWrap: "anywhere" }}>
        {song && song.song ? "✓ " + song.song + (song.dur ? " · " + fmt(song.dur) : "") : "No song yet"}
      </span>
    </div>
  );
}

function BackLink({ onClick, label }) {
  return (
    <button className="btn btn-ghost" style={{ alignSelf: "flex-start", padding: "6px 10px" }} onClick={onClick}>
      <span className="flex items-center gap-1">
        <Icon name="back" size={18} />
        {label}
      </span>
    </button>
  );
}

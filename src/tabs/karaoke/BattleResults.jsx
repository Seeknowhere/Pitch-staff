// End of a battle: who won, head-to-head stats, and what next.
// Pure fun on purpose: no recording, no analysis, just the match.
import React, { useState } from "react";

const avg = (o) => {
  const v = Object.values(o);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
};
const count90 = (o) => Object.values(o).filter((x) => x >= 90).length;

export function BattleResults({
  myName,
  rivalName,
  mine,
  theirs,
  myCombo,
  theirCombo,
  again,
  rivalHere,
  highlights,
  keep,
  albumState,
  onKeep,
  myPhotos = [],
  theirPhotos = [],
  hlNow,
  onPlayHighlights,
  onStopHighlights,
  onRematch,
  onNewSong,
  onLeave,
}) {
  // lines both of you sang, in song order
  const both = Object.keys(mine)
    .filter((i) => theirs[i] != null)
    .map(Number)
    .sort((a, b) => a - b);
  let you = 0,
    opp = 0;
  both.forEach((i) => {
    if (mine[i] > theirs[i]) you++;
    else if (mine[i] < theirs[i]) opp++;
  });
  const myAvg = avg(mine),
    theirAvg = avg(theirs);
  // lines won decides it; overall score breaks a tie
  const result =
    you !== opp
      ? Math.sign(you - opp)
      : myAvg != null && theirAvg != null && myAvg !== theirAvg
        ? Math.sign(myAvg - theirAvg)
        : 0;
  const stats = [
    ["Lines won", you, opp],
    ["Overall score", myAvg, theirAvg, "%"],
    ["Perfect lines (90%+)", count90(mine), count90(theirs)],
    ["Best combo", myCombo, theirCombo, "", "×"],
  ];
  const fmtStat = (v, suf = "", pre = "") => (v == null ? "—" : pre + v + suf);

  return (
    <section
      className="flex flex-col gap-5"
      style={{ maxWidth: 560, width: "100%", margin: "0 auto" }}
    >
      <div
        className={
          "battle-win " + (result > 0 ? "you" : result < 0 ? "opp" : "tie")
        }
      >
        <span className="battle-win-emoji" aria-hidden="true">
          {result > 0 ? "🏆" : result < 0 ? "😤" : "🤝"}
        </span>
        <h2
          className="display font-bold"
          style={{ fontSize: 32, lineHeight: 1.1, margin: 0 }}
        >
          {result > 0
            ? "You win!"
            : result < 0
              ? rivalName + " wins this round"
              : "It's a draw!"}
        </h2>
        <span className="display font-bold mono" style={{ fontSize: 22 }}>
          <span style={{ color: "#f3d18c" }}>{you}</span>
          <span className="muted"> – </span>
          <span style={{ color: "#9cc4ff" }}>{opp}</span>
          <span className="muted text-sm" style={{ fontWeight: 500 }}>
            {" "}
            lines
          </span>
        </span>
        {result < 0 && <span className="text-sm muted">Rematch?</span>}
      </div>

      <div className="battle-stats" role="table" aria-label="Head to head">
        <div className="battle-stats-row head" role="row">
          <span role="columnheader"></span>
          <span role="columnheader" className="you">
            {myName}
          </span>
          <span role="columnheader" className="opp">
            {rivalName}
          </span>
        </div>
        {stats.map(([label, a, b, suf, pre]) => (
          <div className="battle-stats-row" role="row" key={label}>
            <span role="rowheader" className="muted text-sm">
              {label}
            </span>
            <span
              role="cell"
              className={a != null && (b == null || a > b) ? "best you" : ""}
            >
              {fmtStat(a, suf, pre)}
            </span>
            <span
              role="cell"
              className={b != null && (a == null || b > a) ? "best opp" : ""}
            >
              {fmtStat(b, suf, pre)}
            </span>
          </div>
        ))}
      </div>

      {(myPhotos.length > 0 || theirPhotos.length > 0) && (
        <CandidPhotos
          myName={myName}
          rivalName={rivalName}
          mine={myPhotos}
          theirs={theirPhotos}
        />
      )}

      {highlights && (highlights.waiting || highlights.items.length > 0) && (
        <div className="battle-hl" aria-live="polite">
          {hlNow ? (
            <>
              <span className="label">Now playing</span>
              <b style={{ overflowWrap: "anywhere" }}>{hlNow}</b>
              <button className="btn" onClick={onStopHighlights}>
                ■ Stop
              </button>
            </>
          ) : (
            <button
              className="btn btn-primary"
              style={{ justifyContent: "center", minHeight: 52, fontSize: 16 }}
              disabled={highlights.waiting}
              onClick={onPlayHighlights}
            >
              {highlights.waiting
                ? "Getting " + rivalName + "'s voice…"
                : "▶ Play the battle remix"}
            </button>
          )}
        </div>
      )}

      <div className="battle-keep">
        {albumState === "saved" ? (
          <span
            className="text-sm font-semibold"
            style={{ color: "var(--good)" }}
          >
            Saved to your battle album ✓
          </span>
        ) : albumState === "saving" ? (
          <span className="text-sm muted">Saving to your album…</span>
        ) : albumState === "failed" ? (
          <span className="text-sm" style={{ color: "var(--warn)" }}>
            Couldn't save it. This phone may be out of space.
          </span>
        ) : (
          <>
            <button
              className="btn"
              style={{
                justifyContent: "center",
                minHeight: 48,
                alignSelf: "stretch",
              }}
              disabled={!rivalHere || (keep && keep.me)}
              onClick={onKeep}
            >
              {keep && keep.me && keep.peer
                ? "Saving…"
                : keep && keep.me
                  ? "Waiting for " + rivalName + " to say yes…"
                  : keep && keep.peer
                    ? rivalName + " wants to keep this battle. Save it?"
                    : "Save to album"}
            </button>
            <span className="text-xs muted">
              Saved only if you both tap it: the photos, the remix and the
              score, on each of your phones. You'll both be able to keep and
              download the remix.
            </span>
          </>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <button
          className="btn btn-primary"
          style={{ justifyContent: "center", minHeight: 52, fontSize: 16 }}
          disabled={!rivalHere || (again && again.me)}
          onClick={onRematch}
        >
          {!rivalHere
            ? rivalName + " left"
            : again && again.me
              ? "Waiting for " + rivalName + "…"
              : again && again.peer
                ? rivalName + " wants a rematch! Let's go ⚔️"
                : "Rematch ⚔️"}
        </button>
        <div className="flex gap-2">
          <button
            className="btn"
            style={{ flex: 1, justifyContent: "center" }}
            disabled={!rivalHere}
            onClick={onNewSong}
          >
            New song
          </button>
          <button
            className="btn btn-ghost"
            style={{ flex: 1, justifyContent: "center" }}
            onClick={onLeave}
          >
            Leave battle
          </button>
        </div>
      </div>
    </section>
  );
}

// "Caught singing": the surprise photos from both phones; tap one to see it big
function CandidPhotos({ myName, rivalName, mine, theirs }) {
  const [big, setBig] = useState(null);
  const row = (who, list, cls) =>
    list.length > 0 && (
      <div className="flex flex-col gap-1">
        <span className={"text-xs font-semibold " + cls}>{who}</span>
        <div className="candid-row">
          {list.map((u, i) => (
            <button
              key={u}
              className="candid"
              onClick={() => setBig(u)}
              aria-label={"Photo " + (i + 1) + " of " + who}
            >
              <img src={u} alt="" />
            </button>
          ))}
        </div>
      </div>
    );
  return (
    <div className="flex flex-col gap-2">
      <span className="label">📸 Caught singing</span>
      {row(myName, mine, "you")}
      {row(rivalName, theirs, "opp")}
      {big && (
        <button
          className="candid-big"
          onClick={() => setBig(null)}
          aria-label="Close photo"
        >
          <img src={big} alt="" />
        </button>
      )}
    </div>
  );
}

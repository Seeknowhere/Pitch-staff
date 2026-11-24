// End of a battle: who won, head-to-head stats, every line, a few highlights, and what next.
// Pure fun on purpose: no recording, no analysis, just the match.
import React from "react";

const avg = (o) => {
  const v = Object.values(o);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
};
const count90 = (o) => Object.values(o).filter((x) => x >= 90).length;

export function BattleResults({
  myName,
  rivalName,
  lines,
  mine,
  theirs,
  myCombo,
  theirCombo,
  again,
  rivalHere,
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
  const lineText = (i) => (lines[i] && lines[i].text) || "Line " + (i + 1);

  // highlights
  const highs = [];
  const myBest = Object.keys(mine).sort((a, b) => mine[b] - mine[a])[0];
  if (myBest != null) highs.push(["Your best line", "“" + lineText(+myBest) + "”", mine[myBest] + "%"]);
  const close = both
    .filter((i) => mine[i] !== theirs[i])
    .sort((a, b) => Math.abs(mine[a] - theirs[a]) - Math.abs(mine[b] - theirs[b]))[0];
  if (close != null)
    highs.push([
      "Closest line",
      "“" + lineText(close) + "”",
      "won by " + Math.abs(mine[close] - theirs[close]) + "%",
    ]);
  // comeback: the winner's biggest deficit along the way
  if (result) {
    let y = 0,
      o = 0,
      worst = 0,
      at = null;
    both.forEach((i) => {
      if (mine[i] > theirs[i]) y++;
      else if (mine[i] < theirs[i]) o++;
      const down = result > 0 ? o - y : y - o;
      if (down > worst) {
        worst = down;
        at = [y, o];
      }
    });
    if (worst >= 2) {
      const who = result > 0 ? "You were" : rivalName + " was";
      const [a, b] = result > 0 ? [at[0], at[1]] : [at[1], at[0]];
      highs.push(["Comeback", who + " down " + a + "–" + b + " and still won", "💪"]);
    }
  }

  const stats = [
    ["Lines won", you, opp],
    ["Overall score", myAvg, theirAvg, "%"],
    ["Perfect lines (90%+)", count90(mine), count90(theirs)],
    ["Best combo", myCombo, theirCombo, "", "×"],
  ];
  const fmtStat = (v, suf = "", pre = "") => (v == null ? "—" : pre + v + suf);

  return (
    <section className="flex flex-col gap-5" style={{ maxWidth: 560, width: "100%", margin: "0 auto" }}>
      <div className={"battle-win " + (result > 0 ? "you" : result < 0 ? "opp" : "tie")}>
        <span className="battle-win-emoji" aria-hidden="true">
          {result > 0 ? "🏆" : result < 0 ? "😤" : "🤝"}
        </span>
        <h2 className="display font-bold" style={{ fontSize: 32, lineHeight: 1.1, margin: 0 }}>
          {result > 0 ? "You win!" : result < 0 ? rivalName + " wins this round" : "It's a draw!"}
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
          <span role="columnheader" className="you">{myName}</span>
          <span role="columnheader" className="opp">{rivalName}</span>
        </div>
        {stats.map(([label, a, b, suf, pre]) => (
          <div className="battle-stats-row" role="row" key={label}>
            <span role="rowheader" className="muted text-sm">{label}</span>
            <span role="cell" className={a != null && (b == null || a > b) ? "best you" : ""}>
              {fmtStat(a, suf, pre)}
            </span>
            <span role="cell" className={b != null && (a == null || b > a) ? "best opp" : ""}>
              {fmtStat(b, suf, pre)}
            </span>
          </div>
        ))}
      </div>

      {highs.length > 0 && (
        <div className="flex flex-col gap-2">
          {highs.map(([k, t, v]) => (
            <div className="battle-high" key={k}>
              <span className="label">{k}</span>
              <span className="text-sm" style={{ overflowWrap: "anywhere" }}>{t}</span>
              <b>{v}</b>
            </div>
          ))}
        </div>
      )}

      {both.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="label">Line by line</span>
          <ol className="battle-lines">
            {both.map((i) => {
              const w = Math.sign(mine[i] - theirs[i]);
              return (
                <li key={i} className={w > 0 ? "you" : w < 0 ? "opp" : "tie"}>
                  <span className="text-sm" style={{ overflowWrap: "anywhere" }}>{lineText(i)}</span>
                  <span className="mono text-sm">
                    <span style={{ color: "#f3d18c", fontWeight: w > 0 ? 700 : 400 }}>{mine[i]}</span>
                    <span className="muted"> · </span>
                    <span style={{ color: "#9cc4ff", fontWeight: w < 0 ? 700 : 400 }}>{theirs[i]}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

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
          <button className="btn" style={{ flex: 1, justifyContent: "center" }} disabled={!rivalHere} onClick={onNewSong}>
            New song
          </button>
          <button className="btn btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={onLeave}>
            Leave battle
          </button>
        </div>
      </div>
    </section>
  );
}

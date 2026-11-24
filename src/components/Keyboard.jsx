import { midiInfo } from "../lib/music.js";

export function Keyboard({ baseOct, target, matched, sung, onKey }) {
  const c = 12 * (baseOct + 1);
  const whites = [0, 2, 4, 5, 7, 9, 11, 12].map((s) => c + s);
  const blacks = [
    [1, 0],
    [3, 1],
    [6, 3],
    [8, 4],
    [10, 5],
  ].map(([s, after]) => ({ m: c + s, after }));
  const ww = 100 / whites.length;
  const state = (m) =>
    (m === target ? (matched ? " k-hit" : " k-target") : "") +
    (m === sung ? " k-sung" : "");
  return (
    <div className="keys" role="group" aria-label="Piano keyboard">
      {whites.map((m, i) => {
        const info = midiInfo(m);
        return (
          <button
            key={m}
            className={"wkey" + state(m)}
            style={{ left: i * ww + "%", width: ww + "%" }}
            onClick={() => onKey(m)}
            aria-label={"Play " + info.label}
          >
            <span className="mono">
              {info.letter === "C" ? info.label : info.letter}
            </span>
          </button>
        );
      })}
      {blacks.map(({ m, after }) => (
        <button
          key={m}
          className={"bkey" + state(m)}
          style={{
            left: (after + 1) * ww - ww * 0.31 + "%",
            width: ww * 0.62 + "%",
          }}
          onClick={() => onKey(m)}
          aria-label={"Play " + midiInfo(m).label}
        />
      ))}
    </div>
  );
}

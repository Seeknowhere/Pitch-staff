// Live karaoke battles between two phones, over Supabase Realtime.
// No database tables: each battle is a broadcast channel named after its room code.
// Only names, song length and line scores travel between phones, never audio.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://hfppyeopomuggsdqtuuz.supabase.co";
// publishable key: safe to ship in the app (it can't read or write any tables)
const SUPABASE_KEY = "sb_publishable_BVcu6fPk2CDYsTLw5-qxgw_fpUBV5-7";

let client = null;
const sb = () => client || (client = createClient(SUPABASE_URL, SUPABASE_KEY));

export const makeCode = () => String(1000 + Math.floor(Math.random() * 9000));

// Join room `code` as `me` ({ name, dur, host }).
// handlers: onPeer(peer | null), onMessage(msg), onStatus("connecting" | "connected" | "error")
// Returns { send(msg), leave() }.
export function joinRoom(code, me, { onPeer, onMessage, onStatus }) {
  const id = Math.random().toString(36).slice(2);
  const ch = sb().channel("tono-battle-" + code, {
    config: { broadcast: { self: false }, presence: { key: id } },
  });
  ch.on("presence", { event: "sync" }, () => {
    const state = ch.presenceState();
    const others = Object.keys(state)
      .filter((k) => k !== id)
      .map((k) => state[k][0]);
    onPeer(others[0] || null);
  });
  ch.on("broadcast", { event: "msg" }, ({ payload }) => onMessage(payload));
  onStatus("connecting");
  ch.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      await ch.track(me);
      onStatus("connected");
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") onStatus("error");
  });
  return {
    send: (msg) => ch.send({ type: "broadcast", event: "msg", payload: msg }),
    leave: () => {
      ch.untrack();
      sb().removeChannel(ch);
    },
  };
}

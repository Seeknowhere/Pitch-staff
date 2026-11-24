// The battle album: battles both singers chose to keep, saved on this device (IndexedDB).
// Each entry holds the result, both singers' candid photos and the battle remix as finished
// audio (music + both voices), so it plays later even without the song.
const DB = "tono-album",
  STORE = "battles",
  CHANGED = "tono-album";

let dbp = null;
function db() {
  if (!dbp)
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () =>
        r.result.createObjectStore(STORE, { keyPath: "id" });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  return dbp;
}
const req = (r) =>
  new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
const store = async (mode) =>
  (await db()).transaction(STORE, mode).objectStore(STORE);
const changed = () => window.dispatchEvent(new Event(CHANGED));

// entry: { id, at, myName, rival, song, result (1 won, -1 lost, 0 draw), you, opp (lines won),
//          myAvg, theirAvg, myPerfect, theirPerfect, myCombo, theirCombo,
//          myPhotos: [Blob], theirPhotos: [Blob], remix: Blob | null, remixDur, remixSegs: [{ from, to, who }] }
export async function saveBattle(entry) {
  await req((await store("readwrite")).put(entry));
  if (navigator.storage && navigator.storage.persist)
    navigator.storage.persist().catch(() => {});
  changed();
}

// newest first
export async function listBattles() {
  const all = await req((await store("readonly")).getAll());
  return all.sort((a, b) => b.at - a.at);
}

export async function removeBattle(id) {
  await req((await store("readwrite")).delete(id));
  changed();
}

export const onAlbumChanged = (fn) => {
  window.addEventListener(CHANGED, fn);
  return () => window.removeEventListener(CHANGED, fn);
};

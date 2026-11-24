// "My songs": every song you load (uploads and songs Tono split) is kept on this device, in
// IndexedDB, so you can load it again with one tap. Lyrics and music timing are already saved
// per song elsewhere and come back by themselves. Sample songs and songs a battle partner sent
// you aren't kept here.
const DB = "tono-songs",
  STORE = "songs",
  CHANGED = "tono-songs";

let dbp = null;
function db() {
  if (!dbp)
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        const st = r.result.createObjectStore(STORE, { keyPath: "id" });
        st.createIndex("src", "src");
      };
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

// identifies a file: same name, size and date means same file
export const fileKey = (f) => [f.name, f.size, f.lastModified || 0].join("|");

// newest-used first: { id, title, vocal: File, music: File | null, src, split, size, addedAt, usedAt }
export async function listSongs() {
  const all = await req((await store("readonly")).getAll());
  return all.sort((a, b) => b.usedAt - a.usedAt);
}

let askedToKeep = false;
// add or update a song; src = the original file's key when Tono split it
export async function saveSong({ id, title, vocal, music, src }) {
  const st = await store("readwrite");
  const old = await req(st.get(id));
  const now = Date.now();
  const m = music || (old && old.music) || null;
  await req(
    (await store("readwrite")).put({
      id,
      title,
      vocal,
      music: m,
      src: src || (old && old.src) || null,
      split: !!(src || (old && old.split)),
      size: vocal.size + (m ? m.size : 0),
      addedAt: (old && old.addedAt) || now,
      usedAt: now,
    }),
  );
  // ask the browser not to clear the library when space runs low (it may say no)
  if (!askedToKeep && navigator.storage && navigator.storage.persist) {
    askedToKeep = true;
    navigator.storage.persist().catch(() => {});
  }
  changed();
}

// a song Tono split from this exact file before, or null
export async function findSplit(file) {
  const hit = await req(
    (await store("readonly")).index("src").get(fileKey(file)),
  );
  return hit || null;
}

export async function touchSong(id) {
  const st = await store("readwrite");
  const rec = await req(st.get(id));
  if (rec)
    await req((await store("readwrite")).put({ ...rec, usedAt: Date.now() }));
  changed();
}

export async function removeSong(id) {
  await req((await store("readwrite")).delete(id));
  changed();
}

export const onSongsChanged = (fn) => {
  window.addEventListener(CHANGED, fn);
  return () => window.removeEventListener(CHANGED, fn);
};

// Remembers songs Tono has already split, on this device (IndexedDB), so splitting the same
// file again is instant. A song is recognised by its file name, size and last-modified time.
// Split songs are big (two WAVs, ~35 MB each for a 3-4 minute song), so only the most recent
// few are kept.
const DB = "tono-splits",
  STORE = "songs",
  KEEP = 5;

let dbp = null;
function db() {
  if (!dbp)
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "key" });
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

const keyOf = (file) => [file.name, file.size, file.lastModified || 0].join("|");

// { vocal: File, music: File } for a file split before, or null
export async function getSplit(file) {
  const d = await db();
  const rec = await req(d.transaction(STORE).objectStore(STORE).get(keyOf(file)));
  if (!rec) return null;
  // mark it as just used, so it's the last to go
  d.transaction(STORE, "readwrite").objectStore(STORE).put({ ...rec, at: Date.now() });
  return { vocal: rec.vocal, music: rec.music };
}

export async function putSplit(file, vocal, music) {
  const d = await db();
  await req(
    d.transaction(STORE, "readwrite").objectStore(STORE).put({ key: keyOf(file), vocal, music, at: Date.now() }),
  );
  // keep only the most recently used few
  const all = await req(d.transaction(STORE).objectStore(STORE).getAll());
  const old = all.sort((a, b) => b.at - a.at).slice(KEEP);
  if (old.length) {
    const st = d.transaction(STORE, "readwrite").objectStore(STORE);
    old.forEach((r) => st.delete(r.key));
  }
}

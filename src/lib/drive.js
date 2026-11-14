// Sample songs from the shared Google Drive folder.
export const DRIVE_FOLDER = "1wPR3_B8Yn-fawCBnQD8wFt5JiKZFa_vK"; // Tono > Songs (shared: anyone with the link can view)

export const DRIVE_KEY = "AIzaSyBxpIBmELpY8JDFsYggMuZU_eROl4KYRrI"; // restricted to seeknowhere.github.io and the Drive API

const DRIVE_API = "https://www.googleapis.com/drive/v3/files";

export async function driveList(parent) {
  const q = encodeURIComponent(
    "'" + parent + "' in parents and trashed = false",
  );
  const r = await fetch(
    DRIVE_API +
      "?q=" +
      q +
      "&fields=files(id,name,mimeType,size,modifiedTime)&orderBy=name&pageSize=200&key=" +
      DRIVE_KEY,
  );
  if (!r.ok) throw new Error("list " + r.status);
  return (await r.json()).files || [];
}

export async function driveFile(f) {
  const url = DRIVE_API + "/" + f.id + "?alt=media&key=" + DRIVE_KEY;
  const cacheKey =
    "https://tono.cache/" + f.id + "/" + (f.modifiedTime || "");
  let cache = null;
  try {
    cache = window.caches ? await caches.open("tono-songs-v1") : null;
  } catch (e) {
    cache = null;
  }
  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) return await hit.blob();
    } catch (e) {}
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error("file " + r.status);
  const blob = await r.blob();
  if (cache) {
    try {
      await cache.put(cacheKey, new Response(blob));
    } catch (e) {}
  }
  return blob;
}

export function sortSongFiles(files) {
  const lrc = files.find((f) => /\.lrc$/i.test(f.name));
  const audio = files.filter(
    (f) =>
      /^audio\//.test(f.mimeType || "") ||
      /\.(mp3|m4a|wav|aac|ogg|flac)$/i.test(f.name),
  );
  let vocal = audio.find((f) =>
    /vocal|acapella|a ?cappella|voice/i.test(f.name),
  );
  let inst = audio.find(
    (f) =>
      f !== vocal &&
      /instrument|karaoke|minus ?one|backing|accomp|no ?vocal/i.test(f.name),
  );
  if (!vocal) vocal = audio.find((f) => f !== inst);
  if (!inst) inst = audio.find((f) => f !== vocal);
  return { vocal, inst, lrc };
}

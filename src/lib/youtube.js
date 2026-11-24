// YouTube for karaoke: searching karaoke videos (YouTube Data API) and playing them in YouTube's
// own embedded player. Tono never touches the video's audio, which YouTube doesn't allow.

// a browser key from Google Cloud, locked to this site's address there; empty = search is off,
// pasting a YouTube link still works
export const YT_KEY = "";

// the free plan allows 100 searches a day for the whole app, so results are remembered for a day
const CACHE = "tono.yt.search.v1",
  DAY = 864e5;

export const canSearch = () => !!YT_KEY;

// a video id from a YouTube link (watch, youtu.be, shorts, embed) or a bare id
export function youTubeId(s) {
  const t = (s || "").trim();
  if (/^[\w-]{11}$/.test(t)) return t;
  const m = t.match(
    /(?:youtu\.be\/|v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/,
  );
  return m ? m[1] : null;
}

// [{ id, title, channel, thumb }]
export async function searchKaraoke(query) {
  const q = query.trim().toLowerCase();
  if (!q || !YT_KEY) return [];
  let cache = {};
  try {
    cache = JSON.parse(localStorage.getItem(CACHE) || "{}");
  } catch (e) {}
  const hit = cache[q];
  if (hit && Date.now() - hit.at < DAY) return hit.items;
  const url =
    "https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=12&q=" +
    encodeURIComponent(q + " karaoke") +
    "&key=" +
    YT_KEY;
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.status === 403 ? "quota" : "search");
  const j = await r.json();
  const items = (j.items || []).map((it) => ({
    id: it.id.videoId,
    title: decode(it.snippet.title),
    channel: decode(it.snippet.channelTitle),
    thumb: (it.snippet.thumbnails.medium || it.snippet.thumbnails.default || {})
      .url,
  }));
  // keep the cache small: the 30 most recent searches
  cache[q] = { at: Date.now(), items };
  const keys = Object.keys(cache).sort((a, b) => cache[b].at - cache[a].at);
  keys.slice(30).forEach((k) => delete cache[k]);
  try {
    localStorage.setItem(CACHE, JSON.stringify(cache));
  } catch (e) {}
  return items;
}

// YouTube titles come HTML-escaped ("Don&#39;t")
function decode(s) {
  const d = document.createElement("textarea");
  d.innerHTML = s || "";
  return d.value;
}

let ytReady = null;
// loads YouTube's player script once; resolves with window.YT
export function loadYouTube() {
  if (ytReady) return ytReady;
  ytReady = new Promise((res, rej) => {
    if (window.YT && window.YT.Player) return res(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (prev) prev();
      res(window.YT);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => {
      ytReady = null;
      rej(new Error("YouTube couldn't load"));
    };
    document.head.appendChild(s);
  });
  return ytReady;
}

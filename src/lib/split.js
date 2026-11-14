// Uses the MDX-Net karaoke model from the Ultimate Vocal Remover project, run with ONNX Runtime
// in a worker (graphics chip via WebGPU when the browser allows, otherwise the CPU).
const SEP_BASE = "sep/",
  SEP_MODEL = "UVR_MDXNET_KARA_2.onnx",
  SEP_MODEL_BYTES = 52786726;

let sepCheck = null;

export function canSplitSongs() {
  if (!sepCheck)
    sepCheck =
      /^https?:$/.test(location.protocol) && typeof Worker !== "undefined"
        ? fetch(SEP_BASE + "sep-worker.js", { method: "HEAD" })
            .then((r) => r.ok)
            .catch(() => false)
        : Promise.resolve(false);
  return sepCheck;
}

let gpuCheck = null;

export function hasWebGPU() {
  if (!gpuCheck)
    gpuCheck = (async () => {
      try {
        return !!(navigator.gpu && (await navigator.gpu.requestAdapter()));
      } catch (e) {
        return false;
      }
    })();
  return gpuCheck;
}

async function sepModel(onBytes) {
  const url = SEP_BASE + SEP_MODEL;
  let cache = null;
  try {
    cache = await caches.open("tono-models-v1");
    const hit = await cache.match(url);
    if (hit) return await hit.arrayBuffer();
  } catch (e) {
    cache = null;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error("Couldn't download the splitting model.");
  const total = +res.headers.get("content-length") || SEP_MODEL_BYTES,
    rd = res.body.getReader(),
    parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    onBytes(got, total);
  }
  const out = new Uint8Array(got);
  let o = 0;
  parts.forEach((p) => {
    out.set(p, o);
    o += p.length;
  });
  if (cache)
    cache
      .put(
        url,
        new Response(out.slice(0), {
          headers: { "content-type": "application/octet-stream" },
        }),
      )
      .catch(() => {});
  return out.buffer;
}

const splitter = { worker: null, cancel: null };

// returns { vocals: [L, R], inst: [L, R], sr }
export async function splitSong(file, onStage) {
  const Ctx = window.AudioContext || window.webkitAudioContext,
    ctx = new Ctx({ sampleRate: 44100 });
  let audio;
  try {
    audio = await ctx.decodeAudioData(await file.arrayBuffer());
  } finally {
    if (ctx.close) ctx.close().catch(() => {});
  }
  const gpu = await hasWebGPU();
  const model = await sepModel((got, total) =>
    onStage({ stage: "model", p: got / total }),
  );
  if (splitter.worker) splitter.worker.terminate();
  const w = (splitter.worker = new Worker(SEP_BASE + "sep-worker.js"));
  const call = (msg, transfer) =>
    new Promise((resolve, reject) => {
      splitter.cancel = () => reject(new Error("cancelled"));
      w.onmessage = (e) => {
        const m = e.data;
        if (m.type === "progress") onStage({ stage: "split", p: m.p });
        else if (m.type === "error") reject(new Error(m.text));
        else if (m.type !== "log") resolve(m);
      };
      w.onerror = () =>
        reject(new Error("The splitter stopped unexpectedly."));
      w.postMessage(msg, transfer || []);
    });
  try {
    onStage({ stage: "start", p: 0 });
    const r = await call({ type: "load", model, cpuOnly: !gpu }, [model]);
    onStage({ stage: "split", p: 0, backend: r.backend });
    const L = audio.getChannelData(0).slice(),
      R = (
        audio.numberOfChannels > 1
          ? audio.getChannelData(1)
          : audio.getChannelData(0)
      ).slice();
    const d = await call({ type: "run", L, R }, [L.buffer, R.buffer]);
    return {
      vocals: [d.bufs[0], d.bufs[1]],
      inst: [d.bufs[2], d.bufs[3]],
      sr: 44100,
    };
  } finally {
    w.terminate();
    if (splitter.worker === w) splitter.worker = null;
    splitter.cancel = null;
  }
}

export function cancelSplit() {
  if (splitter.worker) splitter.worker.terminate();
  splitter.worker = null;
  if (splitter.cancel) splitter.cancel();
}

export function wavFile(chs, sr, name) {
  const n = chs[0].length,
    b = new ArrayBuffer(44 + n * 4),
    v = new DataView(b);
  const w = (o, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  w(0, "RIFF");
  v.setUint32(4, 36 + n * 4, true);
  w(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, n * 4, true);
  const a = chs[0],
    c = chs[1];
  for (let i = 0, o = 44; i < n; i++, o += 4) {
    v.setInt16(o, Math.max(-1, Math.min(1, a[i])) * 32767, true);
    v.setInt16(o + 2, Math.max(-1, Math.min(1, c[i])) * 32767, true);
  }
  return new File([b], name, { type: "audio/wav" });
}

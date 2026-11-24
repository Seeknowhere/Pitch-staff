// Runs the split off the main thread so the page stays responsive.
importScripts("ort/ort.webgpu.min.js", "mdx.js");
ort.env.wasm.wasmPaths = new URL("ort/", self.location).href;
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(8, navigator.hardwareConcurrency || 4)) : 1;
let session = null, backend = null;
self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === "load") {
      const eps = m.cpuOnly ? ["wasm"] : ["webgpu", "wasm"];
      for (const ep of eps) {
        try { session = await ort.InferenceSession.create(m.model, { executionProviders: [ep] }); backend = ep; break; }
        catch (err) { self.postMessage({ type: "log", text: ep + " failed: " + err.message }); }
      }
      if (!session) throw new Error("Couldn't start the AI model in this browser.");
      self.postMessage({ type: "ready", backend, threads: ort.env.wasm.numThreads, isolated: self.crossOriginIsolated });
    } else if (m.type === "run") {
      const r = await MDX.separate(ort, session, MDX.MODELS.UVR_MDXNET_KARA_2, m.L, m.R, (p) => self.postMessage({ type: "progress", p }));
      const bufs = [r.vocals[0], r.vocals[1], r.inst[0], r.inst[1]].map((a) => a.slice());
      self.postMessage({ type: "done", bufs }, bufs.map((a) => a.buffer));
    }
  } catch (err) { self.postMessage({ type: "error", text: err.message }); }
};

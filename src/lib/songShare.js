// Sharing a song with a battle partner: the song's files go across in chunks over the battle's
// realtime channel and are only kept in memory on the other phone, for that battle.
// Supabase's free plan allows 256 KB per message and 100 messages a second; 160 KB chunks
// (about 214 KB once base64'd) sent ~8 a second stay well inside both.
import { decodeFile } from "./analysis.js";

export const CHUNK = 160 * 1024;
export const CHUNK_GAP_MS = 120;
// uncompressed WAVs bigger than this (e.g. songs Tono split itself) get shrunk before sending
const SHRINK_OVER = 8 * 1024 * 1024;
const SHRINK_SR = 22050;

const isWav = (f) => /\.wav$/i.test(f.name) || /wav/i.test(f.type || "");

// the bytes to send for a file: as-is, or a smaller mono 22 kHz WAV for big WAVs
export async function packFile(file) {
  if (!(isWav(file) && file.size > SHRINK_OVER))
    return { name: file.name, type: file.type || "", bytes: new Uint8Array(await file.arrayBuffer()) };
  const buf = await decodeFile(file);
  const len = Math.ceil(buf.duration * SHRINK_SR);
  const off = new OfflineAudioContext(1, len, SHRINK_SR);
  const src = off.createBufferSource();
  src.buffer = buf; // more than one channel is mixed down to mono by the 1-channel context
  src.connect(off.destination);
  src.start();
  const out = await off.startRendering();
  return { name: file.name, type: "audio/wav", bytes: monoWav(out.getChannelData(0), SHRINK_SR) };
}

// 16-bit mono PCM WAV
function monoWav(x, sr) {
  const b = new ArrayBuffer(44 + x.length * 2),
    v = new DataView(b);
  const w = (o, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  w(0, "RIFF");
  v.setUint32(4, 36 + x.length * 2, true);
  w(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, x.length * 2, true);
  for (let i = 0; i < x.length; i++) {
    const s = Math.max(-1, Math.min(1, x[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(b);
}

export function toB64(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000)
    s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(s) {
  const bin = atob(s),
    u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

export const chunkCount = (n) => Math.max(1, Math.ceil(n / CHUNK));

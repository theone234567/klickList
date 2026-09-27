// On-device photo processing. All free: no AI tokens and no server work.
import { cropRect, fitWithin, levelsLut } from "./imageMath";
import type { Crop } from "./types";

export const MAIN_EDGE = 2048; // stored photo (good for Trade Me)
export const THUMB_EDGE = 400; // grid thumbnails

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas not supported");
  return ctx;
}

function toJpeg(c: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode photo"))), "image/jpeg", quality),
  );
}

async function decode(source: Blob): Promise<ImageBitmap> {
  // Honour the phone's EXIF rotation so photos are the right way up.
  return createImageBitmap(source, { imageOrientation: "from-image" });
}

/** Auto brightness/contrast/white balance, in place. */
function autoEnhance(c: HTMLCanvasElement): void {
  const ctx = ctx2d(c);
  // histogram from a small copy (fast)
  const small = fitWithin(c.width, c.height, 256);
  const s = canvas(small.w, small.h);
  ctx2d(s).drawImage(c, 0, 0, small.w, small.h);
  const sd = ctx2d(s).getImageData(0, 0, small.w, small.h).data;
  const hr = new Uint32Array(256), hg = new Uint32Array(256), hb = new Uint32Array(256);
  for (let i = 0; i < sd.length; i += 4) { hr[sd[i]]++; hg[sd[i + 1]]++; hb[sd[i + 2]]++; }
  const total = small.w * small.h;
  const lr = levelsLut(hr, total), lg = levelsLut(hg, total), lb = levelsLut(hb, total);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = lr[d[i]]; d[i + 1] = lg[d[i + 1]]; d[i + 2] = lb[d[i + 2]]; }
  ctx.putImageData(img, 0, 0);
}

export interface Processed { main: Blob; thumb: Blob; width: number; height: number }

// ---- background worker (keeps the camera smooth); falls back to the main thread if unsupported ----
let worker: Worker | null | undefined;
let jobId = 0;
const jobs = new Map<number, { resolve: (p: Processed) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    if (typeof OffscreenCanvas === "undefined" || !("convertToBlob" in OffscreenCanvas.prototype)) throw new Error("no OffscreenCanvas");
    worker = new Worker(new URL("./photoWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<Processed & { id: number; error?: string }>) => {
      const job = jobs.get(e.data.id);
      if (!job) return;
      jobs.delete(e.data.id);
      if (e.data.error) job.reject(new Error(e.data.error));
      else job.resolve({ main: e.data.main, thumb: e.data.thumb, width: e.data.width, height: e.data.height });
    };
    worker.onerror = () => { worker = null; for (const j of jobs.values()) j.reject(new Error("Photo worker stopped")); jobs.clear(); };
  } catch {
    worker = null;
  }
  return worker;
}

async function processOnMainThread(bmp: ImageBitmap, enhance: boolean): Promise<Processed> {
  const size = fitWithin(bmp.width, bmp.height, MAIN_EDGE);
  const c = canvas(size.w, size.h);
  const ctx = ctx2d(c);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, size.w, size.h);
  bmp.close();
  if (enhance) autoEnhance(c);
  const main = await toJpeg(c, 0.85);
  const t = fitWithin(size.w, size.h, THUMB_EDGE);
  const tc = canvas(t.w, t.h);
  ctx2d(tc).drawImage(c, 0, 0, t.w, t.h);
  const thumb = await toJpeg(tc, 0.7);
  return { main, thumb, width: size.w, height: size.h };
}

/** Resize, straighten orientation, tidy colours, compress. Accepts a file or a camera frame. */
export async function processPhoto(source: Blob | ImageBitmap, enhance = true): Promise<Processed> {
  const bmp = source instanceof Blob ? await decode(source) : source;
  const w = getWorker();
  if (!w) return processOnMainThread(bmp, enhance);
  const id = ++jobId;
  return new Promise<Processed>((resolve, reject) => {
    jobs.set(id, { resolve, reject });
    w.postMessage({ id, bitmap: bmp, enhance, mainEdge: MAIN_EDGE, thumbEdge: THUMB_EDGE }, [bmp]);
  });
}

/** Tiny preview for the capture strip (fast). */
export function previewUrl(bmp: ImageBitmap): Promise<string> {
  const s = fitWithin(bmp.width, bmp.height, 160);
  const c = canvas(s.w, s.h);
  ctx2d(c).drawImage(bmp, 0, 0, s.w, s.h);
  return toJpeg(c, 0.6).then((b) => URL.createObjectURL(b));
}

/**
 * One small JPEG with the item's photos side by side (each fitted to 640x480). Sending one
 * combined image instead of several separate ones cuts the AI's image tokens by roughly 30-60%.
 */
export async function stitchForAi(sources: Blob[]): Promise<Blob> {
  const bmps = await Promise.all(sources.slice(0, 2).map(decode));
  const cells = bmps.map((b) => fitWithin(b.width, b.height, 640)).map((s, i) => {
    const h = Math.min(s.h, 480);
    return { w: Math.round((bmps[i].width / bmps[i].height) * h), h };
  });
  const H = Math.max(...cells.map((c) => c.h));
  const c = canvas(cells.reduce((n, x) => n + x.w, 0) + (cells.length - 1) * 8, H);
  const ctx = ctx2d(c);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  let x = 0;
  bmps.forEach((b, i) => {
    ctx.drawImage(b, x, Math.round((H - cells[i].h) / 2), cells[i].w, cells[i].h);
    x += cells[i].w + 8;
    b.close();
  });
  return toJpeg(c, 0.72);
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Final photo for Trade Me with the chosen crop and rotation applied. */
export async function renderFinal(source: Blob, rotation: number, crop: Crop | null): Promise<Blob> {
  const bmp = await decode(source);
  const r = cropRect(bmp.width, bmp.height, crop);
  const swap = rotation === 90 || rotation === 270;
  const c = canvas(swap ? r.sh : r.sw, swap ? r.sw : r.sh);
  const ctx = ctx2d(c);
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(bmp, r.sx, r.sy, r.sw, r.sh, -r.sw / 2, -r.sh / 2, r.sw, r.sh);
  bmp.close();
  return toJpeg(c, 0.9);
}

/** Try to read a barcode on-device (Chrome/Android). Free, and helps the AI identify DVDs/books. */
export async function readBarcode(source: Blob): Promise<string> {
  const BD = (globalThis as unknown as { BarcodeDetector?: new (o: object) => { detect(i: ImageBitmap): Promise<{ rawValue: string }[]> } }).BarcodeDetector;
  if (!BD) return "";
  try {
    const bmp = await decode(source);
    const found = await new BD({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"] }).detect(bmp);
    bmp.close();
    const v = found[0]?.rawValue ?? "";
    return /^[0-9A-Za-z-]{4,32}$/.test(v) ? v : "";
  } catch {
    return "";
  }
}

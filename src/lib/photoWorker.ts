// Runs off the main thread so the camera and buttons stay responsive while photos are tidied.
import { fitWithin, levelsLut } from "./imageMath";

interface Job { id: number; bitmap: ImageBitmap; enhance: boolean; mainEdge: number; thumbEdge: number }

function ctx2d(c: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas not supported");
  return ctx;
}

function autoEnhance(c: OffscreenCanvas): void {
  const ctx = ctx2d(c);
  const small = fitWithin(c.width, c.height, 256);
  const s = new OffscreenCanvas(small.w, small.h);
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

self.onmessage = async (e: MessageEvent<Job>) => {
  const { id, bitmap, enhance, mainEdge, thumbEdge } = e.data;
  try {
    const size = fitWithin(bitmap.width, bitmap.height, mainEdge);
    const c = new OffscreenCanvas(size.w, size.h);
    const ctx = ctx2d(c);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, size.w, size.h);
    bitmap.close();
    if (enhance) autoEnhance(c);
    const main = await c.convertToBlob({ type: "image/jpeg", quality: 0.85 });
    const t = fitWithin(size.w, size.h, thumbEdge);
    const tc = new OffscreenCanvas(t.w, t.h);
    ctx2d(tc).drawImage(c, 0, 0, t.w, t.h);
    const thumb = await tc.convertToBlob({ type: "image/jpeg", quality: 0.7 });
    self.postMessage({ id, main, thumb, width: size.w, height: size.h });
  } catch (err) {
    self.postMessage({ id, error: (err as Error).message || "Photo processing failed" });
  }
};

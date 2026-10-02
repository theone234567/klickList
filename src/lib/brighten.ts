// "Brighten background": for items photographed on plain white/light card or a sheet.
// Only the background is changed (pushed to pure white). The item itself is NEVER changed:
//  * the background is the light, plain area connected to the photo's edges (flood fill from the border,
//    stopped by the item's outline), so white parts *inside* the item (labels, discs) are never touched;
//  * near the outline, a pixel is only whitened if it also looks like the card itself;
//  * if the background isn't plain and light enough, nothing is changed at all.
// Pure functions on RGBA arrays so they can be tested; the canvas wrapper is at the bottom.

export interface BgModel { rn: number; gn: number; lum: number; sat: number }
export type BrightenPlan =
  | { ok: true; bg: BgModel; region: Uint8Array; w: number; h: number; coverage: number }
  | { ok: false; reason: "dark" | "busy" | "no-item" };

const lumOf = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

/** 0..1: how much this pixel looks like the card (same tint, not more colourful, light - shadows allowed). */
export function cardLikeness(r: number, g: number, b: number, bg: BgModel): number {
  const sum = r + g + b + 1;
  const chroma = Math.abs(r / sum - bg.rn) + Math.abs(g / sum - bg.gn);
  const sat = Math.max(r, g, b) - Math.min(r, g, b);
  const c = 1 - smooth(0.02, 0.05, chroma);
  const s = 1 - smooth(bg.sat + 12, bg.sat + 30, sat);
  const l = smooth(bg.lum * 0.5, bg.lum * 0.7, lumOf(r, g, b));
  return c * s * l;
}

/** Work out the background on a small copy of the photo (about 640 px). */
export function planBrighten(px: Uint8ClampedArray, w: number, h: number): BrightenPlan {
  const n = w * h;
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.03));
  const border: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < band || y < band || x >= w - band || y >= h - band) border.push(y * w + x);
    }
  }
  const at = (i: number) => [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]] as const;
  const bg: BgModel = {
    rn: median(border.map((i) => { const [r, g, b] = at(i); return r / (r + g + b + 1); })),
    gn: median(border.map((i) => { const [r, g, b] = at(i); return g / (r + g + b + 1); })),
    lum: median(border.map((i) => lumOf(...at(i)))),
    sat: median(border.map((i) => { const [r, g, b] = at(i); return Math.max(r, g, b) - Math.min(r, g, b); })),
  };
  if (bg.lum < 120) return { ok: false, reason: "dark" };

  const like = new Float32Array(n);
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = at(i);
    like[i] = cardLikeness(r, g, b, bg);
    lum[i] = lumOf(r, g, b);
  }
  const plainBorder = border.filter((i) => like[i] > 0.5).length / border.length;
  if (plainBorder < 0.85) return { ok: false, reason: "busy" };

  // Edge strength: the item's outline stops the flood fill even where the item is pale.
  const edge = (i: number) => {
    const x = i % w, y = (i - x) / w;
    const l = lum[i];
    const dx = x + 1 < w ? Math.abs(lum[i + 1] - l) : 0;
    const dy = y + 1 < h ? Math.abs(lum[i + w] - l) : 0;
    return dx + dy;
  };
  const region = new Uint8Array(n);
  const stack: number[] = [];
  for (const i of border) if (like[i] > 0.5 && edge(i) < 24) { region[i] = 1; stack.push(i); }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    for (const j of [x > 0 ? i - 1 : -1, x + 1 < w ? i + 1 : -1, i - w, i + w]) {
      if (j < 0 || j >= n || region[j]) continue;
      if (like[j] > 0.5 && edge(j) < 24 && Math.abs(lum[j] - lum[i]) < 12) { region[j] = 1; stack.push(j); }
    }
  }
  // Pull back one pixel from the item so whitening never reaches its edge.
  const eroded = new Uint8Array(n);
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (!region[i]) continue;
    const x = i % w;
    const keep = (x === 0 || region[i - 1]) && (x === w - 1 || region[i + 1])
      && (i < w || region[i - w]) && (i >= n - w || region[i + w]);
    if (keep) { eroded[i] = 1; count++; }
  }
  const coverage = count / n;
  if (coverage > 0.985) return { ok: false, reason: "no-item" };
  if (coverage < 0.1) return { ok: false, reason: "busy" };
  return { ok: true, bg, region: eroded, w, h, coverage };
}

/**
 * Whiten the background of the full-size photo in place. `regionAlpha` is the plan's region scaled up to
 * full size (0..255). Pixels outside the region are left byte-for-byte unchanged.
 */
export function applyBrighten(px: Uint8ClampedArray, regionAlpha: Uint8ClampedArray, bg: BgModel): number {
  let changed = 0;
  for (let i = 0; i < px.length; i += 4) {
    const a = regionAlpha[i + 3];
    if (a === 0) continue;
    const k = (a / 255) * cardLikeness(px[i], px[i + 1], px[i + 2], bg);
    if (k <= 0.004) continue;
    px[i] += (255 - px[i]) * k;
    px[i + 1] += (255 - px[i + 1]) * k;
    px[i + 2] += (255 - px[i + 2]) * k;
    changed++;
  }
  return changed;
}

// ---------- canvas wrapper ----------

export interface WhiteResult { main: Blob; thumb: Blob; width: number; height: number }
export type BrightenOutcome = WhiteResult | { failed: "dark" | "busy" | "no-item" };

export async function brightenBackground(source: Blob, thumbEdge = 400): Promise<BrightenOutcome> {
  const bmp = await createImageBitmap(source, { imageOrientation: "from-image" });
  try {
    const W = bmp.width, H = bmp.height;
    const scale = Math.min(1, 640 / Math.max(W, H));
    const w = Math.max(1, Math.round(W * scale)), h = Math.max(1, Math.round(H * scale));
    const small = new OffscreenCanvas(w, h);
    const sctx = small.getContext("2d", { willReadFrequently: true })!;
    sctx.drawImage(bmp, 0, 0, w, h);
    const plan = planBrighten(sctx.getImageData(0, 0, w, h).data, w, h);
    if (!plan.ok) return { failed: plan.reason };

    // Region mask scaled up smoothly to full size.
    const mask = sctx.createImageData(w, h);
    for (let i = 0; i < plan.region.length; i++) mask.data[i * 4 + 3] = plan.region[i] ? 255 : 0;
    sctx.putImageData(mask, 0, 0);
    const full = new OffscreenCanvas(W, H);
    const fctx = full.getContext("2d", { willReadFrequently: true })!;
    fctx.imageSmoothingQuality = "high";
    fctx.drawImage(small, 0, 0, W, H);
    const regionAlpha = fctx.getImageData(0, 0, W, H).data;
    fctx.clearRect(0, 0, W, H);
    fctx.drawImage(bmp, 0, 0);
    const img = fctx.getImageData(0, 0, W, H);
    applyBrighten(img.data, regionAlpha, plan.bg);
    fctx.putImageData(img, 0, 0);

    const main = await full.convertToBlob({ type: "image/jpeg", quality: 0.92 });
    const ts = Math.min(1, thumbEdge / Math.max(W, H));
    const t = new OffscreenCanvas(Math.round(W * ts), Math.round(H * ts));
    t.getContext("2d")!.drawImage(full, 0, 0, t.width, t.height);
    return { main, thumb: await t.convertToBlob({ type: "image/jpeg", quality: 0.75 }), width: W, height: H };
  } finally {
    bmp.close();
  }
}

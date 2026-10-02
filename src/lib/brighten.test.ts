import { describe, expect, it } from "vitest";
import { applyBrighten, planBrighten } from "./brighten";

const W = 120, H = 90;
/** A DVD-like item (dark blue box with a white label) on light grey card with a soft shadow and lighting falloff. */
function scene(bgAt?: (x: number, y: number) => [number, number, number]) {
  const px = new Uint8ClampedArray(W * H * 4);
  const isItem = (x: number, y: number) => x >= 40 && x < 80 && y >= 20 && y < 70;
  const isLabel = (x: number, y: number) => x >= 50 && x < 70 && y >= 30 && y < 40;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    let c: [number, number, number];
    if (isLabel(x, y)) c = [235, 235, 232];
    else if (isItem(x, y)) c = [30, 60, 140];
    else if (bgAt) c = bgAt(x, y);
    else {
      const fall = 215 - Math.round(Math.abs(x - W / 2) / 3); // lighting falloff
      // soft shadow fading out to the right of the item
      const shadow = x >= 80 && x < 88 && y >= 24 && y < 72 ? Math.round(40 * (1 - (x - 80) / 8)) : 0;
      c = [fall - shadow, fall - shadow, fall - 2 - shadow];
    }
    px.set([...c, 255], i);
  }
  return { px, isItem };
}
const alphaFrom = (region: Uint8Array) => {
  const a = new Uint8ClampedArray(region.length * 4);
  region.forEach((v, i) => { a[i * 4 + 3] = v ? 255 : 0; });
  return a;
};

describe("brighten background", () => {
  it("whitens the card and shadow but never changes the item or its white label", () => {
    const { px, isItem } = scene();
    const before = px.slice();
    const plan = planBrighten(px, W, H);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    applyBrighten(px, alphaFrom(plan.region), plan.bg);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (isItem(x, y)) expect([...px.slice(i, i + 3)]).toEqual([...before.slice(i, i + 3)]);
    }
    const corner = 0, shadow = (50 * W + 83) * 4;
    expect(px[corner]).toBeGreaterThan(250);
    expect(px[shadow]).toBeGreaterThan(245);
  });
  it("leaves busy (colourful) backgrounds alone", () => {
    const { px } = scene((x, y) => [(x * 37) % 255, (y * 53) % 255, ((x + y) * 29) % 255]);
    expect(planBrighten(px, W, H)).toEqual({ ok: false, reason: expect.stringMatching(/busy|dark/) });
  });
  it("leaves dark backgrounds alone", () => {
    const { px } = scene(() => [60, 55, 50]);
    expect(planBrighten(px, W, H)).toEqual({ ok: false, reason: "dark" });
  });
});

import { describe, expect, it } from "vitest";
import { cropRect, fitWithin, levelsLut, percentile } from "./imageMath";
import { isEmail, normalizePhone } from "./phone";
import { csvCell } from "./csv";
import { parseRoute } from "./router";

describe("imageMath", () => {
  it("finds percentiles", () => {
    const h = new Array(256).fill(0); h[10] = 50; h[200] = 50;
    expect(percentile(h, 100, 0.25)).toBe(10);
    expect(percentile(h, 100, 0.75)).toBe(200);
  });
  it("stretches a dull image but leaves flat ones alone", () => {
    const h = new Array(256).fill(0); for (let i = 60; i <= 180; i++) h[i] = 1;
    const lut = levelsLut(h, 121, 1);
    expect(lut[60]).toBe(0); expect(lut[180]).toBe(255);
    const flat = new Array(256).fill(0); flat[128] = 100;
    expect(levelsLut(flat, 100)[128]).toBe(128);
  });
  it("fits within without upscaling", () => {
    expect(fitWithin(4000, 3000, 2048)).toEqual({ w: 2048, h: 1536 });
    expect(fitWithin(500, 400, 2048)).toEqual({ w: 500, h: 400 });
  });
  it("converts crops to pixels with padding", () => {
    expect(cropRect(1000, 1000, null)).toEqual({ sx: 0, sy: 0, sw: 1000, sh: 1000 });
    expect(cropRect(1000, 1000, { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, 0)).toEqual({ sx: 100, sy: 100, sw: 500, sh: 500 });
  });
});

describe("phone/email", () => {
  it("normalises NZ numbers", () => {
    expect(normalizePhone("021 123 4567")).toBe("+64211234567");
    expect(normalizePhone("+64 27 555 1234")).toBe("+64275551234");
    expect(normalizePhone("0064211234567")).toBe("+64211234567");
    expect(normalizePhone("abc")).toBeNull();
  });
  it("checks email", () => {
    expect(isEmail("a@b.co")).toBe(true);
    expect(isEmail("nope")).toBe(false);
  });
});

describe("csv", () => {
  it("escapes quotes and defuses formulas", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("=HYPERLINK(\"x\")")).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell(null)).toBe('""');
  });
});

describe("router", () => {
  it("parses routes and rejects junk", () => {
    const id = "3b241101-e2bb-4255-8caf-4136c566a962";
    expect(parseRoute(`#/b/${id}/capture`)).toEqual({ name: "capture", id });
    expect(parseRoute(`#/i/${id}`)).toEqual({ name: "item", id, review: false });
    expect(parseRoute(`#/i/${id}/review`)).toEqual({ name: "item", id, review: true });
    expect(parseRoute(`#/b/${id}/export`)).toEqual({ name: "export", id });
    expect(parseRoute("#/capture")).toEqual({ name: "capture" });
    expect(parseRoute("#/export")).toEqual({ name: "export" });
    expect(parseRoute("#/list")).toEqual({ name: "quicklist" });
    expect(parseRoute("#/b/<script>")).toEqual({ name: "home" });
  });
});

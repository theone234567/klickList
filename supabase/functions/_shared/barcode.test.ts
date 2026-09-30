import { describe, expect, it } from "vitest";
import { applyBarcodeFacts, describeBarcode, normalizeBarcode, regionFromBarcode, validCheckDigit, type BarcodeInfo } from "./barcode";

describe("barcodes", () => {
  it("normalises and checks barcodes", () => {
    expect(normalizeBarcode("9780140328721")).toBe("9780140328721");
    expect(normalizeBarcode("025192123450")).toBe("0025192123450"); // UPC-A -> EAN-13
    expect(normalizeBarcode("0025192123450")).toBe("0025192123450");
    expect(normalizeBarcode("9321337071234")).toBeNull(); // bad check digit
    expect(normalizeBarcode("hello")).toBeNull();
    expect(validCheckDigit("9321337071237")).toBe(true);
  });
  it("works out the likely DVD / Blu-ray region from the barcode country", () => {
    expect(regionFromBarcode("9321337071237")).toEqual({ country: "Australia", dvd: "Region 4", bluRay: "Region B" });
    expect(regionFromBarcode("9421234567895")?.country).toBe("New Zealand");
    expect(regionFromBarcode("0025192123450")).toMatchObject({ dvd: "Region 1", bluRay: "Region A" });
    expect(regionFromBarcode("5051892123457")).toMatchObject({ country: "UK", dvd: "Region 2" });
    expect(regionFromBarcode("9780140328721")).toBeNull(); // books have no region
  });
});

const info = (over: Partial<BarcodeInfo>): BarcodeInfo => ({
  code: "9321337071237", isbn: null, country: "Australia", dvdRegion: "Region 4", bluRayRegion: "Region B", product: null, ...over,
});
const listing = (over: object = {}) => ({ title: "Shrek 2 DVD", category_path: "Movies & TV > DVDs", attributes: [{ name: "Type", value: "DVD" }], needs_check: [], ...over });

describe("applying barcode facts", () => {
  it("adds a flagged region for DVDs when the AI couldn't see one", () => {
    const out = applyBarcodeFacts(listing(), info({}));
    expect(out.attributes[0]).toEqual({ name: "Region", value: "Region 4 (from barcode)" });
    expect(out.needs_check[0]).toMatch(/Australia barcode/);
  });
  it("uses Blu-ray regions for Blu-rays and keeps a region the AI read from the cover", () => {
    expect(applyBarcodeFacts(listing({ title: "Avatar Blu-ray" }), info({})).attributes[0].value).toBe("Region B (from barcode)");
    const seen = listing({ attributes: [{ name: "Region", value: "Region 2" }] });
    expect(applyBarcodeFacts(seen, info({})).attributes).toEqual([{ name: "Region", value: "Region 2" }]);
  });
  it("adds ISBN for books and leaves non-disc items alone", () => {
    const book = applyBarcodeFacts(listing({ title: "Fantastic Mr Fox paperback", category_path: "Books" }), info({ isbn: "9780140328721", country: null, dvdRegion: null, bluRayRegion: null }));
    expect(book.attributes).toContainEqual({ name: "ISBN", value: "9780140328721" });
    expect(applyBarcodeFacts(listing({ title: "Lamp", category_path: "Home", attributes: [] }), info({})).attributes.find((a) => a.name === "Region")).toBeUndefined();
  });
  it("describes facts briefly for the AI", () => {
    expect(describeBarcode(info({}))).toBe("Barcode 9321337071237 is registered in Australia: discs from there are usually DVD Region 4 / Blu-ray Region B.");
    expect(describeBarcode(info({ isbn: "9780140328721", country: null, product: { title: "Fantastic Mr Fox", by: "Roald Dahl", publisher: "Puffin", year: "1988", pages: "96", brand: "", source: "Open Library" } })))
      .toBe('ISBN 9780140328721. Open Library: "Fantastic Mr Fox"; by Roald Dahl; Puffin, 1988; 96 pages.');
  });
});

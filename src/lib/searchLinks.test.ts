import { describe, expect, it } from "vitest";
import { priceSearchLinks, searchQuery } from "./searchLinks";

describe("price search links", () => {
  it("cleans the title into search words", () => {
    expect(searchQuery("Shrek 2 DVD Region 4 (NZ/Australia)")).toBe("Shrek 2 DVD");
    expect(searchQuery("The Dark Knight Blu-ray R4 – Like New")).toBe("The Dark Knight Blu-ray");
  });
  it("links Trade Me, eBay sold and PriceSpy, plus Discogs (by barcode) for music and film", () => {
    const dvd = priceSearchLinks({ title: "Shrek 2 DVD Region 4", category_path: "Movies-TV > DVDs", barcode: "9321337071237" });
    expect(dvd.map((l) => l.label)).toEqual(["Trade Me", "eBay AU sold", "eBay sold", "Discogs", "PriceSpy NZ"]);
    expect(dvd[0].url).toBe("https://www.trademe.co.nz/a/search?search_string=Shrek%202%20DVD");
    expect(dvd[1].url).toContain("LH_Sold=1");
    expect(dvd[3].url).toContain("q=9321337071237");
    const kettle = priceSearchLinks({ title: "Breville Kettle 1.7L", category_path: "Home-living > Kitchen", barcode: "" });
    expect(kettle.map((l) => l.label)).not.toContain("Discogs");
    expect(priceSearchLinks({ title: "", category_path: "", barcode: "" })).toEqual([]);
  });
});

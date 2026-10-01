import { describe, expect, it } from "vitest";
import { boolLike, buildTradeMeCsv, FALLBACK_HEADERS, fieldFor, fitBody, parseCsv, skuFor, templateFromCsv, TM_BODY_MAX, tmCell, tmSummary } from "./trademe";
import { DEFAULT_TM_OPTIONS, type Item } from "./types";

const item = (over: Partial<Item> = {}): Item => ({
  id: "3b241101-e2bb-4255-8caf-4136c566a962", batch_id: "b", position: 0, status: "ready", ai_status: "done",
  ai_error: null, ai_updated_at: null, hint: "", barcode: "", title: 'Shrek 2 "Special" DVD', subtitle: "",
  description: "- Plays fine\n- Case ok", category_path: "Movies & TV > DVDs", condition: "Used",
  attributes: [{ name: "Region", value: "4" }], start_price: 3, buy_now_price: 6, price_confidence: "medium",
  price_reasoning: "", shipping_size: "Small parcel", weight_kg: 0.2, needs_check: [], tm_category: "",
  price_check: null, price_checked_at: null, exported_at: null, ai_provider: null, photos: [], ...over,
});

describe("csv parsing", () => {
  it("handles quotes, commas and newlines", () => {
    expect(parseCsv('a,b\r\n"x, y","he said ""hi""\nbye"\n')).toEqual([["a", "b"], ["x, y", 'he said "hi"\nbye']]);
  });
});

describe("template", () => {
  const csv = 'SKU,Title,Description,Category,Start_Price,Is_New,Duration,Pickup,Photo_ID_List,Listing_ID\n'
    + 'OLD1,Old thing,Old desc,0003-0050-,5,No,7,Allow,a.jpg,12345\n';
  it("keeps option defaults but never copies another product's content", () => {
    const t = templateFromCsv(csv);
    expect(t.headers).toHaveLength(10);
    expect(t.defaults).toEqual(["", "", "", "0003-0050-", "", "No", "7", "Allow", "", ""]);
  });
  it("rejects files that aren't product exports", () => {
    expect(() => templateFromCsv("foo,bar\n1,2")).toThrow();
  });
  it("builds rows in the template's column order and styles", () => {
    const t = templateFromCsv(csv);
    const out = parseCsv(buildTradeMeCsv([item()], t, new Map([[item().id, ["https://x/1.jpg", "https://x/2.jpg"]]]), {}));
    expect(out[0]).toEqual(t.headers);
    const row = Object.fromEntries(t.headers.map((h, i) => [h, out[1][i]]));
    expect(row.SKU).toBe(skuFor(item()));
    expect(row.Title).toBe('Shrek 2 "Special" DVD');
    expect(row.Description).toBe("- Plays fine\n- Case ok\n\nRegion: 4");
    expect(row.Category).toBe("0003-0050-");
    expect(row.Start_Price).toBe("3.00");
    expect(row.Is_New).toBe("No");
    expect(row.Duration).toBe("7");
    expect(row.Photo_ID_List).toBe("https://x/1.jpg;https://x/2.jpg");
    expect(row.Listing_ID).toBe("");
  });
  it("prefers the item's own category code, then remembered codes", () => {
    const t = templateFromCsv(csv);
    const cat = (it: Item, map: Record<string, string>) => parseCsv(buildTradeMeCsv([it], t, new Map(), map))[1][3];
    expect(cat(item(), { "Movies & TV > DVDs": "0003-9999-" })).toBe("0003-9999-");
    expect(cat(item({ tm_category: "1234" }), { "Movies & TV > DVDs": "0003-9999-" })).toBe("1234");
  });
});

describe("Trade Me style export", () => {
  // Snake_case columns and TRUE/FALSE as in Trade Me's My Products export, with a note line above the headers.
  const csv = '"Seller notes: edit below"\n'
    + 'sku,title,description,category,start_price,is_new,is_sold_in_multiple_quantities,shipping_options,payment_bank_deposit,product_id\n'
    + 'OLD1,Old thing,Old desc,0003-0050-,5,FALSE,FALSE,new_5.40,TRUE,999\n';
  it("finds the header row and keeps the note line and option defaults", () => {
    const t = templateFromCsv(csv);
    expect(t.preamble).toEqual([["Seller notes: edit below"]]);
    expect(t.headers[0]).toBe("sku");
    const out = parseCsv(buildTradeMeCsv([item({ condition: "New" })], t, new Map(), {}));
    expect(out[0]).toEqual(["Seller notes: edit below"]);
    expect(out[1]).toEqual(t.headers);
    const row = Object.fromEntries(t.headers.map((h, i) => [h, out[2][i]]));
    expect(row.is_new).toBe("TRUE");
    expect(row.is_sold_in_multiple_quantities).toBe("FALSE");
    expect(row.shipping_options).toBe("new_5.40");
    expect(row.payment_bank_deposit).toBe("TRUE");
    expect(row.product_id).toBe("");
  });
});

describe("Trade Me import guide columns", () => {
  it("without a template, writes every column in the guide with safe defaults", () => {
    expect(FALLBACK_HEADERS).toHaveLength(58);
    const out = parseCsv(buildTradeMeCsv([item({ barcode: "9312345678907", weight_kg: 0.2,
      attributes: [{ name: "Brand", value: "Sony" }, { name: "Region", value: "4" }] })], null, new Map(), { "Movies & TV > DVDs": "4425" }));
    const row = Object.fromEntries(out[0].map((h, i) => [h, out[1][i]]));
    expect(row.category_id).toBe("4425");
    expect(row.body).toContain("Region: 4");
    expect(row.barcode_gtin).toBe("9312345678907");
    expect(row.brand).toBe("Sony");
    expect(row.weight_kg).toBe("0.2");
    expect(row.stock_amount).toBe("1");
    expect(row.unlimited_stock).toBe("False");
    expect(row.is_new).toBe("False");
    expect(row.auction_length).toBe("7");
  });
  it("never copies the template product's own attributes, barcode or second category", () => {
    const csv = "sku,title,body,category_id,attributes,second_category_id,dvd_catalogue_id,barcode_gtin,brand,delivery_price\n"
      + "A1,Camera,Desc,1234,CameraBrand=Nikon,5678,99,9400000000000,Nikon,4.00=Tracked Post\n";
    const t = templateFromCsv(csv);
    const out = parseCsv(buildTradeMeCsv([item({ attributes: [] })], t, new Map(), {}));
    const row = Object.fromEntries(out[0].map((h, i) => [h, out[1][i]]));
    expect([row.attributes, row.second_category_id, row.dvd_catalogue_id, row.barcode_gtin, row.brand]).toEqual(["", "", "", "", ""]);
    expect(row.delivery_price).toBe("4.00=Tracked Post");
    expect(row.category_id).toBe("1234");
  });
  it("keeps descriptions within Trade Me's 2048 characters", () => {
    const long = ("word ".repeat(500)).trim();
    expect(fitBody(long).length).toBeLessThanOrEqual(TM_BODY_MAX);
    expect(fitBody(long).endsWith("word")).toBe(true);
    expect(fitBody("short")).toBe("short");
  });
});

describe("defaults and automatic categories", () => {
  it("defaults to free shipping, no pickup, no subtitle, and picks the category itself", async () => {
    const cats = (await import("../data/trademe-categories.json")).default as import("./categories").TmCategory[];
    const out = parseCsv(buildTradeMeCsv([item({ subtitle: "old paid subtitle", category_path: "Movies-TV > DVDs > Animated" })], null, new Map(), {}, cats));
    const row = Object.fromEntries(out[0].map((h, i) => [h, out[1][i]]));
    expect(row.delivery_price).toBe("0.00=Free shipping");
    expect(row.delivery_pickup_allowed).toBe("False");
    expect(row.subtitle).toBe("");
    expect(row.second_category_id).toBe("");
    expect(row.category_id).toBe("6211");
    expect(row.auction_length).toBe("7");
  });
  it("a blank Trade Me template file gets the same defaults", () => {
    const t = templateFromCsv(FALLBACK_HEADERS.join(",") + "\n");
    expect(t.defaults[t.headers.indexOf("delivery_price")]).toBe("0.00=Free shipping");
  });
});

describe("listing options from Settings", () => {
  const row = (tm: import("./types").TmOptions, template: import("./types").TmTemplate | null = null) => {
    const out = parseCsv(buildTradeMeCsv([item({ title: "shrek 2 dvd" })], template, new Map(), {}, [], tm));
    return Object.fromEntries(out[0].map((h, i) => [h, out[1][i]]));
  };
  it("writes shipping, pickup, length and payment, overriding the template", () => {
    const t = templateFromCsv("title,delivery_price,delivery_pickup_allowed,delivery_must_pickup,auction_length,payment_bank_deposit,payment_cash\nx,5.00=Courier,True,False,10,False,True\n");
    const r = row({ ...DEFAULT_TM_OPTIONS, pickup: "allowed", days: 5 }, t);
    expect([r.delivery_price, r.delivery_pickup_allowed, r.delivery_must_pickup, r.auction_length, r.payment_bank_deposit, r.payment_cash])
      .toEqual(["0.00=Free shipping", "True", "False", "5", "True", "False"]);
    expect(r.title).toBe("Shrek 2 DVD");
  });
  it("uses your own shipping prices", () => {
    expect(row({ ...DEFAULT_TM_OPTIONS, shipping: "custom", shippingText: "4.00=Tracked Post ; 7.25=Courier" }).delivery_price)
      .toBe("4.00=Tracked Post;7.25=Courier");
    expect(tmSummary(DEFAULT_TM_OPTIONS)).toBe("Free shipping · No pickup · 7 days · Bank deposit");
  });
});

describe("helpers", () => {
  it("maps header aliases", () => {
    expect(fieldFor("Buy Now Price")).toBe("buynow");
    expect(fieldFor("photo_id_list")).toBe("photos");
    expect(fieldFor("Payment methods")).toBeNull();
  });
  it("mirrors boolean style", () => {
    expect(boolLike("No", true)).toBe("Yes");
    expect(boolLike("FALSE", true)).toBe("TRUE");
    expect(boolLike("0", false)).toBe("0");
    expect(boolLike("", true)).toBe("true");
  });
  it("defuses formulas but keeps bullet points", () => {
    expect(tmCell("=cmd()")).toBe(`"'=cmd()"`);
    expect(tmCell("- bullet")).toBe(`"- bullet"`);
    expect(tmCell("-1+1")).toBe(`"'-1+1"`);
  });
  it("makes stable SKUs", () => {
    expect(skuFor({ id: "3b241101-e2bb-4255-8caf-4136c566a962" })).toBe("KL3B241101E2");
  });
});

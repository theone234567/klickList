// Trade Me "My Products" CSV import file.
// Trade Me requires every column of its template to be present. The safest way to get the exact
// columns is to load a CSV exported from your own My Products page once ("template"); its first
// product row also supplies your usual defaults (duration, pickup, shipping, payment...).
import { fullDescription } from "./csv";
import type { Item, TmTemplate } from "./types";

/**
 * Trade Me's columns (My Products Import Guide v6.15). Every column must be present, in any order.
 * Used until a template from your own export is loaded; a template also supplies your usual options.
 */
export const FALLBACK_HEADERS = [
  "product_id_for_member", "sku", "photo_id_list", "youtube_video_key", "stock_amount", "unlimited_stock",
  "category_id", "second_category_id", "dvd_catalogue_id", "title", "subtitle", "body", "is_new", "attributes",
  "is_legal_notice_read", "start_price", "reserve_price", "buy_now_price", "is_sold_multiple_quantities",
  "is_shipping_price_per_quantity_sold", "fpo_amount", "fpo_duration", "fpo_to", "av_bidders_only", "auction_length",
  "auction_end_time", "delivery_pickup_allowed", "delivery_must_pickup", "delivery_use_bookcourier_rates",
  "delivery_bookcourier_is_box", "delivery_bookcourier_bag_size", "delivery_bookcourier_selected_courier",
  "delivery_bookcourier_service_level", "delivery_bookcourier_no_restricted_items", "delivery_price",
  "payment_bank_deposit", "payment_credit_card", "payment_cash", "payment_afterpay", "payment_other",
  "send_payment_instructions", "display_bold", "gallery", "gallery_plus", "feature", "super_feature",
  "donation_recipient", "folder", "exclude_shipping_promotion", "listing_footer_enabled", "length_cm", "width_cm",
  "height_cm", "weight_kg", "brand", "manufacturer_code", "barcode_gtin", "update_active_listings",
];
const FALLBACK_DEFAULTS: Record<string, string> = {
  stock_amount: "1", unlimited_stock: "False", is_new: "False", auction_length: "7", payment_bank_deposit: "True",
  delivery_use_bookcourier_rates: "False", delivery_bookcourier_is_box: "False", delivery_bookcourier_no_restricted_items: "False",
  update_active_listings: "True",
};

/** Trade Me's limits for the import (guide v6.15). */
export const TM_TITLE_MAX = 50;
export const TM_BODY_MAX = 2048;

type Field = "sku" | "title" | "subtitle" | "description" | "category" | "start" | "reserve" | "buynow" | "isnew" | "photos"
  | "quantity" | "barcode" | "brand" | "weight" | "perItem";

const ALIASES: Record<Field, string[]> = {
  sku: ["sku", "productcode", "productsku", "code"],
  title: ["title", "listingtitle", "name", "productname"],
  subtitle: ["subtitle", "listingsubtitle"],
  description: ["description", "body", "details", "listingdescription"],
  category: ["category", "categoryid", "categorynumber", "categorycode", "tradmecategory", "trademecategory"],
  start: ["startprice", "startingprice", "auctionstartprice", "start"],
  reserve: ["reserveprice", "reserve"],
  buynow: ["buynowprice", "buynow", "fixedprice", "price"],
  isnew: ["isnew", "isbrandnew", "brandnew", "new", "isitemnew"],
  photos: ["photoidlist", "photoids", "photos", "photo", "images", "imagelist", "photourls"],
  quantity: ["quantity", "qty", "stock", "stocklevel", "stockamount"],
  barcode: ["barcodegtin", "barcode", "gtin", "ean"],
  brand: ["brand"],
  weight: ["weightkg", "weight"],
  // Specific to one product: never copied from the template product to every new one.
  perItem: ["attributes", "secondcategoryid", "dvdcatalogueid", "manufacturercode", "youtubevideokey", "wasprice"],
};

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

export function fieldFor(header: string): Field | null {
  const n = norm(header);
  for (const [field, names] of Object.entries(ALIASES) as [Field, string[]][]) {
    if (names.includes(n)) return field;
  }
  return null;
}

export function skuFor(item: Pick<Item, "id">): string {
  return "KL" + item.id.replace(/-/g, "").slice(0, 10).toUpperCase();
}

/** Minimal RFC 4180 CSV parser (quotes, escaped quotes, newlines inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export function templateFromCsv(text: string): TmTemplate {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error("That file is empty");
  // The column names are normally the first line, but allow for a note line or two above them.
  const at = rows.slice(0, 4).findIndex((r) => r.length >= 3 && r.some((h) => fieldFor(h.trim()) === "title"));
  if (at < 0) throw new Error("That doesn't look like a Trade Me My Products export (no title column)");
  const headers = rows[at].map((h) => h.trim()).slice(0, 200);
  const preamble = rows.slice(0, at).map((r) => r.map((c) => c.slice(0, 500)));
  const defaults = headers.map((_, i) => (rows[at + 1]?.[i] ?? "").slice(0, 2000));
  // Never copy one product's identity/content into every new product.
  headers.forEach((h, i) => {
    const f = fieldFor(h);
    if (f && f !== "category" && f !== "isnew" && f !== "quantity" && f !== "weight") defaults[i] = "";
    if (/listingid|productid|^id$/i.test(norm(h))) defaults[i] = "";
  });
  return { headers, defaults, loadedAt: new Date().toISOString(), ...(preamble.length ? { preamble } : {}) };
}

/** Write booleans in the same style as the template (true/false, yes/no, y/n, 1/0). */
export function boolLike(sample: string, value: boolean): string {
  const s = sample.trim();
  const styles: [string, string][] = [["true", "false"], ["yes", "no"], ["y", "n"], ["1", "0"]];
  for (const [t, f] of styles) {
    if (s.toLowerCase() === t || s.toLowerCase() === f) {
      const out = value ? t : f;
      return s === s.toUpperCase() ? out.toUpperCase() : s[0] === s[0].toUpperCase() ? out[0].toUpperCase() + out.slice(1) : out;
    }
  }
  return value ? "true" : "false";
}

/** CSV cell for Trade Me. Formula characters are defused, but "- " bullet points are kept. */
export function tmCell(value: string): string {
  let s = value;
  if (/^[=+@\t\r]/.test(s) || /^-[^\s]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Keep the description within Trade Me's limit, cutting at a line or word break. */
export function fitBody(text: string): string {
  if (text.length <= TM_BODY_MAX) return text;
  const cut = text.slice(0, TM_BODY_MAX);
  const at = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(" "));
  return (at > TM_BODY_MAX - 200 ? cut.slice(0, at) : cut).trimEnd();
}

const price = (n: number | null) => (n === null || n === undefined ? "" : Number(n).toFixed(2));

export function buildTradeMeCsv(
  items: Item[],
  template: TmTemplate | null,
  photoLists: Map<string, string[]>,
  categoryMap: Record<string, string>,
): string {
  const headers = template?.headers ?? FALLBACK_HEADERS;
  const defaults = template?.defaults ?? headers.map((h) => FALLBACK_DEFAULTS[h] ?? "");
  const lines = [...(template?.preamble ?? []), headers].map((r) => r.map(tmCell).join(","));
  for (const item of items) {
    const row = headers.map((h, i) => {
      const d = defaults[i] ?? "";
      switch (fieldFor(h)) {
        case "sku": return skuFor(item);
        case "title": return item.title;
        case "subtitle": return item.subtitle;
        case "description": return fitBody(fullDescription(item));
        case "category": return item.tm_category || categoryMap[item.category_path] || d;
        case "start": return price(item.start_price);
        case "reserve": return price(item.start_price);
        case "buynow": return price(item.buy_now_price);
        case "isnew": return boolLike(d, item.condition === "New");
        case "photos": return (photoLists.get(item.id) ?? []).join(";");
        case "quantity": return d || "1";
        case "barcode": return item.barcode.replace(/[^\w-]/g, "").slice(0, 100);
        case "brand": return (item.attributes.find((a) => /^brand$/i.test(a.name))?.value ?? "").slice(0, 70);
        case "weight": return item.weight_kg ? String(item.weight_kg) : d;
        case "perItem": return "";
        default: return d;
      }
    });
    lines.push(row.map(tmCell).join(","));
  }
  return lines.join("\r\n");
}

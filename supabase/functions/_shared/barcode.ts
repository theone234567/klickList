// Free barcode facts for listings:
//  * Books: ISBN -> Open Library (fallback Google Books): exact title, author, publisher, year, pages.
//  * DVDs/Blu-rays: the barcode's GS1 country prefix -> the region discs from there usually are
//    (e.g. 93 Australia / 94 NZ -> DVD Region 4, Blu-ray B). Plus a best-effort product lookup (UPCitemdb free tier).
// Everything here is free and needs no API key. Database text is untrusted: it is cleaned and length-limited.

export interface BarcodeInfo {
  code: string; // normalised EAN-13 (or EAN-8)
  isbn: string | null;
  country: string | null;
  dvdRegion: string | null;
  bluRayRegion: string | null;
  product: { title: string; by: string; publisher: string; year: string; pages: string; brand: string; source: string } | null;
}

/** Digits only; UPC-A (12) becomes EAN-13 with a leading 0. Returns null if it isn't a retail barcode. */
export function normalizeBarcode(raw: string): string | null {
  let d = (raw ?? "").replace(/\D/g, "");
  if (d.length === 14 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 12) d = "0" + d;
  if (d.length !== 13 && d.length !== 8) return null;
  return validCheckDigit(d) ? d : null;
}

export function validCheckDigit(code: string): boolean {
  const digits = code.split("").map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

export const isIsbn = (ean: string) => ean.length === 13 && /^97[89]/.test(ean);

// GS1 prefix -> [country, DVD region, Blu-ray region]. The prefix shows where the barcode was registered,
// which for DVDs almost always matches the market (and so the region) it was released for.
const PREFIXES: [number, number, string, string, string][] = [
  [0, 139, "USA/Canada", "Region 1", "Region A"],
  [300, 379, "France", "Region 2", "Region B"],
  [400, 440, "Germany", "Region 2", "Region B"],
  [450, 459, "Japan", "Region 2", "Region A"],
  [460, 469, "Russia", "Region 5", "Region C"],
  [471, 471, "Taiwan", "Region 3", "Region A"],
  [489, 489, "Hong Kong", "Region 3", "Region A"],
  [490, 499, "Japan", "Region 2", "Region A"],
  [500, 509, "UK", "Region 2", "Region B"],
  [539, 539, "Ireland", "Region 2", "Region B"],
  [540, 549, "Belgium", "Region 2", "Region B"],
  [570, 579, "Denmark", "Region 2", "Region B"],
  [600, 601, "South Africa", "Region 2", "Region B"],
  [640, 649, "Finland", "Region 2", "Region B"],
  [690, 699, "China", "Region 6", "Region C"],
  [700, 709, "Norway", "Region 2", "Region B"],
  [730, 739, "Sweden", "Region 2", "Region B"],
  [750, 750, "Mexico", "Region 4", "Region A"],
  [760, 769, "Switzerland", "Region 2", "Region B"],
  [779, 779, "Argentina", "Region 4", "Region A"],
  [789, 790, "Brazil", "Region 4", "Region A"],
  [800, 839, "Italy", "Region 2", "Region B"],
  [840, 849, "Spain", "Region 2", "Region B"],
  [870, 879, "Netherlands", "Region 2", "Region B"],
  [880, 880, "South Korea", "Region 3", "Region A"],
  [885, 885, "Thailand", "Region 3", "Region A"],
  [888, 888, "Singapore", "Region 3", "Region A"],
  [890, 890, "India", "Region 5", "Region C"],
  [900, 919, "Austria", "Region 2", "Region B"],
  [930, 939, "Australia", "Region 4", "Region B"],
  [940, 949, "New Zealand", "Region 4", "Region B"],
];

export function regionFromBarcode(ean: string): { country: string; dvd: string; bluRay: string } | null {
  if (ean.length !== 13 || isIsbn(ean)) return null;
  const p = Number(ean.slice(0, 3));
  const hit = PREFIXES.find(([lo, hi]) => p >= lo && p <= hi);
  return hit ? { country: hit[2], dvd: hit[3], bluRay: hit[4] } : null;
}

const clean = (v: unknown, max: number): string =>
  typeof v === "string" || typeof v === "number"
    ? String(v).replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max)
    : "";

async function getJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(4000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function lookupIsbn(isbn: string): Promise<BarcodeInfo["product"]> {
  const ol = await getJson(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`) as
    Record<string, { title?: string; subtitle?: string; authors?: { name?: string }[]; publishers?: { name?: string }[]; publish_date?: string; number_of_pages?: number }> | null;
  const b = ol?.[`ISBN:${isbn}`];
  if (b?.title) {
    return {
      title: clean([b.title, b.subtitle].filter(Boolean).join(": "), 150),
      by: clean((b.authors ?? []).map((a) => a.name).filter(Boolean).slice(0, 3).join(", "), 120),
      publisher: clean(b.publishers?.[0]?.name, 80),
      year: clean(b.publish_date, 20),
      pages: clean(b.number_of_pages, 6),
      brand: "",
      source: "Open Library",
    };
  }
  // Optional free key (Google Cloud -> Books API): without one, Google's shared anonymous quota is often used up.
  const key = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get("GOOGLE_BOOKS_API_KEY");
  const gb = await getJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}${key ? `&key=${encodeURIComponent(key)}` : ""}`) as
    { items?: { volumeInfo?: { title?: string; subtitle?: string; authors?: string[]; publisher?: string; publishedDate?: string; pageCount?: number } }[] } | null;
  const v = gb?.items?.[0]?.volumeInfo;
  if (v?.title) {
    return {
      title: clean([v.title, v.subtitle].filter(Boolean).join(": "), 150),
      by: clean((v.authors ?? []).slice(0, 3).join(", "), 120),
      publisher: clean(v.publisher, 80),
      year: clean(v.publishedDate, 20),
      pages: clean(v.pageCount, 6),
      brand: "",
      source: "Google Books",
    };
  }
  return null;
}

async function lookupProduct(ean: string): Promise<BarcodeInfo["product"]> {
  const r = await getJson(`https://api.upcitemdb.com/prod/trial/lookup?upc=${ean}`) as
    { items?: { title?: string; brand?: string }[] } | null;
  const it = r?.items?.[0];
  if (!it?.title) return null;
  return { title: clean(it.title, 150), by: "", publisher: "", year: "", pages: "", brand: clean(it.brand, 60), source: "UPCitemdb" };
}

/** Everything we can learn for free from a barcode. `lookup: false` skips the network (region only). */
export async function barcodeInfo(raw: string, opts: { lookup?: boolean } = {}): Promise<BarcodeInfo | null> {
  const code = normalizeBarcode(raw);
  if (!code) return null;
  const isbn = isIsbn(code) ? code : null;
  const region = regionFromBarcode(code);
  const product = opts.lookup === false ? null : isbn ? await lookupIsbn(isbn) : await lookupProduct(code);
  return {
    code, isbn,
    country: region?.country ?? null,
    dvdRegion: region?.dvd ?? null,
    bluRayRegion: region?.bluRay ?? null,
    product,
  };
}

/** Short factual text for the AI (a few dozen tokens). */
export function describeBarcode(info: BarcodeInfo | null): string {
  if (!info) return "";
  const parts: string[] = [];
  if (info.isbn) parts.push(`ISBN ${info.isbn}.`);
  else if (info.country) {
    parts.push(`Barcode ${info.code} is registered in ${info.country}: discs from there are usually DVD ${info.dvdRegion} / Blu-ray ${info.bluRayRegion}.`);
  } else parts.push(`Barcode ${info.code}.`);
  const p = info.product;
  if (p) {
    const bits = [
      `"${p.title}"`,
      p.by && `by ${p.by}`,
      [p.publisher, p.year].filter(Boolean).join(", "),
      p.pages && `${p.pages} pages`,
      p.brand && `brand ${p.brand}`,
    ].filter(Boolean);
    parts.push(`${p.source}: ${bits.join("; ")}.`);
  }
  return parts.join(" ");
}

interface ListingLike {
  title: string;
  category_path: string;
  attributes: { name: string; value: string }[];
  needs_check: string[];
}

/** After the AI answers: make sure ISBN and (for discs) region are filled in, flagging guesses. */
export function applyBarcodeFacts<T extends ListingLike>(listing: T, info: BarcodeInfo | null): T {
  if (!info) return listing;
  const attrs = [...listing.attributes];
  const needs = [...listing.needs_check];
  const has = (name: string) => attrs.some((a) => a.name.toLowerCase() === name.toLowerCase() && a.value.trim());
  if (info.isbn && !has("ISBN")) attrs.push({ name: "ISBN", value: info.isbn });
  const text = `${listing.title} ${listing.category_path} ${attrs.map((a) => a.value).join(" ")}`.toLowerCase();
  const isBluRay = /blu-?ray/.test(text);
  const isDisc = isBluRay || /\bdvd|\bdvds|movies? & tv|film|tv series/.test(text);
  if (isDisc && !has("Region") && info.dvdRegion) {
    const region = isBluRay ? info.bluRayRegion : info.dvdRegion;
    attrs.unshift({ name: "Region", value: `${region} (from barcode)` });
    if (needs.length < 10) needs.push(`Region worked out from the ${info.country} barcode – check the back cover`);
  }
  return { ...listing, attributes: attrs.slice(0, 18), needs_check: needs };
}

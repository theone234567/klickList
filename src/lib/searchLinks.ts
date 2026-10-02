// One-tap price research: links that open a search for the item on other sites in a new tab.
// Nothing is fetched or copied by KlickList - you look at the results and type your own price.
import type { Item } from "./types";

export interface SearchLink { label: string; url: string; hint: string }

/** Search words from the title: drop region codes, bracketed notes and filler so searches find matches. */
export function searchQuery(title: string): string {
  return title
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(region\s*(free|[1-6abc])|r[1-6]|pal|ntsc)\b/gi, " ")
    .replace(/\b(used|new|vgc|good condition|excellent condition|like new|great|rare)\b/gi, " ")
    .replace(/[^\p{L}\p{N}&'\-. ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 8)
    .join(" ");
}

const isMusicOrFilm = (item: Pick<Item, "title" | "category_path">) =>
  /\b(cd|cds|vinyl|lp|record|dvd|dvds|blu-?ray|bluray|4k|uhd|vhs|cassette|movies?|music|film)\b/i
    .test(`${item.title} ${item.category_path}`);

export function priceSearchLinks(item: Pick<Item, "title" | "category_path" | "barcode">): SearchLink[] {
  const q = searchQuery(item.title);
  if (!q) return [];
  const e = encodeURIComponent(q);
  const links: SearchLink[] = [
    { label: "Trade Me", url: `https://www.trademe.co.nz/a/search?search_string=${e}`, hint: "What similar items are listed for now" },
    { label: "eBay AU sold", url: `https://www.ebay.com.au/sch/i.html?_nkw=${e}&LH_Sold=1&LH_Complete=1`, hint: "What they actually sold for in Australia" },
    { label: "eBay sold", url: `https://www.ebay.com/sch/i.html?_nkw=${e}&LH_Sold=1&LH_Complete=1`, hint: "What they actually sold for (mostly USA, in US$)" },
  ];
  if (isMusicOrFilm(item)) {
    const code = item.barcode.replace(/\D/g, "");
    const dq = encodeURIComponent(code.length >= 8 ? code : q);
    links.push({ label: "Discogs", url: `https://www.discogs.com/search/?q=${dq}&type=all`, hint: "Exact release and its sales history (music & film)" });
  }
  links.push({ label: "PriceSpy NZ", url: `https://pricespy.co.nz/search?search=${e}`, hint: "Price new in NZ shops – a used one should be well under this" });
  return links;
}

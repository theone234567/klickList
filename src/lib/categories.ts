// Trade Me category numbers, picked automatically from the AI's category guess, the title and details.
// Data: Trade Me's category list (Trade_Me_Categories.xlsx), auctionable categories only. Loaded on demand (~60 KB).
import type { Item } from "./types";

/** [category_id, path, durations if not the usual "2,3,4,5,6,7,10"] */
export type TmCategory = [number, string, string?];

let cache: Promise<TmCategory[]> | null = null;
export function loadCategories(): Promise<TmCategory[]> {
  cache ??= import("../data/trademe-categories.json").then((m) => m.default as TmCategory[]);
  return cache;
}

const DEFAULT_DURATIONS = [2, 3, 4, 5, 6, 7, 10];
export function durationsOf(cat: TmCategory | undefined): number[] {
  return cat?.[2] ? cat[2].split(",").map(Number) : DEFAULT_DURATIONS;
}

/** The wanted listing length if the category allows it, otherwise the nearest allowed one. */
export function allowedDuration(cat: TmCategory | undefined, wanted: number): number {
  const ok = durationsOf(cat);
  if (ok.includes(wanted)) return wanted;
  return ok.reduce((best, d) => (Math.abs(d - wanted) < Math.abs(best - wanted) ? d : best), ok[0]);
}

/** "Movies-TV > DVDs > Comedy" -> "Movies TV › DVDs › Comedy" */
export const showPath = (path: string) => path.replace(/-+/g, " ").replace(/ > /g, " › ");

const SYNONYMS: Record<string, string> = {
  bluray: "bluray", blu: "bluray", film: "movie", films: "movie", movie: "movie", movies: "movie", tv: "tv",
  television: "tv", dvd: "dvd", dvds: "dvd", cd: "cd", cds: "cd", vinyl: "vinyl", lp: "vinyl", record: "vinyl",
  novel: "fiction", paperback: "book", hardback: "book", hardcover: "book", book: "book", books: "book",
  playstation: "playstation", ps4: "playstation4", ps5: "playstation5", ps3: "playstation3", ps2: "playstation2",
  xbox: "xbox", nintendo: "nintendo", switch: "switch", phone: "phone", phones: "phone", mobile: "phone",
  childrens: "children", children: "children", kids: "children", kid: "children", scifi: "scifi",
};
const STOP = new Set(["and", "the", "of", "for", "with", "a", "an", "in", "on", "other", "general", "new", "used", "nz", "accessories"]);

function words(text: string): string[] {
  return text.toLowerCase()
    .replace(/blu[\s-]?ray/g, "bluray").replace(/sci[\s-]?fi/g, "scifi")
    .replace(/play\s?station[\s-]?(\d)/g, "playstation$1").replace(/&/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((w) => (w.length > 1 || /\d/.test(w)) && !STOP.has(w))
    .map((w) => SYNONYMS[w] ?? (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

interface Indexed { cat: TmCategory; segs: string[][]; top: string; leaf: string }
let indexed: { from: TmCategory[]; list: Indexed[] } | null = null;
function index(cats: TmCategory[]): Indexed[] {
  if (indexed?.from === cats) return indexed.list;
  const list = cats.map((cat) => {
    const parts = cat[1].split(" > ");
    return { cat, segs: parts.map(words), top: parts[0], leaf: parts[parts.length - 1] };
  });
  indexed = { from: cats, list };
  return list;
}

type ItemLike = Pick<Item, "title" | "category_path" | "attributes">;

/** First letter of the author's surname (books) or the artist's name (music), for Trade Me's A-Z sub-categories. */
function nameInitial(item: ItemLike, kind: "Author" | "Artist"): string | null {
  let name = "";
  if (kind === "Author") {
    const a = item.attributes.find((x) => /^(author|by|writer)$/i.test(x.name))?.value ?? "";
    name = a.split(/[,;&]| and /i)[0].trim().split(/\s+/).pop() ?? "";
  } else {
    const a = item.attributes.find((x) => /^(artist|band|performer|musician)$/i.test(x.name))?.value;
    name = (a ?? item.title.split(/\s[-–:]\s/)[0]).trim().replace(/^the\s+/i, "");
  }
  const c = name[0]?.toUpperCase();
  return c && /[A-Z]/.test(c) ? c : null;
}

/** Best matching Trade Me categories, best first. */
export function suggestCategories(item: ItemLike, cats: TmCategory[], n = 5): TmCategory[] {
  const guess = words(item.category_path);
  const extra = words(`${item.title} ${item.attributes.map((a) => `${a.name} ${a.value}`).join(" ")}`);
  const weight = new Map<string, number>();
  for (const w of extra) weight.set(w, Math.max(weight.get(w) ?? 0, 1));
  for (const w of guess) weight.set(w, 2.5);
  if (!weight.size) return [];
  const initials = { Author: nameInitial(item, "Author"), Artist: nameInitial(item, "Artist") };

  const scored: [number, TmCategory][] = [];
  for (const { cat, segs, leaf } of index(cats)) {
    let score = 0, unmatched = 0;
    const used = new Set<string>();
    segs.forEach((seg, i) => {
      const levelBoost = i === 0 ? 1.4 : i === segs.length - 1 ? 1.2 : 1;
      // A middle level that matches nothing (e.g. "Xbox" for a PlayStation item) is a strong sign it's wrong.
      if (i > 0 && i < segs.length - 1 && seg.length && !seg.some((w) => weight.has(w))) score -= 1.5;
      for (const w of seg) {
        const v = weight.get(w);
        if (!v) { unmatched++; continue; }
        score += v * levelBoost * (used.has(w) ? 0.3 : 1); // a word counts fully once per category
        used.add(w);
      }
    });
    if (score === 0) continue;
    score -= unmatched * 0.15;
    const range = /^(Author|Artist)-([A-Z])([A-Z])?$/.exec(leaf);
    if (range) {
      const initial = initials[range[1] as "Author" | "Artist"];
      const hit = initial && initial >= range[2] && initial <= (range[3] ?? range[2]);
      score += initial ? (hit ? 2 : -2) : -0.5;
    }
    if (/^Other$/i.test(leaf)) score -= 0.3;
    scored.push([score, cat]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1][1].length - b[1][1].length);
  return scored.slice(0, n).map(([, c]) => c);
}

/** Search box: categories whose path contains every typed word. */
export function searchCategories(query: string, cats: TmCategory[], n = 8): TmCategory[] {
  const q = query.trim();
  if (/^\d+$/.test(q)) return cats.filter((c) => String(c[0]).startsWith(q)).slice(0, n);
  const ws = words(q);
  if (!ws.length) return [];
  const list = index(cats);
  return list.filter((x) => ws.every((w) => x.segs.some((s) => s.some((t) => t.startsWith(w)))))
    .slice(0, n).map((x) => x.cat);
}

export function categoryById(cats: TmCategory[], id: string | number): TmCategory | undefined {
  const n = Number(id);
  return Number.isFinite(n) ? cats.find((c) => c[0] === n) : undefined;
}

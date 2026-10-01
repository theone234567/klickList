// Price ideas: every price suggestion (AI estimate, Trade Me search, web search) is kept side by side with
// where it came from. They never fill in the price itself: the seller types the price.
// Stored in items.price_check as { ideas: [...] } (older rows hold a single price check object).

export type IdeaKind = "ai" | "trademe" | "web";

export interface PriceIdea {
  kind: IdeaKind;
  source: string;
  start: number | null;
  buy_now: number | null;
  low: number | null;
  high: number | null;
  typical: number | null;
  note: string;
  links: { url: string; title: string }[];
  at: string;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

function toIdea(v: unknown): PriceIdea | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const kind: IdeaKind = o.kind === "ai" || o.kind === "trademe" ? o.kind : "web";
  const links = Array.isArray(o.links ?? o.sources) ? (o.links ?? o.sources) as unknown[] : [];
  return {
    kind,
    source: str(o.source, 80) || "Online price check",
    start: num(o.start), buy_now: num(o.buy_now), low: num(o.low), high: num(o.high), typical: num(o.typical),
    note: str(o.note ?? o.summary, 300),
    links: links.flatMap((l) => {
      const x = l as Record<string, unknown>;
      return typeof x?.url === "string" && /^https:\/\//.test(x.url) ? [{ url: x.url.slice(0, 500), title: str(x.title, 120) }] : [];
    }).slice(0, 5),
    at: str(o.at, 40),
  };
}

/** All ideas stored on an item (also reads the older single-check format). */
export function ideasOf(priceCheck: unknown): PriceIdea[] {
  if (!priceCheck || typeof priceCheck !== "object") return [];
  const o = priceCheck as Record<string, unknown>;
  if (Array.isArray(o.ideas)) return o.ideas.map(toIdea).filter((x): x is PriceIdea => !!x).slice(0, 6);
  if ("found" in o) { // older format: one online check
    const one = toIdea(o);
    return one && (one.start || one.typical || one.note) ? [one] : [];
  }
  return [];
}

/** Add an idea, replacing the earlier one of the same kind. */
export function withIdea(priceCheck: unknown, idea: PriceIdea): { ideas: PriceIdea[] } {
  return { ideas: [...ideasOf(priceCheck).filter((i) => i.kind !== idea.kind), idea] };
}

/** The AI's own estimate, taken off the listing so it doesn't become the price. */
export function aiIdea(
  listing: { start_price: number | null; buy_now_price: number | null; price_reasoning: string; price_confidence: string },
  provider: string,
): PriceIdea {
  const who = provider === "gemini" ? "Gemini" : "Claude";
  return {
    kind: "ai",
    source: `AI estimate (${who}, from the photos – no market data)`,
    start: listing.start_price, buy_now: listing.buy_now_price, low: null, high: null, typical: null,
    note: [listing.price_reasoning, `${listing.price_confidence} confidence`].filter(Boolean).join(" – ").slice(0, 300),
    links: [],
    at: new Date().toISOString(),
  };
}

/** The AI's estimate, used to decide whether an item is worth a price check. */
export function aiStart(priceCheck: unknown): number | null {
  return ideasOf(priceCheck).find((i) => i.kind === "ai")?.start ?? null;
}

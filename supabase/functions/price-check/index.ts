// POST /functions/v1/price-check  { itemId }
// Finds current NZ prices for one item.
//  * "trademe" (default when Trade Me API keys are set): searches Trade Me's own API. Free - no AI.
//  * "claude": one Claude web search, text only (~2c). Only used if configured in PRICE_SOURCES.
// PRICE_SOURCES is an ordered list, e.g. "trademe" (free only) or "trademe,claude" (fall back to paid).
// Numbers from any source are clamped/validated, then saved as a "price idea" with its source.
// Price ideas never change the item's price: the seller types the price.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  buildPriceQuery, cleanSources, PRICE_SYSTEM, REPORT_PRICE_TOOL, sanitizePriceReport, type PriceCheck,
} from "../_shared/price.ts";
import { claudeCostMicro } from "../_shared/providers.ts";
import { withIdea, type PriceIdea } from "../_shared/ideas.ts";
import { authenticate, DAILY_LIMIT, json, readBody, recordUsage, takeQuota, NO_USAGE, type Usage } from "../_shared/server.ts";
import { searchTerms, searchTradeMe, summarise } from "../_shared/trademe_price.ts";

const MODEL = Deno.env.get("PRICE_MODEL") ?? "claude-haiku-4-5";
const TM_KEY = Deno.env.get("TRADEME_CONSUMER_KEY") ?? "";
const TM_SECRET = Deno.env.get("TRADEME_CONSUMER_SECRET") ?? "";
const TM_SANDBOX = Deno.env.get("TRADEME_SANDBOX") === "true";
const SOURCES = (Deno.env.get("PRICE_SOURCES") ?? (TM_KEY ? "trademe" : "claude"))
  .split(",").map((s) => s.trim()).filter((s) => s === "trademe" || s === "claude");

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") ?? "missing", timeout: 60_000, maxRetries: 1 });
const Body = z.object({ itemId: z.uuid() });

interface Item {
  title: string; condition: string; category_path: string;
  attributes: { name: string; value: string }[]; start_price: number | null;
}

async function fromTradeMe(item: Item): Promise<{ check: PriceCheck; usage: Usage }> {
  if (!TM_KEY || !TM_SECRET) throw new Error("Trade Me API not set up");
  let terms = searchTerms(item.title, 6);
  let check = summarise(await searchTradeMe(terms, TM_KEY, TM_SECRET, TM_SANDBOX, item.condition), terms);
  if (!check.found && terms.length > 3) { // too specific - try the 4 most important words
    terms = terms.slice(0, 4);
    check = summarise(await searchTradeMe(terms, TM_KEY, TM_SECRET, TM_SANDBOX, item.condition), terms);
  }
  return { check, usage: NO_USAGE };
}

async function fromClaude(item: Item): Promise<{ check: PriceCheck; usage: Usage }> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 700,
    system: PRICE_SYSTEM,
    tools: [
      { type: "web_search_20250305", name: "web_search", max_uses: 1,
        user_location: { type: "approximate", country: "NZ", timezone: "Pacific/Auckland" } },
      REPORT_PRICE_TOOL,
    ],
    tool_choice: { type: "any" },
    messages: [{ role: "user", content: buildPriceQuery(item) }],
  });
  const searches = response.usage.server_tool_use?.web_search_requests ?? 0;
  const usage: Usage = {
    input: response.usage.input_tokens, output: response.usage.output_tokens, searches,
    costMicro: claudeCostMicro(MODEL, response.usage.input_tokens, response.usage.output_tokens, false, searches), gemini: false,
  };
  const results = response.content.flatMap((b) => b.type === "web_search_tool_result" && Array.isArray(b.content) ? b.content : []);
  const report = response.content.find((b) => b.type === "tool_use" && b.name === "report_price");
  if (!report || report.type !== "tool_use") throw Object.assign(new Error("no report"), { usage });
  return { check: sanitizePriceReport(report.input, cleanSources(results)), usage };
}

Deno.serve(async (req) => {
  const caller = await authenticate(req);
  if (caller instanceof Response) return caller;
  const { user, db, origin } = caller;

  let itemId: string;
  try {
    itemId = Body.parse(await readBody(req, 1_000)).itemId;
  } catch {
    return json({ error: "Invalid request" }, 400, origin);
  }

  const { data: item } = await db.from("items")
    .select("id,title,condition,category_path,attributes,start_price,status,price_check").eq("id", itemId).maybeSingle();
  if (!item) return json({ error: "Item not found" }, 404, origin);
  if (!item.title) return json({ error: "Write the listing first" }, 400, origin);
  if (!SOURCES.length) return json({ error: "Price checks are not set up" }, 503, origin);

  try {
    if (!await takeQuota(user.id)) return json({ error: `Daily limit (${DAILY_LIMIT}) reached. Try again tomorrow.` }, 429, origin);
  } catch {
    return json({ error: "Server error" }, 500, origin);
  }

  let check: PriceCheck | null = null;
  let source = "";
  const total: Usage = { ...NO_USAGE };
  for (const s of SOURCES) {
    try {
      const r = s === "trademe" ? await fromTradeMe(item) : await fromClaude(item);
      for (const k of ["input", "output", "searches", "costMicro"] as const) total[k] += r.usage[k];
      check = r.check;
      source = s;
      if (check.found) break; // otherwise try the next source, if any
    } catch (err) {
      const u = (err as { usage?: Usage }).usage;
      if (u) for (const k of ["input", "output", "searches", "costMicro"] as const) total[k] += u[k];
      console.error(`price source ${s} failed`, (err as Error).message);
    }
  }
  await recordUsage(user.id, total, !check);
  if (!check) return json({ error: "Price check failed - try again later" }, 502, origin);

  const idea: PriceIdea = {
    kind: source === "trademe" ? "trademe" : "web",
    source: source === "trademe" ? "Trade Me – similar listings now" : "Web search (Claude)",
    start: check.start, buy_now: check.buy_now, low: check.low, high: check.high, typical: check.typical,
    note: check.found ? check.summary : `No close matches found. ${check.summary}`.trim(),
    links: check.sources,
    at: new Date().toISOString(),
  };
  const { error } = await db.from("items").update({
    price_check: withIdea(item.price_check, idea),
    price_checked_at: new Date().toISOString(),
  }).eq("id", itemId);
  if (error) return json({ error: "Could not save" }, 500, origin);

  return json({ ok: true, applied: false, source, check }, 200, origin);
});

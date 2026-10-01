// POST /functions/v1/analyze-item   (instant mode)
// Turns photos of one item (normally one combined image) into a draft Trade Me listing.
//
// Hardening against misuse ("hijacking"):
//  * API keys live only here, as Supabase secrets. The browser never sees them.
//  * Caller must be a signed-in user (JWT checked by the gateway AND here), optionally on an allowlist.
//  * The endpoint is not a chatbot: prompt, models and answer schema are fixed server-side.
//    The only caller-controlled inputs are JPEG images, a 300-char note and a barcode, all validated.
//  * The AI can only answer in a fixed JSON schema, which is re-validated and sanitised before saving.
//  * The AI has no tools and cannot act; the seller reviews every draft before listing.
//  * Per-user daily cap + a small max_tokens bound the cost of any single account.
import { AnalyzeRequest, buildUserText, sanitizeListing, type CleanListing } from "../_shared/listing.ts";
import { providerOrder, ProviderError, writeListing } from "../_shared/providers.ts";
import { applyBarcodeFacts, barcodeInfo, describeBarcode } from "../_shared/barcode.ts";
import { aiIdea, withIdea } from "../_shared/ideas.ts";
import {
  authenticate, DAILY_LIMIT, getAiPrefs, json, NO_USAGE, readBody, recordUsage, takeQuota,
} from "../_shared/server.ts";

const MAX_BODY_BYTES = 1_300_000;

function isJpeg(b64: string): boolean {
  try {
    const head = atob(b64.slice(0, 8));
    return head.charCodeAt(0) === 0xff && head.charCodeAt(1) === 0xd8 && head.charCodeAt(2) === 0xff;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  const caller = await authenticate(req);
  if (caller instanceof Response) return caller;
  const { user, db, origin } = caller;

  let input: AnalyzeRequest;
  try {
    input = AnalyzeRequest.parse(await readBody(req, MAX_BODY_BYTES));
  } catch {
    return json({ error: "Invalid request" }, 400, origin);
  }
  if (!input.images.every(isJpeg)) return json({ error: "Photos must be JPEG" }, 400, origin);

  // RLS guarantees this only finds the caller's own item.
  const { data: item } = await db.from("items").select("id,price_check").eq("id", input.itemId).maybeSingle();
  if (!item) return json({ error: "Item not found" }, 404, origin);

  try {
    if (!await takeQuota(user.id)) {
      return json({ error: `Daily AI limit (${DAILY_LIMIT} items) reached. Try again tomorrow.` }, 429, origin);
    }
  } catch (e) {
    console.error("quota error", (e as Error).message);
    return json({ error: "Server error" }, 500, origin);
  }

  const stamp = () => new Date().toISOString();
  await db.from("items").update({ ai_status: "processing", ai_error: null, ai_updated_at: stamp() }).eq("id", input.itemId);

  const prefs = await getAiPrefs(db);
  const order = providerOrder(prefs.provider, prefs.backup);
  const facts = await barcodeInfo(input.barcode); // free: book details / DVD region from the barcode

  try {
    const { result, listing: raw } = await writeListing(
      order, input.images, buildUserText(input.hint, input.barcode, describeBarcode(facts)), sanitizeListing,
    );
    const listing = applyBarcodeFacts(raw as CleanListing, facts);
    await recordUsage(user.id, {
      input: result.inputTokens, output: result.outputTokens, searches: 0,
      costMicro: result.costMicroUsd, gemini: result.provider === "gemini",
    }, false);
    // The AI's price goes in the price ideas, not the price: the seller types the price.
    const { error } = await db.from("items").update({
      ...(listing as CleanListing), start_price: null, buy_now_price: null,
      price_check: withIdea(item.price_check, aiIdea(listing as CleanListing, result.provider)),
      ai_provider: result.provider, ai_status: "done", ai_error: null, ai_updated_at: stamp(),
    }).eq("id", input.itemId);
    if (error) {
      console.error("save error", error.message);
      return json({ error: "Could not save" }, 500, origin);
    }
    return json({ ok: true, provider: result.provider }, 200, origin);
  } catch (err) {
    const e = err instanceof ProviderError ? err : new ProviderError("busy", "AI service error");
    const message = {
      busy: `${e.message} - tap retry in a minute`,
      credit: "AI credit has run out - top up, or switch to Gemini in Settings",
      unavailable: e.message,
      bad_input: e.message,
      refused: "AI declined this item - please fill it in by hand",
      cut_off: "AI answer was cut off - tap retry",
      bad_output: "AI answer was not usable - tap retry",
    }[e.kind];
    await recordUsage(user.id, NO_USAGE, true); // failed calls don't count against the daily cap
    await db.from("items").update({ ai_status: "failed", ai_error: message, ai_updated_at: stamp() }).eq("id", input.itemId);
    return json({ error: message }, e.kind === "busy" ? 503 : 502, origin);
  }
});

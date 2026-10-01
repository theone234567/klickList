// POST /functions/v1/ai-batch  { action: "submit" | "poll" }
// Economy mode: listings are written through Anthropic's Message Batches API at 50% off.
// Results usually arrive within minutes (at most 24 h). The app calls "poll" while it is open.
//
// submit: takes the caller's items marked 'queued' (their combined AI photo is already in storage
//         at <user>/<item>/ai.jpg), charges quota, and sends them as one batch.
// poll:   collects finished batches, validates + sanitises each answer, saves it.
// If Claude isn't available (no key / out of credit) or the user chose Gemini, items go back to
// 'pending' and the app writes them in instant mode instead (Gemini is free).
import { z } from "zod";
import { buildUserText, sanitizeListing } from "../_shared/listing.ts";
import { applyBarcodeFacts, barcodeInfo, describeBarcode } from "../_shared/barcode.ts";
import { aiIdea, withIdea } from "../_shared/ideas.ts";
import {
  anthropic, claudeListingParams, claudeMessageToResult, classifyClaudeError, configured,
} from "../_shared/providers.ts";
import {
  admin, authenticate, getAiPrefs, json, NO_USAGE, readBody, recordUsage, takeQuotaN,
} from "../_shared/server.ts";

const Body = z.object({ action: z.enum(["submit", "poll"]) });
const MAX_PER_BATCH = 100;

function b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

Deno.serve(async (req) => {
  const caller = await authenticate(req);
  if (caller instanceof Response) return caller;
  const { user, db, origin } = caller;

  let action: "submit" | "poll";
  try {
    action = Body.parse(await readBody(req, 200)).action;
  } catch {
    return json({ error: "Invalid request" }, 400, origin);
  }
  const aiPath = (itemId: string) => `${user.id}/${itemId}/ai.jpg`;

  // ---------------- submit ----------------
  if (action === "submit") {
    const { data: queued } = await db.from("items").select("id,hint,barcode").eq("ai_status", "queued").limit(MAX_PER_BATCH);
    if (!queued?.length) return json({ ok: true, submitted: 0 }, 200, origin);
    const ids = queued.map((i) => i.id);
    const backToInstant = async (reason: string) => {
      await db.from("items").update({ ai_status: "pending" }).in("id", ids);
      return json({ ok: true, submitted: 0, instant: true, reason }, 200, origin);
    };

    const prefs = await getAiPrefs(db);
    if (prefs.provider === "gemini" || !configured("claude")) return await backToInstant("economy mode needs Claude");

    const granted = await takeQuotaN(user.id, queued.length);
    if (granted === 0) return json({ error: "Daily AI limit reached. Try again tomorrow." }, 429, origin);
    const batchItems = queued.slice(0, granted);

    // Free barcode lookups (book details / DVD region), 8 at a time so a big batch stays quick.
    const factsById = new Map<string, Awaited<ReturnType<typeof barcodeInfo>>>();
    for (let i = 0; i < batchItems.length; i += 8) {
      const chunk = batchItems.slice(i, i + 8);
      const results = await Promise.all(chunk.map((it) => barcodeInfo(it.barcode ?? "")));
      chunk.forEach((it, k) => factsById.set(it.id, results[k]));
    }

    const requests = [];
    const missing: string[] = [];
    for (const it of batchItems) {
      const { data: file } = await db.storage.from("photos").download(aiPath(it.id));
      if (!file) { missing.push(it.id); continue; }
      const facts = factsById.get(it.id) ?? null;
      requests.push({
        custom_id: it.id,
        params: claudeListingParams([b64(await file.arrayBuffer())], buildUserText(it.hint ?? "", it.barcode ?? "", describeBarcode(facts))),
      });
    }
    for (const _ of missing) await recordUsage(user.id, NO_USAGE, true);
    if (missing.length) await db.from("items").update({ ai_status: "pending" }).in("id", missing);
    if (!requests.length) return json({ ok: true, submitted: 0 }, 200, origin);

    let batchId: string;
    try {
      batchId = (await anthropic.messages.batches.create({ requests })).id;
    } catch (err) {
      console.error("batch create failed", (err as Error).message);
      for (const _ of requests) await recordUsage(user.id, NO_USAGE, true);
      const kind = classifyClaudeError(err).kind;
      return await backToInstant(kind === "credit" ? "Claude credit has run out" : "Claude batch unavailable");
    }
    const submitted = requests.map((r) => r.custom_id);
    await admin.from("ai_batches").insert({ user_id: user.id, anthropic_batch_id: batchId, item_ids: submitted });
    await db.from("items").update({ ai_status: "batched", ai_error: null, ai_updated_at: new Date().toISOString() })
      .in("id", submitted);
    return json({ ok: true, submitted: submitted.length }, 200, origin);
  }

  // ---------------- poll ----------------
  const { data: open } = await admin.from("ai_batches").select("id,anthropic_batch_id,item_ids")
    .eq("user_id", user.id).eq("status", "in_progress").is("finished_at", null).limit(10);
  let saved = 0, pending = 0;
  for (const b of open ?? []) {
    let status: string;
    try {
      status = (await anthropic.messages.batches.retrieve(b.anthropic_batch_id)).processing_status;
    } catch (err) {
      console.error("batch retrieve failed", (err as Error).message);
      pending++;
      continue;
    }
    if (status !== "ended") { pending++; continue; }

    // Claim it so two open devices don't both process (and double-count) the same batch.
    const { data: claimed } = await admin.from("ai_batches").update({ finished_at: new Date().toISOString() })
      .eq("id", b.id).is("finished_at", null).select("id");
    if (!claimed?.length) continue;

    const allowed = new Set<string>(b.item_ids);
    const seen = new Set<string>();
    try {
      for await (const r of await anthropic.messages.batches.results(b.anthropic_batch_id)) {
        if (!allowed.has(r.custom_id) || seen.has(r.custom_id)) continue;
        seen.add(r.custom_id);
        const stamp = new Date().toISOString();
        if (r.result.type !== "succeeded") {
          await recordUsage(user.id, NO_USAGE, true);
          await db.from("items").update({ ai_status: "failed", ai_error: "AI didn't finish this one - tap retry", ai_updated_at: stamp })
            .eq("id", r.custom_id);
          continue;
        }
        try {
          const result = claudeMessageToResult(r.result.message, true);
          const { data: row } = await db.from("items").select("barcode,price_check").eq("id", r.custom_id).maybeSingle();
          const listing = applyBarcodeFacts(sanitizeListing(result.raw), await barcodeInfo(row?.barcode ?? "", { lookup: false }));
          await recordUsage(user.id, {
            input: result.inputTokens, output: result.outputTokens, searches: 0, costMicro: result.costMicroUsd, gemini: false,
          }, false);
          await db.from("items").update({
            ...listing, start_price: null, buy_now_price: null, price_check: withIdea(row?.price_check, aiIdea(listing, "claude")),
            ai_provider: "claude", ai_status: "done", ai_error: null, ai_updated_at: stamp,
          })
            .eq("id", r.custom_id).eq("ai_status", "batched");
          saved++;
        } catch {
          await db.from("items").update({ ai_status: "failed", ai_error: "AI answer was not usable - tap retry", ai_updated_at: stamp })
            .eq("id", r.custom_id);
        }
      }
      await admin.from("ai_batches").update({ status: "done" }).eq("id", b.id);
    } catch (err) {
      console.error("batch results failed", (err as Error).message);
      await admin.from("ai_batches").update({ status: "failed" }).eq("id", b.id);
      await db.from("items").update({ ai_status: "pending" }).in("id", b.item_ids).eq("ai_status", "batched");
    }
    await db.storage.from("photos").remove(b.item_ids.map(aiPath));
  }
  return json({ ok: true, saved, pending }, 200, origin);
});

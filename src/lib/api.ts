import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { blobToBase64, readBarcode, renderFinal, stitchForAi, type Processed } from "./image";
import { DEFAULT_PREFS, type Batch, type Item, type Photo, type PriceCheck, type Settings } from "./types";

const BUCKET = "photos";
export const AI_PHOTOS_PER_ITEM = 2; // front + back, merged into one small image for the AI

function check<T>(res: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (res.error) throw new Error(res.error.message);
  if (res.data === null || res.data === undefined) throw new Error("Not found");
  return res.data as NonNullable<T>;
}

function ok(res: { error: { message: string } | null }): void {
  if (res.error) throw new Error(res.error.message);
}

export const thumbPath = (p: string) => p.replace(/\.jpg$/, "_t.jpg");
export const whitePath = (p: string) => p.replace(/\.jpg$/, "_w.jpg");
export const whiteThumbPath = (p: string) => p.replace(/\.jpg$/, "_wt.jpg");
export const showsWhite = (p: Photo) => p.use_white && p.bg_status === "done";

// ---------- batches ----------
export async function listBatches(): Promise<(Batch & { items: { count: number }[] })[]> {
  return check(await supabase.from("batches").select("id,name,created_at,items(count)").order("created_at", { ascending: false }));
}

export async function createBatch(name: string): Promise<Batch> {
  return check(await supabase.from("batches").insert({ name: name.trim().slice(0, 80) || "New batch" }).select().single());
}

export async function deleteBatch(id: string): Promise<void> {
  const photos = check(await supabase.from("photos").select("storage_path, item_id, items!inner(batch_id)").eq("items.batch_id", id));
  await removeFiles(photos.map((p) => p.storage_path));
  await removeExports(photos.map((p) => ({ uid: p.storage_path.split("/")[0], itemId: p.item_id })));
  ok(await supabase.from("batches").delete().eq("id", id));
}

// ---------- items ----------
export async function listItems(batchId: string): Promise<Item[]> {
  const rows = check(await supabase.from("items").select("*, photos(*)").eq("batch_id", batchId)
    .order("position").order("position", { referencedTable: "photos" }));
  return rows as Item[];
}

export async function getItem(id: string): Promise<Item> {
  return check(await supabase.from("items").select("*, photos(*)").eq("id", id)
    .order("position", { referencedTable: "photos" }).single()) as Item;
}

export async function createItem(batchId: string, position: number): Promise<Item> {
  const row = check(await supabase.from("items").insert({ batch_id: batchId, position }).select().single());
  return { ...(row as Item), photos: [] };
}

type EditableItem = Partial<Omit<Item, "id" | "batch_id" | "photos" | "ai_status" | "ai_error" | "ai_updated_at" | "price_check" | "price_checked_at">>;
export async function updateItem(id: string, patch: EditableItem & { ai_status?: "pending" | "skipped" }): Promise<void> {
  ok(await supabase.from("items").update(patch).eq("id", id));
}

export async function deleteItem(item: Item): Promise<void> {
  await removeFiles(item.photos.map((p) => p.storage_path));
  if (item.photos[0]) await removeExports([{ uid: item.photos[0].storage_path.split("/")[0], itemId: item.id }]);
  ok(await supabase.from("items").delete().eq("id", item.id));
}

async function removeExports(list: { uid: string; itemId: string }[]): Promise<void> {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const { uid, itemId } of list) {
    if (seen.has(itemId)) continue;
    seen.add(itemId);
    for (let n = 1; n <= 20; n++) paths.push(`${uid}/export/${itemId}/${n}.jpg`);
    paths.push(`${uid}/${itemId}/ai.jpg`);
  }
  for (let i = 0; i < paths.length; i += 100) await supabase.storage.from(BUCKET).remove(paths.slice(i, i + 100));
}

/** Move all photos of `item` onto `target` (fixes grouping mistakes), then delete `item`. */
export async function mergeInto(target: Item, item: Item): Promise<void> {
  let pos = target.photos.length;
  for (const p of item.photos) {
    ok(await supabase.from("photos").update({ item_id: target.id, position: pos++, crop: null }).eq("id", p.id));
  }
  ok(await supabase.from("items").delete().eq("id", item.id));
  await updateItem(target.id, { ai_status: "pending" });
}

// ---------- photos ----------
const blobCache = new Map<string, Blob>();

export async function addPhoto(userId: string, item: Item, processed: Processed, position: number): Promise<Photo> {
  const id = crypto.randomUUID();
  const path = `${userId}/${item.id}/${id}.jpg`;
  const opts = { contentType: "image/jpeg", upsert: false, cacheControl: "31536000" };
  await retry(async () => check(await supabase.storage.from(BUCKET).upload(path, processed.main, opts)));
  await retry(async () => check(await supabase.storage.from(BUCKET).upload(thumbPath(path), processed.thumb, opts)));
  blobCache.set(path, processed.main);
  return check(await supabase.from("photos").insert({
    id, item_id: item.id, storage_path: path, position, width: processed.width, height: processed.height,
  }).select().single()) as Photo;
}

export async function updatePhoto(id: string, patch: Partial<Pick<Photo, "rotation" | "crop" | "position" | "use_white">>): Promise<void> {
  ok(await supabase.from("photos").update(patch).eq("id", id));
}

export async function deletePhoto(photo: Photo): Promise<void> {
  await removeFiles([photo.storage_path]);
  ok(await supabase.from("photos").delete().eq("id", photo.id));
}

async function removeFiles(paths: string[]): Promise<void> {
  const all = paths.flatMap((p) => [p, thumbPath(p), whitePath(p), whiteThumbPath(p)]);
  for (let i = 0; i < all.length; i += 100) {
    await supabase.storage.from(BUCKET).remove(all.slice(i, i + 100));
  }
}

export async function downloadPhoto(path: string): Promise<Blob> {
  const cached = blobCache.get(path);
  if (cached) return cached;
  const blob = check(await supabase.storage.from(BUCKET).download(path)) as Blob;
  blobCache.set(path, blob);
  return blob;
}

const urlCache = new Map<string, { url: string; expires: number }>();
/** Short-lived signed URLs: photos are never public. */
export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  const now = Date.now();
  const out: Record<string, string> = {};
  const missing = paths.filter((p) => {
    const c = urlCache.get(p);
    if (c && c.expires > now + 60_000) { out[p] = c.url; return false; }
    return true;
  });
  for (let i = 0; i < missing.length; i += 100) {
    const data = check(await supabase.storage.from(BUCKET).createSignedUrls(missing.slice(i, i + 100), 3600));
    for (const d of data) {
      if (d.signedUrl && d.path) {
        urlCache.set(d.path, { url: d.signedUrl, expires: now + 3600_000 });
        out[d.path] = d.signedUrl;
      }
    }
  }
  return out;
}

// ---------- AI ----------
async function invoke<T>(fn: string, body: Record<string, unknown>, fallbackMsg: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    let msg = fallbackMsg;
    if (error instanceof FunctionsHttpError) {
      try { msg = (await error.context.json()).error ?? msg; } catch { /* keep default */ }
    }
    throw new Error(msg);
  }
  return data as T;
}

/** Read a barcode (free, on device) and build the single combined photo the AI will see. */
async function prepareAi(item: Item): Promise<{ image: Blob; barcode: string }> {
  const photos = item.photos.slice(0, AI_PHOTOS_PER_ITEM);
  if (!photos.length) throw new Error("Add a photo first");
  const blobs = await Promise.all(photos.map((p) => downloadPhoto(p.storage_path)));
  let barcode = item.barcode;
  if (!barcode) {
    for (const b of blobs) {
      barcode = await readBarcode(b);
      if (barcode) break;
    }
    if (barcode) await updateItem(item.id, { barcode });
  }
  return { image: await stitchForAi(blobs), barcode };
}

/** Instant mode: write the listing now. */
export async function analyzeItem(item: Item): Promise<void> {
  const { image, barcode } = await prepareAi(item);
  await invoke("analyze-item", {
    itemId: item.id, images: [await blobToBase64(image)], hint: item.hint.slice(0, 300), barcode,
  }, "AI request failed");
}

export const aiImagePath = (userId: string, itemId: string) => `${userId}/${itemId}/ai.jpg`;

/** Economy mode step 1: store the combined photo and mark the item as queued for the next batch. */
export async function queueForEconomy(userId: string, item: Item): Promise<void> {
  const { image } = await prepareAi(item);
  await retry(async () => check(await supabase.storage.from(BUCKET)
    .upload(aiImagePath(userId, item.id), image, { contentType: "image/jpeg", upsert: true })));
  ok(await supabase.from("items").update({ ai_status: "queued", ai_error: null }).eq("id", item.id));
}

/** Economy mode step 2: send everything queued as one half-price batch. */
export function submitEconomy(): Promise<{ submitted: number; instant?: boolean; reason?: string }> {
  return invoke("ai-batch", { action: "submit" }, "Couldn't send the batch");
}

/** Economy mode step 3: collect finished listings. */
export function pollEconomy(): Promise<{ saved: number; pending: number }> {
  return invoke("ai-batch", { action: "poll" }, "Couldn't check the batch");
}

export async function usageToday(): Promise<{
  calls: number; input_tokens: number; output_tokens: number; est_cost_micro_usd: number; gemini_calls: number;
} | null> {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland" }).format(new Date());
  const { data } = await supabase.from("ai_usage").select("calls,input_tokens,output_tokens,est_cost_micro_usd,gemini_calls")
    .eq("day", today).maybeSingle();
  return data;
}

async function retry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
}

/** The photo to use for Trade Me: the white-background version when there is one and it's switched on. */
export async function renderPhoto(p: Photo): Promise<Blob> {
  const white = showsWhite(p);
  const src = await downloadPhoto(white ? whitePath(p.storage_path) : p.storage_path);
  return renderFinal(src, p.rotation, white ? null : p.crop); // white versions are already cropped
}

// ---------- white backgrounds (runs on this device) ----------
const BRIGHTEN_REASONS = {
  dark: "Background too dark – shoot on white card or a sheet, in good light.",
  busy: "Background isn't plain – shoot on plain white or light card.",
  "no-item": "Couldn't tell the item apart from the background.",
};

/**
 * White background for one photo, made on this device. Returns true, or the reason it was skipped
 * (the original photo is kept). "brighten" only ever changes the plain background, never the item.
 */
export async function makeWhite(p: Photo, method: "brighten" | "cutout" = "brighten"): Promise<true | string> {
  const original = await downloadPhoto(p.storage_path);
  let result: { main: Blob; thumb: Blob } | null;
  let reason = "Couldn't find a clear item in that photo – keeping the original.";
  if (method === "brighten") {
    const { brightenBackground } = await import("./brighten");
    const r = await brightenBackground(original);
    result = "failed" in r ? null : r;
    if ("failed" in r) reason = BRIGHTEN_REASONS[r.failed];
  } else {
    const { whiteBackground } = await import("./bgremove"); // loaded only when needed (keeps the app fast to open)
    result = await whiteBackground(original);
  }
  if (!result) {
    ok(await supabase.from("photos").update({ bg_status: "failed" }).eq("id", p.id));
    return reason;
  }
  const opts = { contentType: "image/jpeg", upsert: true, cacheControl: "60" };
  await retry(async () => check(await supabase.storage.from(BUCKET).upload(whitePath(p.storage_path), result.main, opts)));
  await retry(async () => check(await supabase.storage.from(BUCKET).upload(whiteThumbPath(p.storage_path), result.thumb, opts)));
  blobCache.set(whitePath(p.storage_path), result.main);
  urlCache.delete(whiteThumbPath(p.storage_path));
  urlCache.delete(whitePath(p.storage_path));
  ok(await supabase.from("photos").update({ bg_status: "done" }).eq("id", p.id));
  return true;
}

// ---------- online price check ----------
export function priceCheck(item: Item): Promise<{ applied: boolean; source: string; check: PriceCheck }> {
  return invoke("price-check", { itemId: item.id }, "Price check failed");
}

// ---------- settings (shared between phone and desktop) ----------
export async function getSettings(): Promise<Settings> {
  const { data } = await supabase.from("settings").select("prefs,tm_template,category_map").maybeSingle();
  return {
    prefs: { ...DEFAULT_PREFS, ...(data?.prefs ?? {}), tm: { ...DEFAULT_PREFS.tm, ...(data?.prefs?.tm ?? {}) } },
    tm_template: data?.tm_template ?? null,
    category_map: data?.category_map ?? {},
  };
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  ok(await supabase.from("settings").upsert({ user_id: user.id, ...patch, updated_at: new Date().toISOString() }));
}

/** Remember "AI category path -> Trade Me category code" so the next similar item gets it automatically. */
export async function rememberCategory(path: string, code: string): Promise<void> {
  if (!path || !code) return;
  const s = await getSettings();
  if (s.category_map[path] === code) return;
  const map = { ...s.category_map, [path]: code };
  const keys = Object.keys(map);
  if (keys.length > 500) delete map[keys[0]];
  await saveSettings({ category_map: map });
}

// ---------- Trade Me export ----------
/** Render final photos (crop/rotate/white) and upload them so Trade Me can fetch them by link. */
export async function exportPhotoLinks(userId: string, item: Item): Promise<string[]> {
  const links: string[] = [];
  for (const [n, p] of item.photos.slice(0, 20).entries()) {
    const path = `${userId}/export/${item.id}/${n + 1}.jpg`;
    const blob = await renderPhoto(p);
    await retry(async () => check(await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: true })));
    const signed = check(await supabase.storage.from(BUCKET).createSignedUrl(path, 14 * 24 * 3600));
    links.push(signed.signedUrl);
  }
  return links;
}

export async function markExported(ids: string[], listed: boolean): Promise<void> {
  if (!ids.length) return;
  ok(await supabase.from("items").update({ exported_at: new Date().toISOString(), ...(listed ? { status: "listed" } : {}) }).in("id", ids));
}

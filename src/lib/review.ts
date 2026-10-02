// Review flow: approve moves on to the next listing that's ready, with Undo and a "done" screen at the end.
import { showsWhite, signedUrls, thumbPath, whitePath, whiteThumbPath } from "./api";
import type { Item } from "./types";

/** Same order as the home screen: newest day first, items in the order they were photographed. */
export function reviewOrder(items: Item[]): Item[] {
  const groups: Item[][] = [];
  const index = new Map<string, number>();
  for (const i of items) {
    if (!index.has(i.batch_id)) { index.set(i.batch_id, groups.length); groups.push([]); }
    groups[index.get(i.batch_id)!].push(i);
  }
  return groups.flatMap((g) => [...g].sort((a, b) => a.position - b.position));
}

const isReady = (i: Item) => i.status === "draft" && i.ai_status === "done";
const isWriting = (i: Item) => i.status === "draft" && i.ai_status !== "done" && i.photos.length > 0;

/** The next draft the AI has finished (after `currentId`, wrapping round), and how many are still being written. */
export function nextReady(items: Item[], currentId: string | null): { next: Item | null; left: number; writing: number } {
  const order = reviewOrder(items);
  const at = currentId ? order.findIndex((i) => i.id === currentId) : -1;
  const after = at >= 0 ? [...order.slice(at + 1), ...order.slice(0, at)] : order;
  return {
    next: after.find(isReady) ?? null,
    left: order.filter(isReady).length,
    writing: order.filter(isWriting).length,
  };
}

/** Warm the browser cache with the next item's photos so moving on feels instant. */
export function prefetchPhotos(item: Item | null): void {
  if (!item) return;
  const paths = item.photos.flatMap((p) => showsWhite(p)
    ? [whitePath(p.storage_path), whiteThumbPath(p.storage_path)]
    : [p.storage_path, thumbPath(p.storage_path)]);
  signedUrls(paths).then((urls) => {
    for (const u of Object.values(urls)) { const img = new Image(); img.src = u; }
  }).catch(() => {});
}

// ---------- Undo for the last approve (kept for a few seconds, in this tab only) ----------
const UNDO_KEY = "klicklist-undo";
const UNDO_MS = 8000;

export function rememberApproved(id: string, title: string): void {
  try { sessionStorage.setItem(UNDO_KEY, JSON.stringify({ id, title, at: Date.now() })); } catch { /* private mode */ }
}

export function pendingUndo(currentId: string): { id: string; title: string; msLeft: number } | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(UNDO_KEY) ?? "null") as { id: string; title: string; at: number } | null;
    const msLeft = v ? UNDO_MS - (Date.now() - v.at) : 0;
    return v && v.id !== currentId && msLeft > 0 ? { id: v.id, title: v.title, msLeft } : null;
  } catch {
    return null;
  }
}

export function clearUndo(): void {
  try { sessionStorage.removeItem(UNDO_KEY); } catch { /* ignore */ }
}

// ---------- "4 of 23" progress for one review run ----------
const RUN_KEY = "klicklist-review-total";
export function startReviewRun(total: number): void {
  try { sessionStorage.setItem(RUN_KEY, String(total)); } catch { /* ignore */ }
}
export function reviewProgress(left: number): string {
  let total = 0;
  try { total = Number(sessionStorage.getItem(RUN_KEY)) || 0; } catch { /* ignore */ }
  if (total < left) { total = left; startReviewRun(total); }
  return `${total - left + 1} of ${total}`;
}

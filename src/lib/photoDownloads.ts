import type { Item, Photo } from "./types";

/** Flat, portable filenames for manual upload; duplicate titles never overwrite photos. */
export function photoDownloadEntries(items: Item[]): { photo: Photo; name: string }[] {
  const used = new Set<string>();
  const entries: { photo: Photo; name: string }[] = [];
  for (const item of items) {
    if (!item.photos.length) continue;
    let title = item.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 100).trim();
    if (!title) title = "Untitled item";
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(title)) title = `Item ${title}`;
    let base = title, suffix = 2;
    while (used.has(base.toLowerCase())) base = `${title} (${suffix++})`;
    used.add(base.toLowerCase());
    const photos = [...item.photos].sort((a, b) => a.position - b.position);
    photos.forEach((photo, n) => entries.push({ photo, name: `${base} ${n + 1}.jpg` }));
  }
  return entries;
}

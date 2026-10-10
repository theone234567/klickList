/** Compact, collision-free UUID encoding keeps signed photo URLs within Trade Me's limit. */
export function exportPhotoPath(userId: string, itemId: string, photoNumber: number): string {
  const hex = itemId.replace(/-/g, "");
  if (!/^[a-f0-9]{32}$/i.test(hex)) throw new Error("Invalid item ID");
  const bytes = hex.match(/../g)!.map((pair) => String.fromCharCode(parseInt(pair, 16))).join("");
  const shortId = btoa(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${userId}/e/${shortId}/${photoNumber}.jpg`;
}

export function checkExportPhotoUrl(url: string): string {
  if (url.length > 500) {
    throw new Error("This photo link exceeds Trade Me's 500-character limit. Choose ZIP with photo files instead.");
  }
  return url;
}

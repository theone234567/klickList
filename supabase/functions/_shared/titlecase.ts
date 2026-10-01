// Proper capitals for listing titles: "shrek 2 dvd region 4" -> "Shrek 2 DVD Region 4".
// Only used when a title has no capitals at all (or is ALL CAPS); titles with any mixed case are left alone.

const SMALL = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with", "vs"]);
const SPECIAL: Record<string, string> = {
  dvd: "DVD", dvds: "DVDs", cd: "CD", cds: "CDs", lp: "LP", ep: "EP", vhs: "VHS", tv: "TV", nz: "NZ", uk: "UK", usa: "USA",
  us: "US", usb: "USB", hdmi: "HDMI", hd: "HD", uhd: "UHD", "4k": "4K", led: "LED", lcd: "LCD", pc: "PC", ps1: "PS1",
  ps2: "PS2", ps3: "PS3", ps4: "PS4", ps5: "PS5", psp: "PSP", xbox: "Xbox", gb: "GB", tb: "TB", mb: "MB", ml: "ml",
  kg: "kg", mm: "mm", cm: "cm", iphone: "iPhone", ipad: "iPad", ipod: "iPod", imac: "iMac", macbook: "MacBook",
  "blu-ray": "Blu-ray", bluray: "Blu-ray", r1: "R1", r2: "R2", r3: "R3", r4: "R4", r5: "R5", r6: "R6",
  dc: "DC", ac: "AC", ii: "II", iii: "III", iv: "IV", vi: "VI", vii: "VII", viii: "VIII", ix: "IX", xl: "XL", xxl: "XXL",
  xs: "XS", nes: "NES", snes: "SNES", "3ds": "3DS", ds: "DS", wii: "Wii", lego: "LEGO", bbc: "BBC", abc: "ABC",
};

function word(w: string, first: boolean): string {
  const lower = w.toLowerCase();
  const core = lower.replace(/^[("'[]+|[)"'\],.:;!?]+$/g, "");
  if (SPECIAL[core]) return lower.replace(core, SPECIAL[core]);
  if (!first && SMALL.has(core)) return lower;
  if (/^\d+(gb|tb|mb|mm|cm|kg|ml|v|w|l)$/.test(core)) return lower.replace(/(gb|tb|mb)$/, (u) => u.toUpperCase());
  // Capitalise each part of hyphenated words: "spider-man" -> "Spider-Man"
  return lower.replace(/(^|[-("'/[])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase());
}

export function fixTitleCase(title: string): string {
  const letters = title.replace(/[^A-Za-z]/g, "");
  const allLower = letters === letters.toLowerCase();
  const allUpper = letters.length > 3 && letters === letters.toUpperCase();
  if (!letters || (!allLower && !allUpper)) return title;
  return title.split(/(\s+)/).map((w, i) => (/\s/.test(w) ? w : word(w, i === 0))).join("");
}

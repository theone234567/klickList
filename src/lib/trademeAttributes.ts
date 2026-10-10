import type { Item } from "./types";

/** Trade Me's CSV uses Name=Value pairs, not the description's detail lines. */
export function tradeMeAttributes(item: Item): string {
  const get = (name: string) => item.attributes.find((a) => a.name.trim().toLowerCase() === name)?.value.trim() ?? "";
  const clean = (value: string) => value.replace(/[;=\r\n]/g, " ").trim();
  const result: string[] = [];
  const region = get("region");
  if (region) {
    // Verified against a saved Trade Me Blu-ray product exported by the user.
    const value = /^(?:region\s*)?b(?:\s*\([^)]*\))?$/i.test(region) ? "B (NZ)" : region.replace(/^region\s+/i, "");
    result.push(`Region=${clean(value)}`);
  }
  result.push(`Condition=${clean(get("condition") || "Good")}`);
  return result.join(";");
}

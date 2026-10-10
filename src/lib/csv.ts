import type { Item } from "./types";

/** Quote a CSV cell and defuse spreadsheet formula injection (=, +, -, @ at the start). */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

export function itemsToCsv(items: Item[]): string {
  const header = ["Title", "Subtitle", "Description", "Category", "Condition", "Start price", "Buy now",
    "Shipping", "Weight kg", "Details", "Status"];
  const rows = items.map((i) => [
    i.title, i.subtitle, i.description, i.category_path, i.condition, i.start_price, i.buy_now_price,
    i.shipping_size, i.weight_kg, i.attributes.map((a) => `${a.name}: ${a.value}`).join("; "), i.status,
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

/** Full text for pasting into Trade Me's description box. */
export function fullDescription(item: Item): string {
  const nameKey = (name: string) => {
    const key = name.trim().toLowerCase();
    return key === "type" ? "format" : key;
  };
  const valueKey = (name: string, value: string) => {
    const clean = value.trim().toLowerCase().replace(/[.!]+$/, "");
    // The same numbered DVD region can have different explanatory country labels.
    const region = name === "region" && clean.match(/^(?:region\s*)?(\d+)\s*(?:\([^)]*\))?$/);
    return region ? region[1] : clean.replace(/\s+/g, " ");
  };
  const seen = new Set<string>();
  for (const line of item.description.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:[-*•]\s*)?([^:]+):\s*(.+)$/);
    if (match) {
      const name = nameKey(match[1]);
      seen.add(`${name}:${valueKey(name, match[2])}`);
    }
  }
  const details = item.attributes.filter((a) => {
    const name = nameKey(a.name);
    const key = `${name}:${valueKey(name, a.value)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((a) => `${a.name}: ${a.value}`).join("\n");
  return [item.description.trim(), details].filter(Boolean).join("\n\n");
}

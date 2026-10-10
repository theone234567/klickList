import type { Item } from "./types";
import { regionFromBarcode, withRegionArea } from "../../supabase/functions/_shared/barcode";

/** Fill editable review defaults without replacing facts already saved on an item. */
export function approvalDefaults(item: Item): Item {
  const attributes = [...item.attributes];
  let needsCheck = item.needs_check;
  if (!attributes.some((a) => /^condition$/i.test(a.name.trim()) && a.value.trim())) {
    const empty = attributes.findIndex((a) => /^condition$/i.test(a.name.trim()));
    const value = { name: "Condition", value: "Good" };
    if (empty >= 0) attributes[empty] = value;
    else attributes.push(value);
  }
  if (!attributes.some((a) => /^region$/i.test(a.name.trim()) && a.value.trim())) {
    const match = item.description.match(/(?:^|\n)\s*(?:[-*•]\s*)?Region:\s*([^\n]+)/i)
      ?? item.title.match(/\b(Region\s+(?:[1-6ABC]|free))\b/i);
    if (match) {
      const value = { name: "Region", value: match[1].trim().replace(/\.$/, "") };
      const empty = attributes.findIndex((a) => /^region$/i.test(a.name.trim()));
      if (empty >= 0) attributes[empty] = value;
      else attributes.push(value);
    } else {
      const format = `${item.title} ${item.category_path} ${attributes.filter((a) => /^(?:type|format)$/i.test(a.name)).map((a) => a.value).join(" ")}`;
      const barcodeRegion = regionFromBarcode(item.barcode ?? "");
      const inferred = barcodeRegion && (/blu.?ray/i.test(format) ? barcodeRegion.bluRay : /dvd/i.test(format) ? barcodeRegion.dvd : null);
      if (inferred) {
        const value = { name: "Region", value: withRegionArea(inferred) };
        const empty = attributes.findIndex((a) => /^region$/i.test(a.name.trim()));
        if (empty >= 0) attributes[empty] = value;
        else attributes.push(value);
        const note = "Region inferred from barcode — check the disc or case.";
        needsCheck = [...(item.needs_check ?? []).filter((value) => value !== note), note];
      }
    }
  }
  return { ...item, attributes, needs_check: needsCheck };
}

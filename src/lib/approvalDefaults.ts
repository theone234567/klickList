import type { Item } from "./types";

/** Fill editable review defaults without replacing facts already saved on an item. */
export function approvalDefaults(item: Item): Item {
  const attributes = [...item.attributes];
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
    }
  }
  return { ...item, attributes };
}

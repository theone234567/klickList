import { expect, it } from "vitest";
import { approvalDefaults } from "./approvalDefaults";
import type { Item } from "./types";

it("fills Good and recovers an explicitly stated region without mutating the item", () => {
  const item = { title: "DVD", description: "- Region: 2 (UK).", attributes: [] } as unknown as Item;
  const result = approvalDefaults(item);
  expect(result.attributes).toContainEqual({ name: "Condition", value: "Good" });
  expect(result.attributes).toContainEqual({ name: "Region", value: "2 (UK)" });
  expect(item.attributes).toEqual([]);
});

it("preserves reviewed condition and region, and leaves unknown regions unset", () => {
  const item = { title: "DVD", description: "", attributes: [{ name: "Condition", value: "Acceptable" }, { name: "Region", value: "4" }] } as unknown as Item;
  expect(approvalDefaults(item).attributes).toEqual(item.attributes);
  expect(approvalDefaults({ ...item, attributes: [] }).attributes.some((a) => a.name === "Region")).toBe(false);
});

it("shows a barcode-derived region for discs with a verification warning", () => {
  const item = { title: "Blu-ray", category_path: "Movies-TV", description: "", barcode: "9400000000000", attributes: [], needs_check: [] } as unknown as Item;
  const result = approvalDefaults(item);
  expect(result.attributes.find((a) => a.name === "Region")?.value).toContain("Region B");
  expect(result.needs_check).toContain("Region inferred from barcode — check the disc or case.");
});

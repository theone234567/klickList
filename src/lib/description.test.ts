import { expect, it } from "vitest";
import { fullDescription } from "./csv";
import type { Item } from "./types";

it("keeps description text and appends only details not already represented", () => {
  const item = {
    description: "- Complete series 1 and 2.\n- Format: DVD.\n- Region: 2 (UK).",
    attributes: [
      { name: "Type", value: "DVD" },
      { name: "Region", value: "Region 2 (UK/Europe/Japan)" },
      { name: "Brand", value: "BBC" },
      { name: "Format", value: "DVD" },
      { name: "Genre", value: "Comedy" },
    ],
  } as Item;
  expect(fullDescription(item)).toBe(item.description + "\n\nBrand: BBC\nGenre: Comedy");
});

it("does not hide different values or attributes only loosely mentioned in prose", () => {
  const item = {
    description: "A DVD set.\nRegion: 2",
    attributes: [{ name: "Region", value: "4" }, { name: "Format", value: "DVD" }],
  } as Item;
  expect(fullDescription(item)).toContain("Region: 4\nFormat: DVD");
});

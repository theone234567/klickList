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
  expect(fullDescription(item)).toBe("A DVD set.\nRegion: 2\n\nRegion: 4");
});

it("avoids the sentence-form repetitions shown in the user's DVD description", () => {
  const item = {
    description: "- The Complete Oh Doctor Beeching! - First and Second Series.\n- Contains episodes from the British comedy television programme.\n- DVD format.\n- Region 2.\n- Used condition.\n- Case and artwork included.",
    attributes: [{ name: "Type", value: "DVD" }, { name: "Region", value: "Region 2 (UK/Europe/Japan)" }, { name: "Brand", value: "BBC" }, { name: "Series", value: "1 and 2" }, { name: "Genre", value: "Comedy" }, { name: "Language", value: "English" }, { name: "Condition", value: "Good" }],
  } as Item;
  expect(fullDescription(item, true)).toBe(item.description + "\n\nBrand: BBC\nLanguage: English");
});

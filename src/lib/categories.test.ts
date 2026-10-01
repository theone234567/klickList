import { describe, expect, it } from "vitest";
import data from "../data/trademe-categories.json";
import { allowedDuration, searchCategories, suggestCategories, type TmCategory } from "./categories";

const cats = data as TmCategory[];
const best = (title: string, category_path: string, attrs: Record<string, string> = {}) =>
  suggestCategories({ title, category_path, attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })) }, cats, 1)[0];

describe("Trade Me category matching", () => {
  it.each([
    ["Shrek 2 DVD", "Movies & TV > DVDs > Animated", {}, 6211],
    ["The Dark Knight Blu-ray", "Movies & TV > Blu-ray > Action", {}, 9233],
    ["Friends complete series DVD box set", "Movies & TV > DVDs > TV Series", {}, 1424],
    ["The Fellowship of the Ring paperback", "Books > Fiction > Fantasy", { Author: "J.R.R. Tolkien" }, 4518],
    ["Lee Child Killing Floor", "Books > Fiction > Thriller", { Author: "Lee Child" }, 4487],
    ["Sony PS4 controller DualShock", "Gaming > PlayStation 4 > Controllers", {}, 9907],
    ["Nike Air Max mens shoes size 10", "Clothing & Fashion > Men > Shoes", {}, 168],
    ["Breville kettle 1.7L", "Home & Living > Kitchen > Appliances > Kettles", {}, 2541],
    ["iPhone 11 64GB black", "Mobile Phones > iPhone > iPhone 11", {}, 5475],
    ["Lego Star Wars X-wing 75218", "Toys & Models > Lego > Star Wars", {}, 6809],
    ["Makita 18V drill", "Building & Renovation > Tools > Power tools > Drills", {}, 6016],
    ["Abba - Gold CD", "Music & Instruments > CDs > Pop", {}, 2161],
    ["Crown Lynn vase", "Pottery & Glass > Crown Lynn", {}, 7501],
  ])("%s", (title, path, attrs, id) => {
    expect(best(title, path, attrs)?.[0]).toBe(id);
  });
  it("searches by words or number", () => {
    expect(searchCategories("dvd comedy", cats)[0][0]).toBe(534);
    expect(searchCategories("534", cats).some((c) => c[0] === 534)).toBe(true);
  });
  it("uses a listing length the category allows", () => {
    expect(allowedDuration([1, "x"], 7)).toBe(7);
    expect(allowedDuration([1, "x", "21,28,42,56"], 7)).toBe(21);
  });
});

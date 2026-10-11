import { expect, it } from "vitest";
import { photoDownloadEntries, togglePhotoSelection } from "./photoDownloads";
import type { Item, Photo } from "./types";
const item = (title: string, positions = [0, 1]) => ({ title, photos: positions.map((position) => ({ position } as Photo)) } as Item);

it("selects multiple items independently without clearing earlier selections", () => {
  const initial = new Set<string>();
  const one = togglePhotoSelection(initial, "first");
  const two = togglePhotoSelection(one, "second");
  expect([...two]).toEqual(["first", "second"]);
  expect([...togglePhotoSelection(two, "first")]).toEqual(["second"]);
  expect([...one]).toEqual(["first"]);
  expect(initial.size).toBe(0);
});

it("numbers each item's photos in display order and avoids collisions between equal titles", () => {
  const entries = photoDownloadEntries([item("Doctor Beeching", [1, 0]), item("Doctor Beeching"), item("Doctor Beeching (2)")]);
  expect(entries.map((x) => x.name)).toEqual(["Doctor Beeching 1.jpg", "Doctor Beeching 2.jpg", "Doctor Beeching (2) 1.jpg", "Doctor Beeching (2) 2.jpg", "Doctor Beeching (2) (2) 1.jpg", "Doctor Beeching (2) (2) 2.jpg"]);
  expect(entries[0].photo.position).toBe(0);
});

it("handles unsafe or empty titles and includes every photo", () => {
  const entries = photoDownloadEntries([item("../DVD: test?"), item(""), item("CON"), item("No photos", []), item("Many", Array.from({ length: 25 }, (_, i) => i))]);
  expect(entries.every((e) => !/[<>:"/\\|?*]/.test(e.name))).toBe(true);
  expect(entries.some((e) => e.name === "Untitled item 1.jpg")).toBe(true);
  expect(entries.some((e) => e.name === "Item CON 1.jpg")).toBe(true);
  expect(entries.some((e) => e.name === "Many 25.jpg")).toBe(true);
});

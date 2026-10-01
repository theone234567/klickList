import { describe, expect, it } from "vitest";
import { fixTitleCase } from "./titlecase";

describe("title capitals", () => {
  it.each([
    ["shrek 2 dvd region 4", "Shrek 2 DVD Region 4"],
    ["the lord of the rings blu-ray r4", "The Lord of the Rings Blu-ray R4"],
    ["sony ps4 dualshock controller", "Sony PS4 Dualshock Controller"],
    ["iphone 11 64gb black", "iPhone 11 64GB Black"],
    ["spider-man: homecoming dvd", "Spider-Man: Homecoming DVD"],
    ["HARRY POTTER BOX SET", "Harry Potter Box Set"],
  ])("%s", (input, want) => expect(fixTitleCase(input)).toBe(want));
  it("leaves titles that already have proper capitals alone", () => {
    expect(fixTitleCase("Abba Gold – Greatest Hits CD")).toBe("Abba Gold – Greatest Hits CD");
    expect(fixTitleCase("")).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { aiIdea, aiStart, ideasOf, withIdea } from "./ideas";

describe("price ideas", () => {
  const ai = aiIdea({ start_price: 4, buy_now_price: 8, price_reasoning: "Used DVDs sell $2-$8", price_confidence: "medium" }, "gemini");
  it("keeps every source side by side, replacing only the same kind", () => {
    let pc = withIdea(null, ai);
    pc = withIdea(pc, { ...ai, kind: "trademe", source: "Trade Me", start: 5 });
    pc = withIdea(pc, { ...ai, start: 6 });
    expect(ideasOf(pc).map((i) => [i.kind, i.start])).toEqual([["trademe", 5], ["ai", 6]]);
    expect(aiStart(pc)).toBe(6);
    expect(ai.source).toContain("Gemini");
  });
  it("reads the older single price check", () => {
    const old = { found: true, low: 2, high: 9, typical: 5, start: 3, buy_now: 7, summary: "Mostly $4-$8", sources: [{ url: "https://x.nz/a", title: "A" }, { url: "javascript:1", title: "bad" }] };
    const [i] = ideasOf(old);
    expect([i.kind, i.typical, i.note, i.links.length]).toEqual(["web", 5, "Mostly $4-$8", 1]);
  });
});

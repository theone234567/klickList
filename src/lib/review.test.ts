import { describe, expect, it, vi } from "vitest";
vi.mock("./api", () => ({ showsWhite: () => false, signedUrls: async () => ({}), thumbPath: (p: string) => p, whitePath: (p: string) => p, whiteThumbPath: (p: string) => p }));
import { nextReady, reviewOrder } from "./review";
import type { Item } from "./types";

const it_ = (id: string, batch: string, position: number, over: Partial<Item> = {}) =>
  ({ id, batch_id: batch, position, status: "draft", ai_status: "done", photos: [{}], ...over }) as unknown as Item;

describe("review flow", () => {
  // As listItems() returns them: newest day first, newest item first within the day.
  const items = [
    it_("t2", "today", 2), it_("t1", "today", 1, { ai_status: "pending" }), it_("t0", "today", 0),
    it_("y1", "yday", 1, { status: "ready" }), it_("y0", "yday", 0),
  ];
  it("orders like the home screen: newest day first, photographed order within a day", () => {
    expect(reviewOrder(items).map((i) => i.id)).toEqual(["t0", "t1", "t2", "y0", "y1"]);
  });
  it("moves to the next finished draft, skipping ones the AI is still writing", () => {
    expect(nextReady(items, "t0")).toMatchObject({ next: { id: "t2" }, left: 3, writing: 1 });
    expect(nextReady(items, "t2").next?.id).toBe("y0");
    expect(nextReady(items, "y0").next?.id).toBe("t0"); // wraps round
    expect(nextReady(items, null).next?.id).toBe("t0");
  });
  it("reports nothing left when every finished draft is approved", () => {
    const done = items.map((i) => (i.ai_status === "done" ? { ...i, status: "ready" as const } : i));
    expect(nextReady(done, "t0")).toMatchObject({ next: null, left: 0, writing: 1 });
  });
});

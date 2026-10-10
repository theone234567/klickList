import { expect, it } from "vitest";
import { tradeMeAttributes } from "./trademeAttributes";
import type { Item } from "./types";

it("matches the user's saved Trade Me Blu-ray attribute encoding", () => {
  const item = { attributes: [{ name: "Region", value: "Region B (NZ/Australia/UK/Europe)" }, { name: "Condition", value: "Good" }] } as Item;
  expect(tradeMeAttributes(item)).toBe("Region=B (NZ);Condition=Good");
});

it("exports edited condition, defaults missing condition to Good and prevents injected attributes", () => {
  expect(tradeMeAttributes({ attributes: [] } as unknown as Item)).toBe("Condition=Good");
  expect(tradeMeAttributes({ attributes: [{ name: "Condition", value: "Acceptable" }] } as Item)).toBe("Condition=Acceptable");
  expect(tradeMeAttributes({ attributes: [{ name: "Condition", value: "Good;Region=X" }] } as Item)).toBe("Condition=Good Region X");
});

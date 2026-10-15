import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("vitest harness", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });

  it("resolves the @ alias", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});

import { describe, expect, it } from "bun:test";

import { ensureRowsUpdated } from "./update-utils.ts";

describe("ensureRowsUpdated", () => {
  it("throws and logs when no rows are updated", () => {
    const originalError = console.error;
    const errors: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };

    try {
      expect(() => ensureRowsUpdated([], "doc-123", "completed")).toThrowError(
        /Supabase update did not affect any rows during completed/,
      );
    } finally {
      console.error = originalError;
    }

    expect(errors.length).toBe(1);
    expect(errors[0][0]).toBe("Supabase update did not affect any rows");
    expect(errors[0][1]).toEqual({ document_id: "doc-123", stage: "completed" });
  });

  it("does nothing when rows are updated", () => {
    expect(() => ensureRowsUpdated([{ id: "doc-123" }], "doc-123", "completed")).not.toThrow();
  });
});

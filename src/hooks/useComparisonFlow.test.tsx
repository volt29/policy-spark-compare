import { describe, expect, it } from "bun:test";
import {
  executeComparisonRun,
  type ComparisonFlowRunner,
  validateFileSelection,
  validateStartConditions,
} from "./useComparisonFlow";
import { ComparisonServiceError } from "../services/comparison-service";

const createFile = (name: string, size = 512, type = "application/pdf") =>
  new File(["a".repeat(size)], name, { type });

describe("validateFileSelection", () => {
  it("rejects when exceeding max files", () => {
    const existing = [createFile("a.pdf"), createFile("b.pdf"), createFile("c.pdf"), createFile("d.pdf")];
    const incoming = [createFile("e.pdf"), createFile("f.pdf")];

    const result = validateFileSelection(existing, incoming);
    expect(result).toEqual({ status: "error", message: "Maksymalnie 5 plików" });
  });

  it("rejects oversized files", () => {
    const existing: File[] = [];
    const incoming = [createFile("big.pdf", 11 * 1024 * 1024)];

    const result = validateFileSelection(existing, incoming);
    expect(result).toEqual({
      status: "error",
      message: "Plik za duży",
      description: expect.stringContaining("Maksymalny rozmiar: 10MB") as string,
    });
  });

  it("rejects unsupported types", () => {
    const result = validateFileSelection([], [createFile("doc.txt", 100, "text/plain")]);
    expect(result).toEqual({
      status: "error",
      message: "Nieprawidłowy format",
      description: "Akceptowane formaty: PDF, JPG, PNG, WEBP",
    });
  });

  it("accepts valid batch", () => {
    const result = validateFileSelection([], [createFile("ok.pdf"), createFile("ok2.pdf")]);
    expect(result).toEqual({ status: "success", added: 2 });
  });
});

describe("validateStartConditions", () => {
  it("requires minimum number of files", () => {
    const outcome = validateStartConditions("user-1", [createFile("a.pdf")]);
    expect(outcome).toEqual({
      status: "validation-error",
      message: "Dodaj minimum 2 oferty do porównania",
    });
  });

  it("requires authenticated user", () => {
    const files = [createFile("a.pdf"), createFile("b.pdf")];
    const outcome = validateStartConditions(undefined, files);
    expect(outcome).toEqual({ status: "auth-required" });
  });

  it("returns null when ready", () => {
    const files = [createFile("a.pdf"), createFile("b.pdf")];
    const outcome = validateStartConditions("user-1", files);
    expect(outcome).toBeNull();
  });
});

describe("executeComparisonRun", () => {
  const createRunner = (impl: ComparisonFlowRunner["runComparisonFlow"]) => ({
    runComparisonFlow: impl,
  });

  it("resolves success and propagates stages", async () => {
    const stages: string[] = [];
    const runner = createRunner(async ({ onStageChange }) => {
      onStageChange?.("uploading_files");
      onStageChange?.("creating_documents");
      return { comparisonId: "cmp-1", documentIds: ["doc-1", "doc-2"] };
    });

    const controller = new AbortController();
    const result = await executeComparisonRun({
      runner,
      userId: "user-1",
      files: [createFile("a.pdf"), createFile("b.pdf")],
      productType: "OC/AC",
      controller,
      onStageChange: (stage) => stages.push(stage),
    });

    expect(result).toEqual({ status: "success", comparisonId: "cmp-1" });
    expect(stages).toEqual(["uploading_files", "creating_documents"]);
  });

  it("returns aborted when controller is cancelled", async () => {
    const runner = createRunner(
      ({ signal }) =>
        new Promise((_, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new ComparisonServiceError("Przetwarzanie zostało przerwane.", "uploading_files"));
          });
        })
    );

    const controller = new AbortController();
    const promise = executeComparisonRun({
      runner,
      userId: "user-1",
      files: [createFile("a.pdf"), createFile("b.pdf")],
      productType: "OC/AC",
      controller,
    });

    controller.abort();
    const result = await promise;
    expect(result).toEqual({ status: "aborted" });
  });

  it("maps service errors to error status", async () => {
    const runner = createRunner(async () => {
      throw new ComparisonServiceError("Nie udało się utworzyć porównania.", "creating_comparison");
    });

    const controller = new AbortController();
    const result = await executeComparisonRun({
      runner,
      userId: "user-1",
      files: [createFile("a.pdf"), createFile("b.pdf")],
      productType: "OC/AC",
      controller,
    });

    expect(result).toEqual({
      status: "error",
      message: "Nie udało się utworzyć porównania.",
    });
  });
});

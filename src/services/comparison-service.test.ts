// @ts-nocheck
import { describe, expect, it } from "bun:test";
import type { ComparisonBackend, ComparisonStage } from "./comparison-service";
import type { Database } from "@/integrations/supabase/types";

type Json = Database["public"]["Tables"]["comparisons"]["Row"]["comparison_data"];

declare global {
  // eslint-disable-next-line no-var
  var localStorage: Storage;
}

if (typeof globalThis.localStorage === "undefined") {
  const storage = new Map<string, string>();
  globalThis.localStorage = {
    get length() {
      return storage.size;
    },
    clear: () => {
      storage.clear();
    },
    getItem: (key: string) => storage.get(key) ?? null,
    key: (index: number) => Array.from(storage.keys())[index] ?? null,
    removeItem: (key: string) => {
      storage.delete(key);
    },
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
  } as Storage;
}

const {
  ComparisonService,
  ComparisonServiceError,
} = await import("./comparison-service");

const createFile = (name: string) => new File(["dummy"], name, { type: "application/pdf" });

class StubBackend implements ComparisonBackend {
  uploads: Array<{ bucket: string; objectKey: string; file: File }> = [];
  insertedDocuments: Array<{ user_id: string; file_name: string; file_path: string } & Record<string, unknown>> = [];
  fetchCount = 0;
  invokedFunctions: Array<{ name: string; payload: Record<string, unknown> }> = [];
  private comparisonRecord: {
    id: string;
    status: string;
    document_ids: string[];
    user_id: string;
    product_type: string;
    client_id: string;
    comparison_data: Json;
    created_at: string;
    report_url: string;
    summary_text: string;
  } | null = null;

  constructor(private readonly succeedPollingAt: number) {}

  async uploadToStorage(params: { bucket: string; objectKey: string; file: File }) {
    this.uploads.push(params);
    return { path: `${params.bucket}/${params.objectKey}` };
  }

  async insertDocuments(payload: any[]) {
    this.insertedDocuments.push(...payload);
    return payload.map((item, index) => ({
      id: `doc-${index}`,
      status: "uploaded",
      client_id: null,
      created_at: new Date().toISOString(),
      extracted_data: null,
      file_name: item.file_name,
      file_path: item.file_path,
      file_size: item.file_size ?? null,
      mime_type: item.mime_type ?? null,
      user_id: item.user_id,
    }));
  }

  async invokeFunction(name: string, payload: Record<string, unknown>) {
    this.invokedFunctions.push({ name, payload });
  }

  async fetchDocuments(ids: string[]) {
    this.fetchCount += 1;
    if (this.fetchCount < this.succeedPollingAt) {
      return ids.map((id) => ({ id, status: "processing" }));
    }

    return ids.map((id) => ({ id, status: "completed" }));
  }

  async createComparison(payload: any) {
    this.comparisonRecord = {
      id: "comparison-123",
      status: payload.status ?? "processing",
      document_ids: payload.document_ids,
      user_id: payload.user_id,
      product_type: payload.product_type ?? "OC/AC",
      client_id: payload.client_id ?? "client-123",
      comparison_data: null as Json,
      created_at: new Date().toISOString(),
      report_url: "",
      summary_text: "",
    };

    return this.comparisonRecord;
  }

  async getComparison() {
    if (!this.comparisonRecord) {
      throw new Error("comparison not created");
    }

    return {
      ...this.comparisonRecord,
      product_type: "OC/AC",
      client_id: this.comparisonRecord.client_id ?? "client-123",
      comparison_data: this.comparisonRecord.comparison_data as Json,
      report_url: this.comparisonRecord.report_url ?? "",
      summary_text: this.comparisonRecord.summary_text ?? "",
    };
  }
}

describe("ComparisonService", () => {
  it("runs the happy path and reports stages", async () => {
    const backend = new StubBackend(2);
    const service = new ComparisonService(backend, {
      maxPollAttempts: 5,
      pollIntervalMs: 0,
    });
    const stages: ComparisonStage[] = [];

    const fileA = createFile("Oferta #1.pdf");
    const fileB = createFile("Oferta #2.pdf");

    const result = await service.runComparisonFlow({
      userId: "user-1",
      files: [fileA, fileB],
      onStageChange: (stage) => stages.push(stage),
    });

    expect(result).toEqual({
      comparisonId: "comparison-123",
      documentIds: ["doc-0", "doc-1"],
      detectedProductType: "OC/AC",
    });

    expect(stages).toEqual([
      "uploading_files",
      "creating_documents",
      "triggering_extraction",
      "waiting_for_extraction",
      "creating_comparison",
      "comparing_offers",
      "generating_summary",
    ]);

    expect(backend.uploads).toHaveLength(2);
    const storedNames = backend.uploads.map(({ objectKey }) => objectKey);
    expect(storedNames[0]).toMatch(/^user-1\//);
    expect(storedNames[0]).not.toContain(" ");
    expect(backend.invokedFunctions).toEqual([
      { name: "extract-insurance-data", payload: { document_id: "doc-0" } },
      { name: "extract-insurance-data", payload: { document_id: "doc-1" } },
      { name: "compare-offers", payload: { comparison_id: "comparison-123" } },
      { name: "generate-summary", payload: { comparison_id: "comparison-123" } },
    ]);
  });

  it("wraps backend failures in ComparisonServiceError", async () => {
    const failingBackend: ComparisonBackend = {
      async uploadToStorage() {
        throw new Error("storage failed");
      },
      async insertDocuments() {
        throw new Error("should not be called");
      },
      async invokeFunction() {
        throw new Error("should not be called");
      },
      async fetchDocuments() {
        throw new Error("should not be called");
      },
      async createComparison() {
        throw new Error("should not be called");
      },
      async getComparison() {
        throw new Error("should not be called");
      },
    };
    const service = new ComparisonService(failingBackend);

    await expect(
      service.runComparisonFlow({
        userId: "user-1",
        files: [createFile("Oferta #1.pdf"), createFile("Oferta #2.pdf")],
      })
    ).rejects.toBeInstanceOf(ComparisonServiceError);
  });

  it("aborts polling when the signal is triggered", async () => {
    const backend = new StubBackend(10);
    const service = new ComparisonService(backend, {
      maxPollAttempts: 5,
      pollIntervalMs: 0,
    });
    const controller = new AbortController();

    const promise = service.runComparisonFlow({
      userId: "user-1",
      files: [createFile("Oferta #1.pdf"), createFile("Oferta #2.pdf")],
      signal: controller.signal,
      onStageChange: (stage) => {
        if (stage === "waiting_for_extraction") {
          controller.abort(new Error("user navigated away"));
        }
      },
    });

    await expect(promise).rejects.toMatchObject({
      stage: "waiting_for_extraction",
    });
  });
});

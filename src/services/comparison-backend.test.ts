// @ts-nocheck
import { describe, expect, it } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createSupabaseComparisonBackend } from "./comparison-service";

type UploadRecord = { bucket: string; objectKey: string; fileName: string };
type InvocationRecord = { name: string; payload: Record<string, unknown> };

type SupabaseStubOptions = {
  uploadError?: string;
  insertDocumentsError?: string;
  fetchDocumentsError?: string;
  invokeError?: string;
  createComparisonError?: string;
  comparisonId?: string;
};

function createSupabaseStub(options: SupabaseStubOptions = {}) {
  const uploads: UploadRecord[] = [];
  const invocations: InvocationRecord[] = [];
  let insertedDocumentsPayload: unknown[] = [];
  let insertedComparisonPayload: Record<string, unknown> | null = null;

  const client: SupabaseClient<Database> = {
    storage: {
      from(bucket: string) {
        return {
          async upload(objectKey: string, file: File) {
            if (options.uploadError) {
              return { data: null, error: { message: options.uploadError } };
            }
            uploads.push({ bucket, objectKey, fileName: file.name });
            return { data: { path: objectKey }, error: null };
          },
        } as any;
      },
    } as any,
    functions: {
      async invoke(name: string, { body }: { body: Record<string, unknown> }) {
        invocations.push({ name, payload: body });
        if (options.invokeError) {
          return { data: null, error: { message: options.invokeError } };
        }
        return { data: null, error: null };
      },
    } as any,
    from(table: string) {
      if (table === "documents") {
        return {
          insert(payload: unknown[]) {
            insertedDocumentsPayload = payload;
            return {
              async select() {
                if (options.insertDocumentsError) {
                  return { data: null, error: { message: options.insertDocumentsError } };
                }
                return {
                  data: (payload as any[]).map((item, index) => ({
                    id: `doc-${index}`,
                    status: "uploaded",
                    created_at: new Date().toISOString(),
                    user_id: item.user_id ?? "user",
                    file_name: item.file_name,
                    file_path: item.file_path,
                    file_size: item.file_size ?? null,
                    mime_type: item.mime_type ?? null,
                    extracted_data: null,
                    client_id: null,
                  })),
                  error: null,
                };
              },
            };
          },
          select() {
            return {
              async in(_column: string, ids: string[]) {
                if (options.fetchDocumentsError) {
                  return { data: null, error: { message: options.fetchDocumentsError } };
                }
                return {
                  data: ids.map((id) => ({ id, status: "completed" })),
                  error: null,
                };
              },
            };
          },
        } as any;
      }

      if (table === "comparisons") {
        return {
          insert(payload: Record<string, unknown>) {
            insertedComparisonPayload = payload;
            return {
              select() {
                return {
                  async single() {
                    if (options.createComparisonError) {
                      return { data: null, error: { message: options.createComparisonError } };
                    }
                    return {
                      data: {
                        id: options.comparisonId ?? "comparison-1",
                        created_at: new Date().toISOString(),
                        status: payload.status ?? "processing",
                        document_ids: payload.document_ids ?? [],
                        user_id: payload.user_id,
                        product_type: payload.product_type ?? null,
                        client_id: payload.client_id ?? null,
                        comparison_data: null,
                        report_url: null,
                        summary_text: null,
                      },
                      error: null,
                    };
                  },
                };
              },
            };
          },
          select() {
            return {
              eq(_column: string, id: string) {
                return {
                  async single() {
                    if (options.createComparisonError) {
                      return { data: null, error: { message: options.createComparisonError } };
                    }
                    return {
                      data: {
                        id: id ?? options.comparisonId ?? "comparison-1",
                        created_at: new Date().toISOString(),
                        status: "completed",
                        document_ids: [],
                        user_id: "user-1",
                        product_type: "OC/AC",
                        client_id: null,
                        comparison_data: null,
                        report_url: null,
                        summary_text: null,
                      },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        } as any;
      }

      throw new Error(`Unexpected table ${table}`);
    },
  } as SupabaseClient<Database>;

  return { client, uploads, invocations, insertedDocumentsPayload, insertedComparisonPayload };
}

describe("createSupabaseComparisonBackend", () => {
  it("passes through successful operations", async () => {
    const { client, uploads, invocations } = createSupabaseStub();
    const backend = createSupabaseComparisonBackend(client);

    const file = new File(["content"], "offer.pdf", { type: "application/pdf" });
    const uploadResult = await backend.uploadToStorage({
      bucket: "insurance-documents",
      objectKey: "user/offer.pdf",
      file,
    });

    expect(uploadResult).toEqual({ path: "user/offer.pdf" });
    expect(uploads).toEqual([{ bucket: "insurance-documents", objectKey: "user/offer.pdf", fileName: "offer.pdf" }]);

    const inserted = await backend.insertDocuments([
      {
        user_id: "user-1",
        file_name: "offer.pdf",
        file_path: "user/offer.pdf",
      } as any,
    ]);
    expect(inserted[0].id).toBe("doc-0");

    await backend.invokeFunction("compare-offers", { comparison_id: "comparison-1" });
    expect(invocations).toEqual([
      { name: "compare-offers", payload: { comparison_id: "comparison-1" } },
    ]);

    const statuses = await backend.fetchDocuments(["doc-0"]);
    expect(statuses).toEqual([{ id: "doc-0", status: "completed" }]);

    const comparison = await backend.createComparison({
      user_id: "user-1",
      document_ids: ["doc-0"],
      status: "processing",
    } as any);
    expect(comparison.id).toBe("comparison-1");

    const fetchedComparison = await backend.getComparison("comparison-1");
    expect(fetchedComparison.product_type).toBe("OC/AC");
  });

  it("throws descriptive errors when supabase responses contain errors", async () => {
    const { client } = createSupabaseStub({
      uploadError: "upload failed",
      insertDocumentsError: "insert failed",
      fetchDocumentsError: "fetch failed",
      invokeError: "function failed",
      createComparisonError: "comparison failed",
    });
    const backend = createSupabaseComparisonBackend(client);
    const file = new File(["content"], "offer.pdf", { type: "application/pdf" });

    await expect(
      backend.uploadToStorage({ bucket: "insurance-documents", objectKey: "user/offer.pdf", file })
    ).rejects.toThrow("upload failed");

    await expect(
      backend.insertDocuments([{ user_id: "user", file_name: "offer.pdf", file_path: "path" } as any])
    ).rejects.toThrow("insert failed");

    await expect(backend.fetchDocuments(["doc-0"]))
      .rejects.toThrow("fetch failed");

    await expect(backend.invokeFunction("compare-offers", { comparison_id: "id" }))
      .rejects.toThrow("function failed");

    await expect(
      backend.createComparison({ user_id: "user", document_ids: ["doc-0"] } as any)
    ).rejects.toThrow("comparison failed");

    await expect(backend.getComparison("comparison-1")).rejects.toThrow("comparison failed");
  });
});

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { sanitizeFileName } from "@/lib/sanitizeFileName";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ComparisonStage =
  | "uploading_files"
  | "creating_documents"
  | "triggering_extraction"
  | "waiting_for_extraction"
  | "creating_comparison"
  | "comparing_offers"
  | "generating_summary";

export interface ComparisonServiceOptions {
  maxPollAttempts?: number;
  pollIntervalMs?: number;
}

const DEFAULT_OPTIONS: Required<ComparisonServiceOptions> = {
  maxPollAttempts: 45,
  pollIntervalMs: 2_000,
};

export class ComparisonServiceError extends Error {
  readonly stage: ComparisonStage;

  constructor(message: string, stage: ComparisonStage, cause?: unknown) {
    super(message);
    this.name = "ComparisonServiceError";
    this.stage = stage;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

type DocumentInsert = Database["public"]["Tables"]["documents"]["Insert"];
type DocumentRow = Database["public"]["Tables"]["documents"]["Row"];
type ComparisonInsert = Database["public"]["Tables"]["comparisons"]["Insert"];
type ComparisonRow = Database["public"]["Tables"]["comparisons"]["Row"];

type DocumentStatusRecord = Pick<DocumentRow, "id" | "status">;

type UploadResult = {
  path: string;
  storageKey: string;
  file: File;
};

type RunFlowParams = {
  userId: string;
  files: File[];
  productType: string;
  onStageChange?: (stage: ComparisonStage) => void;
  signal?: AbortSignal;
};

export interface ComparisonBackend {
  uploadToStorage(params: {
    bucket: string;
    objectKey: string;
    file: File;
  }): Promise<{ path: string }>;
  insertDocuments(payload: DocumentInsert[]): Promise<DocumentRow[]>;
  invokeFunction(name: string, payload: Record<string, unknown>): Promise<void>;
  fetchDocuments(ids: string[]): Promise<DocumentStatusRecord[]>;
  createComparison(payload: ComparisonInsert): Promise<ComparisonRow>;
}

const STORAGE_BUCKET = "insurance-documents";

export function createSupabaseComparisonBackend(
  client: SupabaseClient<Database>
): ComparisonBackend {
  return {
    async uploadToStorage({ bucket, objectKey, file }) {
      const { data, error } = await client.storage
        .from(bucket)
        .upload(objectKey, file, { upsert: false });

      if (error || !data) {
        throw new Error(error?.message ?? "Nie udało się przesłać pliku");
      }

      return { path: data.path };
    },

    async insertDocuments(payload) {
      const { data, error } = await client
        .from("documents")
        .insert(payload)
        .select();

      if (error || !data) {
        throw new Error(error?.message ?? "Nie udało się utworzyć dokumentów");
      }

      return data;
    },

    async invokeFunction(name, payload) {
      const { error } = await client.functions.invoke(name, {
        body: payload,
      });

      if (error) {
        throw new Error(error.message ?? `Błąd funkcji ${name}`);
      }
    },

    async fetchDocuments(ids) {
      const { data, error } = await client
        .from("documents")
        .select("id, status")
        .in("id", ids);

      if (error || !data) {
        throw new Error(error?.message ?? "Nie udało się pobrać dokumentów");
      }

      return data;
    },

    async createComparison(payload) {
      const { data, error } = await client
        .from("comparisons")
        .insert(payload)
        .select()
        .single();

      if (error || !data) {
        throw new Error(error?.message ?? "Nie udało się utworzyć porównania");
      }

      return data;
    },
  };
}

export class ComparisonService {
  private readonly options: Required<ComparisonServiceOptions>;

  constructor(
    private readonly backend: ComparisonBackend,
    options?: ComparisonServiceOptions
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async runComparisonFlow({
    userId,
    files,
    productType,
    onStageChange,
    signal,
  }: RunFlowParams): Promise<{ comparisonId: string; documentIds: string[] }> {
    this.ensureNotAborted(signal, "uploading_files");
    onStageChange?.("uploading_files");
    const uploadedFiles = await this.uploadFiles(userId, files);

    this.ensureNotAborted(signal, "creating_documents");
    onStageChange?.("creating_documents");
    const documents = await this.createDocumentRecords(userId, uploadedFiles);

    this.ensureNotAborted(signal, "triggering_extraction");
    onStageChange?.("triggering_extraction");
    await this.triggerExtraction(documents.map((doc) => doc.id));

    this.ensureNotAborted(signal, "waiting_for_extraction");
    onStageChange?.("waiting_for_extraction");
    await this.waitForExtraction(documents.map((doc) => doc.id), signal);

    this.ensureNotAborted(signal, "creating_comparison");
    onStageChange?.("creating_comparison");
    const comparison = await this.createComparison({
      userId,
      documentIds: documents.map((doc) => doc.id),
      productType,
    });

    this.ensureNotAborted(signal, "comparing_offers");
    onStageChange?.("comparing_offers");
    await this.backend.invokeFunction("compare-offers", {
      comparison_id: comparison.id,
    });

    this.ensureNotAborted(signal, "generating_summary");
    onStageChange?.("generating_summary");
    await this.backend.invokeFunction("generate-summary", {
      comparison_id: comparison.id,
    });

    return { comparisonId: comparison.id, documentIds: documents.map((d) => d.id) };
  }

  private async uploadFiles(userId: string, files: File[]): Promise<UploadResult[]> {
    try {
      const uploads = files.map(async (file) => {
        const storageKey = this.buildStorageKey(userId, file.name);
        const { path } = await this.backend.uploadToStorage({
          bucket: STORAGE_BUCKET,
          objectKey: storageKey,
          file,
        });

        return { path, storageKey, file };
      });

      return await Promise.all(uploads);
    } catch (error) {
      throw new ComparisonServiceError(
        "Nie udało się przesłać plików. Spróbuj ponownie.",
        "uploading_files",
        error
      );
    }
  }

  private async createDocumentRecords(
    userId: string,
    uploadedFiles: UploadResult[]
  ): Promise<DocumentRow[]> {
    const payload: DocumentInsert[] = uploadedFiles.map(({ file, path }) => ({
      user_id: userId,
      file_name: file.name,
      file_path: path,
      file_size: file.size,
      mime_type: file.type,
      status: "uploaded",
    }));

    try {
      return await this.backend.insertDocuments(payload);
    } catch (error) {
      throw new ComparisonServiceError(
        "Nie udało się zapisać dokumentów.",
        "creating_documents",
        error
      );
    }
  }

  private async triggerExtraction(documentIds: string[]): Promise<void> {
    try {
      await Promise.all(
        documentIds.map((documentId) =>
          this.backend.invokeFunction("extract-insurance-data", {
            document_id: documentId,
          })
        )
      );
    } catch (error) {
      throw new ComparisonServiceError(
        "Nie udało się zainicjować ekstrakcji danych.",
        "triggering_extraction",
        error
      );
    }
  }

  private async waitForExtraction(
    documentIds: string[],
    signal?: AbortSignal
  ): Promise<void> {
    let attempts = 0;

    while (attempts < this.options.maxPollAttempts) {
      this.ensureNotAborted(signal, "waiting_for_extraction");

      try {
        const statuses = await this.backend.fetchDocuments(documentIds);
        const allCompleted = statuses.every((doc) => doc.status === "completed");
        const anyFailed = statuses.some((doc) => doc.status === "failed");

        if (allCompleted) {
          return;
        }

        if (anyFailed) {
          const failedCount = statuses.filter((doc) => doc.status === "failed").length;
          throw new ComparisonServiceError(
            `Nie udało się przetworzyć ${failedCount} dokumentu(ów).`,
            "waiting_for_extraction"
          );
        }
      } catch (error) {
        if (error instanceof ComparisonServiceError) {
          throw error;
        }

        throw new ComparisonServiceError(
          "Nie udało się sprawdzić statusu ekstrakcji.",
          "waiting_for_extraction",
          error
        );
      }

      attempts += 1;
      await this.delay(this.options.pollIntervalMs);
    }

    throw new ComparisonServiceError(
      "Przekroczono limit czasu ekstrakcji. Spróbuj z mniejszymi plikami lub ponownie później.",
      "waiting_for_extraction"
    );
  }

  private async createComparison({
    userId,
    documentIds,
    productType,
  }: {
    userId: string;
    documentIds: string[];
    productType: string;
  }): Promise<ComparisonRow> {
    const payload: ComparisonInsert = {
      user_id: userId,
      product_type: productType,
      document_ids: documentIds,
      status: "processing",
    };

    try {
      return await this.backend.createComparison(payload);
    } catch (error) {
      throw new ComparisonServiceError(
        "Nie udało się utworzyć porównania.",
        "creating_comparison",
        error
      );
    }
  }

  private buildStorageKey(userId: string, fileName: string): string {
    const safeName = sanitizeFileName(fileName);
    const unique = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${userId}/${unique}-${safeName}`;
  }

  private ensureNotAborted(signal: AbortSignal | undefined, stage: ComparisonStage) {
    if (signal?.aborted) {
      throw new ComparisonServiceError(
        "Przetwarzanie zostało przerwane.",
        stage,
        signal.reason
      );
    }
  }

  private async delay(ms: number) {
    if (ms <= 0) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const comparisonService = new ComparisonService(
  createSupabaseComparisonBackend(supabase)
);

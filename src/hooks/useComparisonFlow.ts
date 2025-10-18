import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  comparisonService,
  ComparisonServiceError,
  type ComparisonStage,
} from "@/services/comparison-service";

const MAX_FILES = 5;
const MIN_FILES = 2;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const STAGE_MESSAGES: Record<ComparisonStage, string> = {
  uploading_files: "Przesyłanie plików...",
  creating_documents: "Zapisywanie dokumentów...",
  triggering_extraction: "Ekstrahowanie danych z dokumentów...",
  waiting_for_extraction: "Czekam na ekstrakcję danych...",
  creating_comparison: "Tworzenie porównania...",
  comparing_offers: "Porównywanie ofert...",
  generating_summary: "Generowanie podsumowania AI...",
};

export type AddFilesResult =
  | { status: "success"; added: number }
  | { status: "error"; message: string; description?: string };

export type StartComparisonResult =
  | { status: "success"; comparisonId: string }
  | { status: "validation-error"; message: string }
  | { status: "auth-required" }
  | { status: "error"; message: string }
  | { status: "aborted" };

export interface UseComparisonFlowOptions {
  userId?: string;
  runner?: ComparisonFlowRunner;
}

export interface ComparisonFlowRunner {
  runComparisonFlow: (params: {
    userId: string;
    files: File[];
    productType: string;
    onStageChange?: (stage: ComparisonStage) => void;
    signal?: AbortSignal;
  }) => Promise<{ comparisonId: string; documentIds: string[] }>;
}

export function validateFileSelection(
  currentFiles: File[],
  incoming: File[]
): AddFilesResult {
  if (incoming.length === 0) {
    return { status: "success", added: 0 };
  }

  if (currentFiles.length + incoming.length > MAX_FILES) {
    return {
      status: "error",
      message: "Maksymalnie 5 plików",
    };
  }

  const oversized = incoming.find((file) => file.size > MAX_FILE_SIZE_BYTES);
  if (oversized) {
    return {
      status: "error",
      message: "Plik za duży",
      description: `Maksymalny rozmiar: 10MB. Plik "${oversized.name}" jest za duży.`,
    };
  }

  const invalidType = incoming.find((file) => !ALLOWED_MIME_TYPES.has(file.type));
  if (invalidType) {
    return {
      status: "error",
      message: "Nieprawidłowy format",
      description: "Akceptowane formaty: PDF, JPG, PNG, WEBP",
    };
  }

  return { status: "success", added: incoming.length };
}

export function validateStartConditions(
  userId: string | undefined,
  files: File[]
): StartComparisonResult | null {
  if (files.length < MIN_FILES) {
    return {
      status: "validation-error",
      message: "Dodaj minimum 2 oferty do porównania",
    };
  }

  if (!userId) {
    return { status: "auth-required" };
  }

  return null;
}

export async function executeComparisonRun({
  runner,
  userId,
  files,
  productType,
  controller,
  onStageChange,
}: {
  runner: ComparisonFlowRunner;
  userId: string;
  files: File[];
  productType: string;
  controller: AbortController;
  onStageChange?: (stage: ComparisonStage) => void;
}): Promise<StartComparisonResult> {
  try {
    const result = await runner.runComparisonFlow({
      userId,
      files,
      productType: productType.trim() || "OC/AC",
      signal: controller.signal,
      onStageChange,
    });

    return { status: "success", comparisonId: result.comparisonId };
  } catch (error) {
    if (controller.signal.aborted) {
      return { status: "aborted" };
    }

    if (error instanceof ComparisonServiceError) {
      return { status: "error", message: error.message };
    }

    if (error instanceof Error && error.message) {
      return { status: "error", message: error.message };
    }

    return {
      status: "error",
      message: "Wystąpił nieoczekiwany błąd podczas przetwarzania",
    };
  }
}

export function useComparisonFlow({
  userId,
  runner = comparisonService,
}: UseComparisonFlowOptions) {
  const [files, setFiles] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMessage, setProcessingMessage] = useState("");
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, []);

  const addFiles = useCallback(
    (incoming: File[]): AddFilesResult => {
      const validation = validateFileSelection(files, incoming);
      if (validation.status === "success") {
        setFiles((prev) => [...prev, ...incoming]);
      }
      return validation;
    },
    [files]
  );

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const resetProcessingState = useCallback(() => {
    if (!isMountedRef.current) {
      return;
    }

    setIsProcessing(false);
    setProcessingMessage("");
  }, []);

  const startComparison = useCallback(
    async (productType: string): Promise<StartComparisonResult> => {
      const precheck = validateStartConditions(userId, files);
      if (precheck) {
        return precheck;
      }

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      if (isMountedRef.current) {
        setIsProcessing(true);
        setProcessingMessage(STAGE_MESSAGES.uploading_files);
      }

      try {
        return await executeComparisonRun({
          runner,
          userId,
          files,
          productType,
          controller,
          onStageChange: (stage) => {
            if (!isMountedRef.current) {
              return;
            }

            setProcessingMessage(STAGE_MESSAGES[stage]);
          },
        });
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        resetProcessingState();
      }
    },
    [files, resetProcessingState, runner, userId]
  );

  const canSubmit = useMemo(() => files.length >= MIN_FILES && !isProcessing, [
    files.length,
    isProcessing,
  ]);

  return {
    files,
    addFiles,
    removeFile,
    isProcessing,
    processingMessage,
    canSubmit,
    startComparison,
  };
}

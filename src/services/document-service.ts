import { supabase } from "@/integrations/supabase/client";

export const DOCUMENTS_BUCKET = "insurance-documents";
export const DEFAULT_DOWNLOAD_EXPIRATION_SECONDS = 60 * 60; // 1 hour
export const DEFAULT_PREVIEW_EXPIRATION_SECONDS = 60 * 5; // 5 minutes
const LEGACY_BUCKET_PREFIX = `${DOCUMENTS_BUCKET}/`;

export class DocumentServiceError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "DocumentServiceError";
  }
}

export const normalizeDocumentStorageKey = (filePath: string): string => {
  if (!filePath || typeof filePath !== "string") {
    throw new DocumentServiceError("Niepoprawna ścieżka pliku dokumentu.");
  }

  const trimmed = filePath.trim();
  if (!trimmed) {
    throw new DocumentServiceError("Niepoprawna ścieżka pliku dokumentu.");
  }

  if (trimmed.startsWith(LEGACY_BUCKET_PREFIX)) {
    const normalized = trimmed.slice(LEGACY_BUCKET_PREFIX.length);
    if (!normalized) {
      throw new DocumentServiceError("Nie udało się odczytać lokalizacji dokumentu w magazynie.");
    }
    return normalized;
  }

  return trimmed;
};

const createSignedUrl = async (
  filePath: string,
  expiresIn: number,
): Promise<string> => {
  const objectPath = normalizeDocumentStorageKey(filePath);

  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(objectPath, expiresIn);

  if (error || !data?.signedUrl) {
    throw new DocumentServiceError("Nie udało się wygenerować podpisanego adresu URL.", error);
  }

  return data.signedUrl;
};

export const getSignedDownloadUrl = async (
  filePath: string,
  expiresIn: number = DEFAULT_DOWNLOAD_EXPIRATION_SECONDS,
): Promise<string> => {
  try {
    return await createSignedUrl(filePath, expiresIn);
  } catch (error) {
    if (error instanceof DocumentServiceError) {
      throw error;
    }
    throw new DocumentServiceError("Nie udało się przygotować linku do pobrania dokumentu.", error);
  }
};

export const getSignedPreviewUrl = async (
  filePath: string,
  expiresIn: number = DEFAULT_PREVIEW_EXPIRATION_SECONDS,
): Promise<string> => {
  try {
    return await createSignedUrl(filePath, expiresIn);
  } catch (error) {
    if (error instanceof DocumentServiceError) {
      throw error;
    }
    throw new DocumentServiceError("Nie udało się przygotować podglądu dokumentu.", error);
  }
};


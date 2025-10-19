import { supabase } from "@/integrations/supabase/client";

const DEFAULT_DOWNLOAD_EXPIRATION_SECONDS = 60 * 60; // 1 hour
const DEFAULT_PREVIEW_EXPIRATION_SECONDS = 60 * 5; // 5 minutes

export class DocumentServiceError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "DocumentServiceError";
  }
}

type ParsedStoragePath = {
  bucket: string;
  objectPath: string;
};

const parseStoragePath = (filePath: string): ParsedStoragePath => {
  if (!filePath || typeof filePath !== "string") {
    throw new DocumentServiceError("Niepoprawna ścieżka pliku dokumentu.");
  }

  const [bucket, ...rest] = filePath.split("/");
  if (!bucket || rest.length === 0) {
    throw new DocumentServiceError("Nie udało się odczytać lokalizacji dokumentu w magazynie.");
  }

  return { bucket, objectPath: rest.join("/") };
};

const createSignedUrl = async (
  filePath: string,
  expiresIn: number,
): Promise<string> => {
  const { bucket, objectPath } = parseStoragePath(filePath);

  const { data, error } = await supabase.storage
    .from(bucket)
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


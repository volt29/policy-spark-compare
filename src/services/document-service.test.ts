// @ts-nocheck
import { beforeEach, describe, expect, it } from "bun:test";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_DOWNLOAD_EXPIRATION_SECONDS,
  DEFAULT_PREVIEW_EXPIRATION_SECONDS,
  DOCUMENTS_BUCKET,
  DocumentServiceError,
  getSignedDownloadUrl,
  getSignedPreviewUrl,
  normalizeDocumentStorageKey,
} from "./document-service";

describe("document-service", () => {
  let capturedBucket: string | null = null;
  let capturedCalls: Array<{ path: string; expiresIn: number }> = [];

  beforeEach(() => {
    capturedBucket = null;
    capturedCalls = [];

    supabase.storage = {
      from(bucket: string) {
        capturedBucket = bucket;
        return {
          async createSignedUrl(path: string, expiresIn: number) {
            capturedCalls.push({ path, expiresIn });
            return { data: { signedUrl: `https://example.com/${bucket}/${path}` }, error: null };
          },
        } as any;
      },
    } as any;
  });

  it("normalizes object keys and reuses the insurance bucket", async () => {
    const downloadUrl = await getSignedDownloadUrl("documents/user/file.pdf");

    expect(downloadUrl).toBe(`https://example.com/${DOCUMENTS_BUCKET}/documents/user/file.pdf`);
    expect(capturedBucket).toBe(DOCUMENTS_BUCKET);
    expect(capturedCalls).toEqual([
      { path: "documents/user/file.pdf", expiresIn: DEFAULT_DOWNLOAD_EXPIRATION_SECONDS },
    ]);
  });

  it("strips legacy bucket prefixes when generating signed URLs", async () => {
    const previewUrl = await getSignedPreviewUrl(`${DOCUMENTS_BUCKET}/legacy/file.pdf`);

    expect(previewUrl).toBe(`https://example.com/${DOCUMENTS_BUCKET}/legacy/file.pdf`);
    expect(capturedCalls).toEqual([
      { path: "legacy/file.pdf", expiresIn: DEFAULT_PREVIEW_EXPIRATION_SECONDS },
    ]);
  });

  it("throws when provided key is empty after normalization", () => {
    expect(() => normalizeDocumentStorageKey(`${DOCUMENTS_BUCKET}/`)).toThrow(DocumentServiceError);
  });
});

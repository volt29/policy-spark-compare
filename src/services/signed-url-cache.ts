import {
  DEFAULT_DOWNLOAD_EXPIRATION_SECONDS,
  DEFAULT_PREVIEW_EXPIRATION_SECONDS,
  normalizeDocumentStorageKey,
} from "./document-service";

type SignedUrlType = "preview" | "download";

type SignedUrlFetcher = (filePath: string) => Promise<string>;

type CacheEntry = {
  url?: string;
  expiresAt?: number;
  promise?: Promise<string>;
};

export interface SignedUrlCacheOptions {
  now?: () => number;
  previewExpiresIn?: number;
  downloadExpiresIn?: number;
  previewBufferSeconds?: number;
  downloadBufferSeconds?: number;
}

const ensurePositiveSeconds = (value: number) => {
  if (!Number.isFinite(value)) return 1;
  return value > 0 ? value : 1;
};

export class SignedUrlCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly now: () => number;
  private readonly fetchers: Record<SignedUrlType, SignedUrlFetcher>;
  private readonly previewExpiresIn: number;
  private readonly downloadExpiresIn: number;
  private readonly previewBufferSeconds: number;
  private readonly downloadBufferSeconds: number;

  constructor(
    fetchers: { preview: SignedUrlFetcher; download: SignedUrlFetcher },
    options: SignedUrlCacheOptions = {}
  ) {
    this.fetchers = fetchers;
    this.now = options.now ?? (() => Date.now());
    this.previewExpiresIn = ensurePositiveSeconds(
      options.previewExpiresIn ?? DEFAULT_PREVIEW_EXPIRATION_SECONDS
    );
    this.downloadExpiresIn = ensurePositiveSeconds(
      options.downloadExpiresIn ?? DEFAULT_DOWNLOAD_EXPIRATION_SECONDS
    );
    this.previewBufferSeconds = ensurePositiveSeconds(options.previewBufferSeconds ?? 30);
    this.downloadBufferSeconds = ensurePositiveSeconds(options.downloadBufferSeconds ?? 120);
  }

  getPreviewUrl(filePath: string): Promise<string> {
    return this.getUrl("preview", filePath);
  }

  getDownloadUrl(filePath: string): Promise<string> {
    return this.getUrl("download", filePath);
  }

  async getUrl(type: SignedUrlType, filePath: string): Promise<string> {
    const key = this.buildKey(type, filePath);
    const existing = this.cache.get(key);
    const now = this.now();

    if (existing?.promise) {
      return existing.promise;
    }

    if (existing?.url && existing.expiresAt && existing.expiresAt > now) {
      return existing.url;
    }

    const fetcher = this.fetchers[type];
    const normalizedKey = normalizeDocumentStorageKey(filePath);
    const ttlSeconds = this.getTtlSeconds(type);

    const promise = fetcher(normalizedKey)
      .then((url) => {
        const expiresAt = this.now() + ttlSeconds * 1000;
        this.cache.set(key, { url, expiresAt });
        return url;
      })
      .catch((error) => {
        this.cache.delete(key);
        throw error;
      });

    this.cache.set(key, { promise });
    return promise;
  }

  invalidate(filePath: string, type?: SignedUrlType) {
    if (type) {
      this.cache.delete(this.buildKey(type, filePath));
      return;
    }

    this.cache.delete(this.buildKey("preview", filePath));
    this.cache.delete(this.buildKey("download", filePath));
  }

  clear() {
    this.cache.clear();
  }

  private buildKey(type: SignedUrlType, filePath: string) {
    const normalized = normalizeDocumentStorageKey(filePath);
    return `${type}:${normalized}`;
  }

  private getTtlSeconds(type: SignedUrlType) {
    const expiresIn = type === "preview" ? this.previewExpiresIn : this.downloadExpiresIn;
    const buffer = type === "preview" ? this.previewBufferSeconds : this.downloadBufferSeconds;
    const safeExpiresIn = Math.max(expiresIn - buffer, Math.floor(expiresIn * 0.8), 1);
    return ensurePositiveSeconds(safeExpiresIn);
  }
}

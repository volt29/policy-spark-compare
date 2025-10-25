const DEFAULT_MINERU_BASE_URL = "https://api.mineru.net" as const;

type FetchImpl = typeof fetch;

type HeadersLike = HeadersInit | undefined;

function sanitizeBaseUrl(url: string): string {
  return url.replace(/\/$/, "");
}

function pickBaseUrl(baseUrl?: string): string {
  const envOverride = Deno.env.get("MINERU_API_URL")?.trim();
  const candidate = baseUrl?.trim() || envOverride || DEFAULT_MINERU_BASE_URL;
  return sanitizeBaseUrl(candidate);
}

export interface MineruClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: FetchImpl;
}

export class MineruClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchImpl;

  constructor({ apiKey, baseUrl, fetchImpl = fetch }: MineruClientOptions) {
    this.apiKey = apiKey;
    this.baseUrl = pickBaseUrl(baseUrl);
    this.fetchImpl = fetchImpl;
  }

  private buildUrl(path: string): string {
    if (!path.startsWith("/")) {
      path = `/${path}`;
    }

    return `${this.baseUrl}${path}`;
  }

  private buildHeaders(additional?: HeadersLike): Headers {
    const headers = new Headers({
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    });

    if (additional) {
      const additionalHeaders = new Headers(additional);
      additionalHeaders.forEach((value, key) => {
        headers.set(key, value);
      });
    }

    return headers;
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const { headers, body, method = "GET" } = init;

    const response = await this.fetchImpl(this.buildUrl(path), {
      ...init,
      method,
      body,
      headers: this.buildHeaders(headers),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Mineru request failed (${response.status}): ${errorBody}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const responseText = await response.text();
    if (!responseText) {
      return undefined as T;
    }

    return JSON.parse(responseText) as T;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}

export { DEFAULT_MINERU_BASE_URL, pickBaseUrl as resolveMineruBaseUrl, sanitizeBaseUrl };

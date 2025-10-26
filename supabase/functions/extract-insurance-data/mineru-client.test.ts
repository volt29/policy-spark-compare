import { describe, expect, it } from "bun:test";
import { MineruClient, MineruHttpError } from "./mineru-client";

const DUMMY_BYTES = new Uint8Array([0x01]);

function createFetchRecorder(expectedResponse: Record<string, unknown>) {
  let lastUrl: string | null = null;

  const fetchStub: typeof fetch = async (input, init) => {
    void init;
    lastUrl = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : String(input);

    return new Response(JSON.stringify(expectedResponse), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  return {
    fetchStub,
    getLastUrl: () => lastUrl,
  };
}

const EMPTY_RESPONSE = {
  data: {
    pages: [],
    text: "",
    structureSummary: null,
  },
};

describe("MineruClient URL construction", () => {
  it("appends the default version segment when missing", async () => {
    const recorder = createFetchRecorder(EMPTY_RESPONSE);
    const client = new MineruClient({
      apiKey: "test-key",
      baseUrl: "https://api.mineru.com",
      fetchImpl: recorder.fetchStub,
    });

    await client.analyzeDocument({
      bytes: DUMMY_BYTES,
      mimeType: "application/pdf",
    });

    expect(recorder.getLastUrl()).toBe("https://api.mineru.com/v1/document/analyze");
  });

  it("respects an explicit version in the base URL", async () => {
    const recorder = createFetchRecorder(EMPTY_RESPONSE);
    const client = new MineruClient({
      apiKey: "test-key",
      baseUrl: "https://api.mineru.com/v2",
      fetchImpl: recorder.fetchStub,
    });

    await client.analyzeDocument({
      bytes: DUMMY_BYTES,
      mimeType: "application/pdf",
    });

    expect(recorder.getLastUrl()).toBe("https://api.mineru.com/v2/document/analyze");
  });
});

describe("MineruClient error handling", () => {
  it("throws MineruHttpError with hint for 404 responses", async () => {
    let calls = 0;
    const fetchStub: typeof fetch = async () => {
      calls++;
      return new Response("<html>not found</html>", { status: 404 });
    };

    const client = new MineruClient({
      apiKey: "test-key",
      fetchImpl: fetchStub,
    });

    let caughtError: unknown;
    try {
      await client.analyzeDocument({
        bytes: DUMMY_BYTES,
        mimeType: "application/pdf",
      });
    } catch (error) {
      caughtError = error;
    }

    expect(calls).toBe(1);

    expect(caughtError).toBeInstanceOf(MineruHttpError);
    if (caughtError instanceof MineruHttpError) {
      expect(caughtError.status).toBe(404);
      expect(caughtError.hint).toBe("document not found / sprawdź endpoint");
      expect(caughtError.endpoint).toContain("document/analyze");
    }
  });

  it("propagates MineruHttpError without hint for 5xx responses", async () => {
    let calls = 0;
    const fetchStub: typeof fetch = async () => {
      calls++;
      return new Response("server down", { status: 503 });
    };

    const client = new MineruClient({
      apiKey: "test-key",
      fetchImpl: fetchStub,
    });

    let caughtError: unknown;
    try {
      await client.analyzeDocument({
        bytes: DUMMY_BYTES,
        mimeType: "application/pdf",
      });
    } catch (error) {
      caughtError = error;
    }

    expect(calls).toBe(1);

    expect(caughtError).toBeInstanceOf(MineruHttpError);
    if (caughtError instanceof MineruHttpError) {
      expect(caughtError.status).toBe(503);
      expect(caughtError.hint).toBeUndefined();
    }
  });
});

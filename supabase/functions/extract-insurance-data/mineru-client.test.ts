import { describe, expect, it } from "bun:test";
import { MineruClient } from "./mineru-client";

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

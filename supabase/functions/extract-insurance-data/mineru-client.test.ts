import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import {
  MineruClient,
  MineruPage,
  MineruSegmentationResult,
  convertMineruPagesToSections,
} from "./mineru-client.ts";
import { MineruHttpError } from "./mineru-errors.ts";

type FetchCall = {
  url: string;
  init?: RequestInit;
};

const originalConsole = {
  info: console.info,
  error: console.error,
  debug: console.debug,
};

beforeEach(() => {
  console.info = () => {};
  console.error = () => {};
  console.debug = () => {};
});

afterEach(() => {
  console.info = originalConsole.info;
  console.error = originalConsole.error;
  console.debug = originalConsole.debug;
});

function createFetchSequence(
  handlers: Array<(
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    index: number,
  ) => Promise<Response> | Response>,
) {
  const calls: FetchCall[] = [];

  const fetchStub: typeof fetch = async (input, init) => {
    const index = calls.length;
    const handler = handlers[index];

    if (!handler) {
      throw new Error(`Unexpected fetch call #${index + 1}`);
    }

    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : "url" in input
          ? input.url
          : String(input);

    calls.push({ url, init });

    return await handler(input, init, index);
  };

  return { fetchStub, calls };
}

function createArchiveSimulator(payload: unknown) {
  const jsonText = typeof payload === "string" ? payload : JSON.stringify(payload);
  const archivePayload = new TextEncoder().encode(jsonText);

  const zipLoader = async () => ({
    loadAsync: async () => ({
      files: {
        "analysis.json": {
          name: "analysis.json",
          dir: false,
          async: async (type: "string") => {
            if (type !== "string") {
              throw new Error(`Unsupported output type: ${type}`);
            }
            return jsonText;
          },
        },
      },
    }),
  });

  return { archivePayload, zipLoader };
}

function mineruOk(data: unknown, init: ResponseInit = {}): Response {
  return new Response(
    JSON.stringify({
      code: 0,
      data,
      msg: "ok",
      trace_id: "trace-test",
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
      ...init,
    },
  );
}

function mineruError({
  code,
  msg,
  status = 500,
}: {
  code: number;
  msg: string;
  status?: number;
}): Response {
  return new Response(
    JSON.stringify({
      code,
      data: null,
      msg,
      trace_id: "trace-test",
    }),
    {
      status,
      headers: { "Content-Type": "application/json" },
    },
  );
}

describe("MineruClient analyzeDocument", () => {
  const defaultOptions = {
    signedUrl: "https://signed.example.com/document.pdf",
  } as const;

  it("processes a happy path task and parses the archive", async () => {
    const { archivePayload, zipLoader } = createArchiveSimulator({
      data: {
        pages: [
          {
            pageNumber: 1,
            text: "Sample text",
            blocks: [
              {
                type: "paragraph",
                text: "Sample block",
              },
            ],
          },
        ],
        text: "Sample text",
        structureSummary: { confidence: 0.9, pages: [] },
      },
    });

    const fullZipUrl = "https://cdn.example.com/archive.zip";

    const { fetchStub, calls } = createFetchSequence([
      async (_input, init) => {
        expect(init?.method).toBe("POST");
        return mineruOk({ task_id: "task-123", state: "pending" });
      },
      async () => mineruOk({ task_id: "task-123", state: "processing" }),
      async () => mineruOk({ task_id: "task-123", state: "done", full_zip_url: fullZipUrl }),
      async () => new Response(archivePayload, {
        status: 200,
        headers: { "Content-Type": "application/zip" },
      }),
    ]);

    const client = new MineruClient({
      apiKey: "test-key",
      fetchImpl: fetchStub,
      zipLoader,
    });

    const analysis = await client.analyzeDocument({ ...defaultOptions, documentId: "doc-1" });

    expect(analysis.pages).toHaveLength(1);
    expect(analysis.pages[0]?.text).toBe("Sample text");
    expect(analysis.text).toContain("Sample text");
    expect(analysis.structureSummary?.confidence).toBeCloseTo(0.9);

    expect(calls.map((call) => call.url)).toEqual([
      "https://mineru.net/api/v4/extract/task",
      "https://mineru.net/api/v4/extract/task/task-123",
      "https://mineru.net/api/v4/extract/task/task-123",
      fullZipUrl,
    ]);
  });

  it("accepts task identifiers with underscores", async () => {
    const { archivePayload, zipLoader } = createArchiveSimulator({ data: { pages: [], text: "", structureSummary: null } });
    const taskId = "task_2025_0001";
    const fullZipUrl = "https://cdn.example.com/archive.zip";

    const { fetchStub, calls } = createFetchSequence([
      async () => mineruOk({
        metadata: { task_identifier: taskId },
        state: "queued",
      }),
      async () => mineruOk({ task_id: taskId, state: "done", full_zip_url: fullZipUrl }),
      async () => new Response(archivePayload, { status: 200, headers: { "Content-Type": "application/zip" } }),
    ]);

    const client = new MineruClient({ apiKey: "test-key", fetchImpl: fetchStub, zipLoader });

    await client.analyzeDocument(defaultOptions);

    expect(calls[1]?.url).toBe(`https://mineru.net/api/v4/extract/task/${taskId}`);
  });

  it("returns analysis when MinerU immediately provides an archive", async () => {
    const { archivePayload, zipLoader } = createArchiveSimulator({
      data: {
        pages: [],
        text: "Immediate success",
        structureSummary: null,
      },
    });

    const fullZipUrl = "https://cdn.example.com/archive.zip";

    const { fetchStub, calls } = createFetchSequence([
      async () => mineruOk({ state: "done", full_zip_url: fullZipUrl }),
      async () => new Response(archivePayload, {
        status: 200,
        headers: { "Content-Type": "application/zip" },
      }),
    ]);

    const client = new MineruClient({ apiKey: "test-key", fetchImpl: fetchStub, zipLoader });

    const analysis = await client.analyzeDocument(defaultOptions);

    expect(analysis.text).toBe("Immediate success");
    expect(calls.map((call) => call.url)).toEqual([
      "https://mineru.net/api/v4/extract/task",
      fullZipUrl,
    ]);
  });

  it("throws MINERU_NO_TASK_ID when the initial response lacks an identifier and archive", async () => {
    const { fetchStub } = createFetchSequence([
      async () => mineruOk({ state: "pending" }),
    ]);

    const client = new MineruClient({ apiKey: "test-key", fetchImpl: fetchStub });

    await expect(client.analyzeDocument(defaultOptions)).rejects.toMatchObject({ code: "MINERU_NO_TASK_ID" });
  });

  it("throws MINERU_TASK_FAILED when polling returns a failure state", async () => {
    const { fetchStub } = createFetchSequence([
      async () => mineruOk({ task_id: "task-err", state: "pending" }),
      async () => mineruOk({ task_id: "task-err", state: "failed", err_msg: "Invalid document" }),
    ]);

    const client = new MineruClient({ apiKey: "test-key", fetchImpl: fetchStub });

    await expect(client.analyzeDocument(defaultOptions)).rejects.toMatchObject({ code: "MINERU_TASK_FAILED" });
  });

  it("throws MineruHttpError without retry on HTTP 400", async () => {
    const { fetchStub } = createFetchSequence([
      async () => mineruError({ code: 40001, msg: "Bad request", status: 400 }),
    ]);

    const client = new MineruClient({ apiKey: "test-key", fetchImpl: fetchStub });

    await expect(client.analyzeDocument(defaultOptions)).rejects.toBeInstanceOf(MineruHttpError);
  });

  it("throws MINERU_INVALID_RESPONSE when MinerU returns an empty payload", async () => {
    const { fetchStub } = createFetchSequence([
      async () => mineruOk(null),
    ]);

    const client = new MineruClient({ apiKey: "test-key", fetchImpl: fetchStub });

    await expect(client.analyzeDocument(defaultOptions)).rejects.toMatchObject({ code: "MINERU_INVALID_RESPONSE" });
  });

  it("retries on temporary 5xx errors and eventually succeeds", async () => {
    const { archivePayload, zipLoader } = createArchiveSimulator({
      data: { pages: [], text: "Recovered", structureSummary: null },
    });

    const fullZipUrl = "https://cdn.example.com/archive.zip";

    const { fetchStub, calls } = createFetchSequence([
      async () => new Response("", { status: 502 }),
      async () => mineruOk({ task_id: "task-retry", state: "pending" }),
      async () => mineruOk({ task_id: "task-retry", state: "done", full_zip_url: fullZipUrl }),
      async () => new Response(archivePayload, {
        status: 200,
        headers: { "Content-Type": "application/zip" },
      }),
    ]);

    const client = new MineruClient({ apiKey: "test-key", fetchImpl: fetchStub, zipLoader });

    const analysis = await client.analyzeDocument(defaultOptions);

    expect(analysis.text).toBe("Recovered");
    expect(calls.map((call) => call.url)).toEqual([
      "https://mineru.net/api/v4/extract/task",
      "https://mineru.net/api/v4/extract/task",
      "https://mineru.net/api/v4/extract/task/task-retry",
      fullZipUrl,
    ]);
  });

  it("throws MineruHttpError with MINERU_TIMEOUT when the request aborts", async () => {
    const abortError = new DOMException("Aborted", "AbortError");
    const { fetchStub } = createFetchSequence([
      async () => { throw abortError; },
      async () => { throw abortError; },
      async () => { throw abortError; },
    ]);

    const client = new MineruClient({ apiKey: "test-key", fetchImpl: fetchStub });

    await expect(client.analyzeDocument(defaultOptions)).rejects.toMatchObject({ code: "MINERU_TIMEOUT" });
  });

  it("throws MINERU_NO_RESULT_URL when the completed task lacks an archive URL", async () => {
    const { fetchStub } = createFetchSequence([
      async () => mineruOk({ task_id: "task-missing", state: "pending" }),
      async () => mineruOk({ task_id: "task-missing", state: "done" }),
    ]);

    const client = new MineruClient({ apiKey: "test-key", fetchImpl: fetchStub });

    await expect(client.analyzeDocument(defaultOptions)).rejects.toMatchObject({ code: "MINERU_NO_RESULT_URL" });
  });

  it("throws MINERU_ARCHIVE_ERROR when the archive does not contain JSON", async () => {
    const zipLoader = async () => ({
      loadAsync: async () => ({
        files: {
          "readme.txt": {
            name: "readme.txt",
            dir: false,
            async: async () => "plain text",
          },
        },
      }),
    });

    const { fetchStub } = createFetchSequence([
      async () => mineruOk({ task_id: "task-zip", state: "done", full_zip_url: "https://cdn.example.com/archive.zip" }),
      async () => new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "application/zip" },
      }),
    ]);

    const client = new MineruClient({ apiKey: "test-key", fetchImpl: fetchStub, zipLoader });

    await expect(client.analyzeDocument(defaultOptions)).rejects.toMatchObject({ code: "MINERU_ARCHIVE_ERROR" });
  });

  it("normalizes alternate MinerU payload shapes", async () => {
    const structuredPayload = {
      data: {
        pages: [
          {
            pageNumber: 1,
            content: [
              "Primary",
              { text: "Secondary" },
              { content: "Tertiary" },
            ],
          },
          {
            pageNumber: 2,
            content: [],
            lines: ["Line A", "Line B"],
          },
          {
            pageNumber: 3,
            blocks: [
              { type: "paragraph", text: "Block text" },
            ],
          },
        ],
        structure_summary: {
          confidence: 0.75,
          pageSummaries: [
            {
              page_number: 1,
              block_count: 5,
              top_headings: ["Heading A"],
              keywords: ["alpha", 42, "beta"],
            },
          ],
        },
      },
    };

    const { archivePayload, zipLoader } = createArchiveSimulator(structuredPayload);
    const fullZipUrl = "https://cdn.example.com/structured.zip";

    const { fetchStub } = createFetchSequence([
      async () => mineruOk({ task_id: "task-structured", state: "done", full_zip_url: fullZipUrl }),
      async () => new Response(archivePayload, {
        status: 200,
        headers: { "Content-Type": "application/zip" },
      }),
    ]);

    const client = new MineruClient({ apiKey: "test-key", fetchImpl: fetchStub, zipLoader });

    const analysis = await client.analyzeDocument(defaultOptions);

    expect(analysis.pages.map((page) => page.text)).toEqual([
      "Primary\nSecondary\nTertiary",
      "Line A\nLine B",
      "Block text",
    ]);
    expect(analysis.structureSummary?.confidence).toBeCloseTo(0.75);
    expect(analysis.structureSummary?.pages[0]).toMatchObject({
      pageNumber: 1,
      blockCount: 5,
      headings: ["Heading A"],
      keywords: ["alpha", "beta"],
    });
  });
});

describe("MineruClient configuration", () => {
  it("exposes the resolved base URL", () => {
    const client = new MineruClient({ apiKey: "key", baseUrl: "https://mineru.example.com/api/v4/" });
    expect(client.getBaseUrl()).toBe("https://mineru.example.com/api/v4");
  });
});

describe("convertMineruPagesToSections", () => {
  it("groups content into sections and sources", () => {
    const pages: MineruPage[] = [
      {
        pageNumber: 1,
        text: "Header\nBody content",
        blocks: [
          {
            type: "heading",
            headingLevel: 1,
            text: "Introduction",
          },
          {
            type: "paragraph",
            text: "This is the introduction body.",
          },
        ],
      },
      {
        pageNumber: 2,
        text: "Pricing details",
        blocks: [
          {
            type: "heading",
            headingLevel: 2,
            text: "Pricing",
          },
          {
            type: "paragraph",
            text: "Pricing details appear here.",
          },
        ],
      },
    ];

    const result: MineruSegmentationResult = convertMineruPagesToSections(pages);

    expect(result.sections).toHaveLength(4);
    expect(result.sections.map((section) => section.snippet)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Introduction"),
        expect.stringContaining("This is the introduction body."),
        expect.stringContaining("Pricing"),
        expect.stringContaining("Pricing details appear here."),
      ]),
    );
    expect(result.sources).toHaveLength(4);
  });

  it("handles pages without headings by creating a default section", () => {
    const pages: MineruPage[] = [
      {
        pageNumber: 1,
        text: "Page text without headings",
        blocks: [
          {
            type: "paragraph",
            text: "Only body text",
          },
        ],
      },
    ];

    const result = convertMineruPagesToSections(pages);

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]?.snippet).toContain("Only body text");
    expect(result.sections[0]?.content).toContain("Only body text");
  });
});


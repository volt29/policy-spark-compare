import { describe, expect, it } from "bun:test";

import {
  MineruClient,
  MineruPage,
  MineruSegmentationResult,
  convertMineruPagesToSections,
} from "./mineru-client";
import { MineruClientError, MineruHttpError } from "./mineru-errors.ts";

type FetchCall = {
  url: string;
  init?: RequestInit;
};

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

    const analysis = await client.analyzeDocument({
      signedUrl: "https://signed.example.com/document.pdf",
      documentId: "doc-1",
    });

    expect(analysis.pages).toHaveLength(1);
    expect(analysis.pages[0].text).toBe("Sample text");
    expect(analysis.text).toContain("Sample text");
    expect(analysis.structureSummary?.confidence).toBeCloseTo(0.9);

    expect(calls.map((call) => call.url)).toEqual([
      "https://mineru.net/api/v4/extract/task",
      "https://mineru.net/api/v4/extract/task/task-123",
      "https://mineru.net/api/v4/extract/task/task-123",
      fullZipUrl,
    ]);
  });

  it("handles task identifiers provided with alternate casing", async () => {
    const { archivePayload, zipLoader } = createArchiveSimulator({ data: { pages: [], text: '', structureSummary: null } });
    const taskId = "ABCDEF1234567890";
    const fullZipUrl = "https://cdn.example.com/archive.zip";

    const { fetchStub, calls } = createFetchSequence([
      async () => mineruOk({ TaskID: taskId, state: "pending" }),
      async () => mineruOk({ task_id: taskId, state: "done", full_zip_url: fullZipUrl }),
      async () => new Response(archivePayload, { status: 200, headers: { "Content-Type": "application/zip" } }),
    ]);

    const client = new MineruClient({ apiKey: "test-key", fetchImpl: fetchStub, zipLoader });

    const analysis = await client.analyzeDocument({ signedUrl: "https://signed.example.com/document.pdf" });

    expect(calls[1]?.url).toContain(taskId);
    expect(analysis.pages).toEqual([]);
    expect(analysis.text).toBe("");
  });

  it("extracts task identifiers from task_ids arrays", async () => {
    const { archivePayload, zipLoader } = createArchiveSimulator({ data: { pages: [], text: '', structureSummary: null } });
    const taskId = "task-abc-123";
    const fullZipUrl = "https://cdn.example.com/archive.zip";

    const { fetchStub, calls } = createFetchSequence([
      async () => mineruOk({ task_ids: [taskId], state: "queued" }),
      async () => mineruOk({ task_id: taskId, state: "done", full_zip_url: fullZipUrl }),
      async () => new Response(archivePayload, { status: 200, headers: { "Content-Type": "application/zip" } }),
    ]);

    const client = new MineruClient({ apiKey: "test-key", fetchImpl: fetchStub, zipLoader });

    await client.analyzeDocument({ signedUrl: "https://signed.example.com/document.pdf" });

    expect(calls[1]?.url).toContain(taskId);
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

    const client = new MineruClient({
      apiKey: "test-key",
      fetchImpl: fetchStub,
    });

    expect(analysis.text).toBe("Immediate success");
    expect(calls.map((call) => call.url)).toEqual([
      "https://mineru.net/api/v4/extract/task",
      fullZipUrl,
    ]);
  });

  it("throws MINERU_NO_TASK_ID when the initial response lacks an identifier and archive", async () => {
    const { fetchStub, calls } = createFetchSequence([
      async () => mineruOk({ state: "pending" }),
    ]);

    const client = new MineruClient({
      apiKey: "test-key",
      fetchImpl: fetchStub,
    });

    let caught: unknown;
    try {
      await client.analyzeDocument({
        signedUrl: "https://signed.example.com/document.pdf",
      });
    } catch (error) {
      caught = error;
    }

    expect(calls).toHaveLength(1);
    expect(caught).toBeInstanceOf(MineruClientError);
    if (caught instanceof MineruClientError) {
      expect(caught.code).toBe("MINERU_NO_TASK_ID");
    }
  });

  it("throws MINERU_TASK_FAILED when polling returns a failure state", async () => {
    const { fetchStub } = createFetchSequence([
      async () => mineruOk({ task_id: "task-err", state: "pending" }),
      async () => mineruOk({ task_id: "task-err", state: "failed", err_msg: "Invalid document" }),
    ]);

    const client = new MineruClient({
      apiKey: "test-key",
      fetchImpl: fetchStub,
    });

    await expect(
      client.analyzeDocument({
        signedUrl: "https://signed.example.com/document.pdf",
      }),
    ).rejects.toMatchObject({ code: "MINERU_TASK_FAILED" });
  });

  it("throws MineruHttpError without retry on HTTP 400", async () => {
    const { fetchStub, calls } = createFetchSequence([
      async () => mineruError({ code: 40001, msg: "Bad request", status: 400 }),
    ]);

    const client = new MineruClient({
      apiKey: "test-key",
      fetchImpl: fetchStub,
    });

    let caught: unknown;
    try {
      await client.analyzeDocument({
        signedUrl: "https://signed.example.com/document.pdf",
      });
    } catch (error) {
      caught = error;
    }

    expect(calls).toHaveLength(1);
    expect(caught).toBeInstanceOf(MineruHttpError);
    if (caught instanceof MineruHttpError) {
      expect(caught.status).toBe(400);
    }
  });

  it("retries on temporary 5xx errors and eventually succeeds", async () => {
    const { archivePayload, zipLoader } = createArchiveSimulator({
      data: {
        pages: [],
        text: "Recovered",
        structureSummary: null,
      },
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

    const client = new MineruClient({
      apiKey: "test-key",
      fetchImpl: fetchStub,
    });

    await expect(
      client.analyzeDocument({
        signedUrl: "https://signed.example.com/document.pdf",
      }),
    ).rejects.toMatchObject({ code: "MINERU_TIMEOUT" });

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
    const { fetchStub, calls } = createFetchSequence([
      async () => {
        throw abortError;
      },
      async () => {
        throw abortError;
      },
      async () => {
        throw abortError;
      },
    ]);

    const client = new MineruClient({
      apiKey: "test-key",
      fetchImpl: fetchStub,
    });

    await expect(
      client.analyzeDocument({
        signedUrl: "https://signed.example.com/document.pdf",
      }),
    ).rejects.toMatchObject({ code: "MINERU_TIMEOUT" });

    expect(calls).toHaveLength(3);
  });
});

  it("throws MINERU_NO_RESULT_URL when the completed task lacks an archive URL", async () => {
    const { fetchStub } = createFetchSequence([
      async () => mineruOk({ task_id: "task-missing", state: "pending" }),
      async () => mineruOk({ task_id: "task-missing", state: "done" }),
    ]);

    const client = new MineruClient({
      apiKey: "test-key",
      fetchImpl: fetchStub,
    });

    await expect(
      client.analyzeDocument({
        signedUrl: "https://signed.example.com/document.pdf",
      }),
    ).rejects.toMatchObject({ code: "MINERU_NO_RESULT_URL" });
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
            type: "paragraph",
            text: "Premium: $100",
          },
        ],
      },
    ];

    const result: MineruSegmentationResult = convertMineruPagesToSections(pages);

    expect(result.sections).not.toHaveLength(0);
    expect(result.sources).not.toHaveLength(0);
    expect(result.sections[0]).toMatchObject({
      type: expect.any(String),
      content: expect.any(String),
    });
  });
});

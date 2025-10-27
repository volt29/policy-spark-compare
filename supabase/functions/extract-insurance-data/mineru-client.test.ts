import { describe, expect, it } from "bun:test";
import { MineruClient, MineruHttpError } from "./mineru-client";

type FetchCall = {
  url: string;
  init?: RequestInit;
};

function createFetchSequence(
  handlers: Array<(input: RequestInfo | URL, init: RequestInit | undefined, index: number) => Promise<Response> | Response>,
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

let jsZipInstancePromise: Promise<any> | null = null;

async function loadTestJSZip() {
  if (!jsZipInstancePromise) {
    const load = async () => {
      try {
        const mod = await import("jszip");
        return mod?.default ?? mod;
      } catch (nodeModuleError) {
        const mod = await import("npm:jszip@3.10.1").catch((npmImportError) => {
          throw new AggregateError([nodeModuleError as Error, npmImportError as Error], "Unable to load JSZip for tests");
        });
        return (mod as any)?.default ?? mod;
      }
    };

    jsZipInstancePromise = load();
  }

  return await jsZipInstancePromise;
}

async function createArchivePayload(payload: unknown): Promise<Uint8Array> {
  const JSZip = await loadTestJSZip();
  const zip = new JSZip();
  zip.file("analysis.json", JSON.stringify(payload));
  return await zip.generateAsync({ type: "uint8array" });
}

describe("MineruClient analyzeDocument", () => {
  it("creates a task, polls for completion, and parses the archive", async () => {
    const archivePayload = await createArchivePayload({
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
        structureSummary: {
          confidence: 0.9,
          pages: [],
        },
      },
    });

    const fullZipUrl = "https://cdn.example.com/archive.zip";

    const { fetchStub, calls } = createFetchSequence([
      async (_input, init) => {
        expect(init?.method).toBe("POST");
        const body = typeof init?.body === "string"
          ? init.body
          : init?.body instanceof Uint8Array
            ? new TextDecoder().decode(init.body)
            : init?.body ? String(init.body) : "";

        const parsed = JSON.parse(body);
        expect(parsed.document_url).toBe("https://signed.example.com/document.pdf");

        return new Response(JSON.stringify({
          task_id: "task-123",
          status: "pending",
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
      async () => {
        return new Response(JSON.stringify({
          task_id: "task-123",
          status: "processing",
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
      async () => {
        return new Response(JSON.stringify({
          task_id: "task-123",
          status: "succeeded",
          result: { full_zip_url: fullZipUrl },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
      async () => {
        return new Response(archivePayload, {
          status: 200,
          headers: { "Content-Type": "application/zip" },
        });
      },
    ]);

    const client = new MineruClient({
      apiKey: "test-key",
      fetchImpl: fetchStub,
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

  it("overrides organization header when provided per request", async () => {
    const archivePayload = await createArchivePayload({
      data: {
        pages: [],
        text: "",
        structureSummary: null,
      },
    });

    const { fetchStub, calls } = createFetchSequence([
      async (_input, init) => {
        const headers = new Headers(init?.headers);
        expect(headers.get("X-Organization-Id")).toBe("org-override");
        const bodyText = typeof init?.body === "string" ? init.body : "";
        const parsed = JSON.parse(bodyText);
        expect(parsed.organization_id).toBe("org-override");

        return new Response(JSON.stringify({
          task_id: "task-org",
          status: "pending",
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
      async (_input, init) => {
        const headers = new Headers(init?.headers);
        expect(headers.get("X-Organization-Id")).toBe("org-override");

        return new Response(JSON.stringify({
          task_id: "task-org",
          status: "succeeded",
          result: { full_zip_url: "https://cdn.example.com/archive.zip" },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
      async () => {
        return new Response(archivePayload, {
          status: 200,
          headers: { "Content-Type": "application/zip" },
        });
      },
    ]);

    const client = new MineruClient({
      apiKey: "test-key",
      fetchImpl: fetchStub,
      organizationId: "org-default",
    });

    const analysis = await client.analyzeDocument({
      signedUrl: "https://signed.example.com/document.pdf",
      organizationId: "org-override",
    });

    expect(analysis.pages).toEqual([]);
    expect(calls[0]?.url).toBe("https://mineru.net/api/v4/extract/task");
    expect(calls[1]?.url).toBe("https://mineru.net/api/v4/extract/task/task-org");
  });

  it("trims legacy analyze endpoints from base URL overrides", async () => {
    const archivePayload = await createArchivePayload({
      data: {
        pages: [
          {
            pageNumber: 1,
            text: "Sample",
          },
        ],
        text: "Sample",
        structureSummary: null,
      },
    });

    const fullZipUrl = "https://cdn.example.com/archive.zip";

    const { fetchStub, calls } = createFetchSequence([
      async (_input, init) => {
        expect(init?.method).toBe("POST");
        return new Response(JSON.stringify({
          task_id: "task-legacy",
          status: "pending",
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
      async () => {
        return new Response(JSON.stringify({
          task_id: "task-legacy",
          status: "succeeded",
          result: { full_zip_url: fullZipUrl },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
      async () => {
        return new Response(archivePayload, {
          status: 200,
          headers: { "Content-Type": "application/zip" },
        });
      },
    ]);

    const client = new MineruClient({
      apiKey: "test-key",
      baseUrl: "https://api.mineru.com/v1/document/analyze",
      fetchImpl: fetchStub,
    });

    const analysis = await client.analyzeDocument({
      signedUrl: "https://signed.example.com/document.pdf",
    });

    expect(analysis.text).toBe("Sample");
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.mineru.com/v1/extract/task",
      "https://api.mineru.com/v1/extract/task/task-legacy",
      fullZipUrl,
    ]);
  });

  it("throws MineruHttpError when the task fails", async () => {
    const { fetchStub } = createFetchSequence([
      async (_input, init) => {
        expect(init?.method).toBe("POST");
        return new Response(JSON.stringify({
          task_id: "task-error",
          status: "queued",
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
      async () => {
        return new Response(JSON.stringify({
          task_id: "task-error",
          status: "failed",
          error: {
            code: "INVALID_DOCUMENT",
            message: "Document is corrupted",
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    ]);

    const client = new MineruClient({
      apiKey: "test-key",
      fetchImpl: fetchStub,
    });

    let caught: unknown;
    try {
      await client.analyzeDocument({ signedUrl: "https://signed.example.com/document.pdf" });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(MineruHttpError);
    if (caught instanceof MineruHttpError) {
      expect(caught.status).toBe(502);
      expect(caught.hint).toBe("INVALID_DOCUMENT");
      expect(caught.message).toContain("Document is corrupted");
    }
  });

  it("propagates MineruHttpError when polling returns 404", async () => {
    const { fetchStub } = createFetchSequence([
      async () => {
        return new Response(JSON.stringify({
          task_id: "task-missing",
          status: "pending",
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
      async () => {
        return new Response("not found", { status: 404 });
      },
    ]);

    const client = new MineruClient({
      apiKey: "test-key",
      fetchImpl: fetchStub,
    });

    let caught: unknown;
    try {
      await client.analyzeDocument({ signedUrl: "https://signed.example.com/document.pdf" });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(MineruHttpError);
    if (caught instanceof MineruHttpError) {
      expect(caught.status).toBe(404);
      expect(caught.hint).toBe("document not found / sprawdź endpoint");
      expect(caught.endpoint).toContain("extract/task/task-missing");
    }
  });
});


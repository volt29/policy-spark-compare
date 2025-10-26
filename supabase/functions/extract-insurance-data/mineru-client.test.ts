import { assertEquals, assertRejects } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { MineruClient, MineruAnalyzeDocumentResult } from './mineru-client.ts';

function createMockFetch(
  status: number,
  body: any,
  contentType = 'application/json'
): typeof fetch {
  return async (_url: string | URL | Request, _init?: RequestInit) => {
    const responseBody = typeof body === 'string' ? body : JSON.stringify(body);
    return new Response(responseBody, {
      status,
      headers: { 'Content-Type': contentType },
    }) as any;
  };
}

Deno.test('MineruClient - sukces analizy dokumentu', async () => {
  const mockResponse = {
    data: {
      pages: [
        { pageNumber: 1, text: 'Test page 1', blocks: [] },
        { pageNumber: 2, text: 'Test page 2', blocks: [] }
      ],
      text: 'Test page 1\n\nTest page 2',
      structureSummary: null
    }
  };

  const client = new MineruClient({
    apiKey: 'test-key',
    baseUrl: 'https://api.test.com',
    fetchImpl: createMockFetch(200, mockResponse)
  });

  const bytes = new Uint8Array([1, 2, 3, 4]);
  const result = await client.analyzeDocument({
    bytes,
    mimeType: 'application/pdf',
    documentId: 'test-doc-123'
  });

  assertEquals(result.pages.length, 2);
  assertEquals(result.pages[0].pageNumber, 1);
  assertEquals(result.pages[0].text, 'Test page 1');
  assertEquals(result.text, 'Test page 1\n\nTest page 2');
});

Deno.test('MineruClient - błąd 404 z czytelnym komunikatem', async () => {
  const mockHtml = '<html><head><title>Not Found</title></head><body>404; Not Found</body></html>';

  const client = new MineruClient({
    apiKey: 'test-key',
    baseUrl: 'https://api.test.com',
    fetchImpl: createMockFetch(404, mockHtml, 'text/html')
  });

  const bytes = new Uint8Array([1, 2, 3, 4]);

  const error = await assertRejects(
    async () => {
      await client.analyzeDocument({
        bytes,
        mimeType: 'application/pdf',
        documentId: 'test-doc-456'
      });
    },
    Error,
    'MinerU API endpoint not found (404)'
  );

  assertEquals(
    (error as Error).message.includes('https://api.test.com/analyze'),
    true,
    'Error should include full URL'
  );
  assertEquals(
    (error as Error).message.includes('Check MINERU_API_URL'),
    true,
    'Error should include hint about env variable'
  );
});

Deno.test('MineruClient - błąd 500 serwera', async () => {
  const mockError = { error: 'Internal server error', code: 'SERVER_ERROR' };

  const client = new MineruClient({
    apiKey: 'test-key',
    baseUrl: 'https://api.test.com',
    fetchImpl: createMockFetch(500, mockError)
  });

  const bytes = new Uint8Array([1, 2, 3, 4]);

  await assertRejects(
    async () => {
      await client.analyzeDocument({
        bytes,
        mimeType: 'application/pdf',
        documentId: 'test-doc-789'
      });
    },
    Error,
    'Mineru analysis failed (500)'
  );
});

Deno.test('MineruClient - buildUrl usuwa duplikaty wersji', () => {
  const client = new MineruClient({
    apiKey: 'test-key',
    baseUrl: 'https://api.test.com/v1',
    fetchImpl: fetch
  });

  const url = client.getBaseUrl();
  assertEquals(url, 'https://api.test.com/v1');
});

Deno.test('MineruClient - buildUrl obsługuje trailing slash', () => {
  const client = new MineruClient({
    apiKey: 'test-key',
    baseUrl: 'https://api.test.com/',
    fetchImpl: fetch
  });

  const url = client.getBaseUrl();
  assertEquals(url, 'https://api.test.com');
});

Deno.test('MineruClient - weryfikacja Uint8Array', async () => {
  const client = new MineruClient({
    apiKey: 'test-key',
    baseUrl: 'https://api.test.com',
    fetchImpl: createMockFetch(200, {})
  });

  await assertRejects(
    async () => {
      await client.analyzeDocument({
        bytes: [] as any,
        mimeType: 'application/pdf',
        documentId: 'test-doc'
      });
    },
    Error,
    'bytes must be a Uint8Array'
  );
});

Deno.test('MineruClient - nagłówki autoryzacji i organizacji', async () => {
  let capturedHeaders: Headers | undefined;

  const mockFetch: typeof fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    capturedHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify({ data: { pages: [], text: '' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }) as any;
  };

  const client = new MineruClient({
    apiKey: 'secret-key-123',
    baseUrl: 'https://api.test.com',
    organizationId: 'org-456',
    fetchImpl: mockFetch
  });

  const bytes = new Uint8Array([1, 2, 3]);
  await client.analyzeDocument({
    bytes,
    mimeType: 'application/pdf',
    documentId: 'test-doc'
  });

  assertEquals(capturedHeaders?.get('Authorization'), 'Bearer secret-key-123');
  assertEquals(capturedHeaders?.get('X-Organization-Id'), 'org-456');
});

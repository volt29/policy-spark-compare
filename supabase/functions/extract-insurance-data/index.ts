import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import {
  convertMineruPagesToSections,
  MineruClient,
  MineruHttpError,
  MineruPage,
  MineruStructuralSummary
} from './mineru-client.ts';
import {
  ParsedSection,
  SectionSource,
  calculateExtractionConfidence,
  inferProductTypeFromText
} from './classifier.ts';
import { buildUnifiedOffer, UnifiedOfferBuildResult } from './unified-builder.ts';

type LovableContentBlock = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

const allowedOrigins = (Deno.env.get("CORS_ALLOWED_ORIGINS") || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

const isOriginAllowed = (origin: string | null) => {
  if (allowedOrigins.length === 0) {
    return true;
  }

  if (!origin) {
    return true;
  }

  return allowedOrigins.includes(origin);
};

const createCorsHeaders = (origin: string | null) => {
  const allowOrigin =
    allowedOrigins.length === 0
      ? "*"
      : origin && allowedOrigins.includes(origin)
        ? origin
        : "null";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  } as const;
};

const requestSchema = z.object({
  document_id: z.string().min(1, "document_id is required"),
});

const LOVABLE_SYSTEM_PROMPT = `Jesteś ekspertem od ekstrakcji danych z ofert ubezpieczeniowych.
Ekstrahuj informacje zgodnie z zunifikowanym schematem:
- Priorytetowo używaj danych z tekstu dokumentu
- Dla składek: szukaj "total_premium_before_discounts" i "total_premium_after_discounts"
- Dla ubezpieczonych: szukaj imion, wieku i przypisanych planów
- Dla assistance: wypisz pełne nazwy usług z limity
- Dla zniżek: wymień wszystkie rabaty i promocje
- Oznacz brakujące wartości jako null lub pomiń pole`;

interface AiRetryDecision {
  shouldRetry: boolean;
  updatedContent?: LovableContentBlock[];
}

async function callLovableWithRetry(
  lovableApiKey: string,
  schemaParameters: any,
  initialContent: LovableContentBlock[],
  options: {
    timeoutMs?: number;
    maxRetries?: number;
    onRetry?: (errorText: string, attempt: number) => Promise<AiRetryDecision> | AiRetryDecision;
  } = {}
) {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 120000;
  const maxRetries = options.maxRetries ?? 0;
  const onRetry = options.onRetry;

  let content = initialContent;
  let attempt = 0;
  let aiResponse: Response | undefined;

  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  while (attempt <= maxRetries) {
    try {
      console.log(`✅ Lovable call attempt ${attempt + 1}/${maxRetries + 1}`);
      aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${lovableApiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            {
              role: 'system',
              content: LOVABLE_SYSTEM_PROMPT
            },
            {
              role: 'user',
              content
            }
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "extract_insurance_data",
                description: "Extract structured data from insurance policy document in unified format",
                parameters: schemaParameters
              }
            }
          ],
          tool_choice: {
            type: 'function',
            function: { name: 'extract_insurance_data' }
          }
        }),
      });

      console.log('✅ Lovable response status:', aiResponse.status);

      if (aiResponse.ok) {
        break;
      }

      const errorText = await aiResponse.text();
      console.error(`❌ Lovable error (attempt ${attempt + 1}):`, errorText);

      if (attempt < maxRetries && onRetry) {
        const decision = await onRetry(errorText, attempt);
        if (decision.shouldRetry) {
          content = decision.updatedContent ?? content;
          attempt++;
          continue;
        }
      }

      throw new Error(`AI API error: ${aiResponse.status} - ${errorText}`);
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('AI processing timeout - file may be too large or complex');
      }
      throw error;
    }
  }

  clearTimeout(timeoutId);

  if (!aiResponse || !aiResponse.ok) {
    throw new Error('Failed after all retry attempts');
  }

  return aiResponse.json();
}

function parseAiExtractionResponse(aiData: any) {
  let extractedData;
  const message = aiData.choices?.[0]?.message;

  if (!message) {
    throw new Error('AI response missing message payload');
  }

  try {
    if (message.tool_calls && message.tool_calls.length > 0) {
      const toolCall = message.tool_calls[0];
      extractedData = JSON.parse(toolCall.function.arguments);
      console.log('Structured data extracted via tool calling');
    } else if (message.content) {
      const extractedText = message.content;
      const jsonMatch = extractedText.match(/```json\n?([\s\S]*?)\n?```/) ||
                       extractedText.match(/```\n?([\s\S]*?)\n?```/);
      const jsonText = jsonMatch ? jsonMatch[1] : extractedText;
      extractedData = JSON.parse(jsonText.trim());
      console.log('Data extracted from content (fallback)');
    } else {
      throw new Error('No tool call or content in AI response');
    }
  } catch (parseError) {
    console.error('Failed to parse AI response:', parseError);
    extractedData = {
      error: 'Failed to extract structured data',
      raw_response: message
    };
  }

  return extractedData;
}

function mergeExtractedData(base: any, addition: any) {
  if (!addition || typeof addition !== 'object') {
    return base;
  }

  const result = { ...base };

  for (const [key, value] of Object.entries(addition)) {
    if (value === null || value === undefined) {
      continue;
    }

    const existing = result[key];

    if (Array.isArray(value)) {
      const existingArray = Array.isArray(existing) ? existing : [];
      const combined = [...existingArray];

      for (const item of value) {
        const serialized = typeof item === 'object' ? JSON.stringify(item) : item;
        const alreadyExists = combined.some(existingItem => {
          if (typeof existingItem === 'object') {
            return JSON.stringify(existingItem) === serialized;
          }
          return existingItem === item;
        });

        if (!alreadyExists) {
          combined.push(item);
        }
      }

      result[key] = combined;
    } else if (typeof value === 'object') {
      result[key] = mergeExtractedData(
        existing && typeof existing === 'object' ? existing : {},
        value
      );
    } else if (existing === undefined || existing === null || existing === '' || existing === 'missing') {
      result[key] = value;
    }
  }

  return result;
}

function normalizeProductTypeValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (value && typeof value === 'object') {
    const possibleKeys = ['value', 'label', 'name', 'type'];
    for (const key of possibleKeys) {
      const candidate = (value as Record<string, unknown>)[key];
      if (typeof candidate === 'string') {
        const trimmed = candidate.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
      }
    }
  }

  return null;
}

function mergeEntriesByKey(
  existing: unknown,
  incoming: Array<Record<string, unknown>>,
  key: string | string[]
) {
  const keys = Array.isArray(key) ? key : [key];

  const resolveIdentifier = (item: Record<string, unknown>) => {
    for (const candidate of keys) {
      const identifier = item[candidate];
      if (identifier !== undefined && identifier !== null && identifier !== '') {
        return String(identifier);
      }
    }
    return null;
  };

  const baseArray = Array.isArray(existing)
    ? existing.filter(item => item && typeof item === 'object') as Array<Record<string, unknown>>
    : [];

  const merged = new Map<string, Record<string, unknown>>();

  for (const item of baseArray) {
    const identifier = resolveIdentifier(item);
    if (!identifier) {
      merged.set(`__idx_${merged.size}`, { ...item });
    } else {
      merged.set(identifier, { ...item });
    }
  }

  for (const item of incoming) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const identifier = resolveIdentifier(item);
    if (!identifier) {
      merged.set(`__incoming_${merged.size}`, { ...item });
      continue;
    }

    const existingEntry = merged.get(identifier) ?? {};
    merged.set(identifier, { ...existingEntry, ...item });
  }

  return Array.from(merged.values());
}

serve(async (req) => {
  console.log('🚀 EXTRACT-INSURANCE-DATA v2.0 - STARTED', new Date().toISOString());

  const origin = req.headers.get('Origin');
  const corsHeaders = createCorsHeaders(origin);

  if (!isOriginAllowed(origin)) {
    return new Response(
      JSON.stringify({ error: 'Origin not allowed' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let document_id: string | undefined;
  let supabase: any;

  try {
    console.log('✅ Step 1: Request received');

    const authHeader = req.headers.get('Authorization');

    if (!authHeader || authHeader.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'Missing Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let parsedBody: unknown;

    try {
      parsedBody = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON payload' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const validation = requestSchema.safeParse(parsedBody);

    if (!validation.success) {
      return new Response(
        JSON.stringify({
          error: 'Invalid request payload',
          details: validation.error.flatten().fieldErrors
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    document_id = validation.data.document_id;
    console.log('✅ Step 2: Body parsed', { document_id });

    console.log('✅ Step 3: Document ID extracted:', document_id);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;
    console.log('✅ Step 4: Env vars loaded');

    supabase = createClient(supabaseUrl, supabaseKey, {
      global: {
        headers: {
          Authorization: authHeader
        }
      }
    });
    console.log('✅ Step 5: Supabase client created');

    const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    const {
      data: { user },
      error: userError
    } = accessToken
      ? await supabase.auth.getUser(accessToken)
      : { data: { user: null }, error: null } as const;

    if (userError || !user) {
      console.warn('extract-insurance-data: user authentication failed', {
        hasError: !!userError
      });
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ Step 6: User authenticated');

    // Get document details
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('*')
      .eq('id', document_id)
      .single();

    console.log('✅ Step 7: Document fetched', { exists: !!document, error: !!docError });

    if (docError || !document) {
      throw new Error('Document not found');
    }

    if (document.user_id !== user.id) {
      return new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ Step 8: Document details', {
      mime_type: document.mime_type,
      file_path: document.file_path
    });

    const mimeType = document.mime_type ?? 'application/pdf';
    if (mimeType !== 'application/pdf') {
      console.warn(`❌ Unsupported MIME type requested: ${mimeType}`);
      return new Response(
        JSON.stringify({ error: 'Only PDF documents are supported' }),
        { status: 415, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update status to processing
    await supabase
      .from('documents')
      .update({ status: 'processing' })
      .eq('id', document_id);

    console.log('✅ Step 9: Status updated to processing');

    // Download file from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('insurance-documents')
      .download(document.file_path);

    if (downloadError) {
      throw new Error(`Failed to download file: ${downloadError.message}`);
    }
    
    console.log('✅ Step 9: File downloaded from storage');

    const arrayBuffer = await fileData.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    
    const fileSizeMB = bytes.length / (1024 * 1024);
    console.log(`✅ Step 10: File size: ${fileSizeMB.toFixed(2)}MB`);
    
    if (mimeType !== 'application/pdf') {
      throw new Error(`Unsupported file type: ${mimeType}`);
    }

    console.log('✅ Step 11: Using MinerU for document understanding...');

    const mineruApiKey = Deno.env.get('MINERU_API_KEY');
    if (!mineruApiKey) {
      throw new Error('MINERU_API_KEY is not configured');
    }

    const mineruClient = new MineruClient({
      apiKey: mineruApiKey,
      baseUrl: Deno.env.get('MINERU_API_URL') ?? undefined,
      organizationId: Deno.env.get('MINERU_ORG_ID') ?? undefined
    });

    let mineruPages: MineruPage[] = [];
    let mineruText = '';
    let mineruStructureSummary: MineruStructuralSummary | null = null;

    try {
      const analysis = await mineruClient.analyzeDocument({
        bytes,
        mimeType,
        documentId: document_id,
        fileName: document.file_name ?? document.original_name ?? 'document.pdf',
      });

      mineruPages = analysis.pages;
      mineruText = analysis.text;
      mineruStructureSummary = analysis.structureSummary;
      console.log('✅ MinerU: extracted', {
        pages: mineruPages.length,
        characters: mineruText.length,
        confidence: mineruStructureSummary?.confidence
      });
    } catch (mineruError) {
      if (mineruError instanceof MineruHttpError) {
        console.error('❌ MinerU analysis failed', {
          status: mineruError.status,
          endpoint: mineruError.endpoint,
          hint: mineruError.hint,
        });
        throw mineruError;
      }

      const message = mineruError instanceof Error ? mineruError.message : String(mineruError);
      console.error('❌ MinerU analysis failed', message);
      throw new Error(`MinerU extraction failed: ${message}`);
    }

    if (mineruPages.length === 0 || mineruText.trim().length === 0) {
      throw new Error('MinerU returned empty document analysis');
    }

    const { sections, sources: segmentationSources } = convertMineruPagesToSections(mineruPages);
    const segmentationProductHeuristic = inferProductTypeFromText(mineruText, 'segmentation');
    const textConfidence = calculateExtractionConfidence(sections);

    // Define JSON Schema for structured extraction (updated for unified structure)
    const extractionSchema = {
      name: "extract_insurance_data",
      description: "Extract structured data from insurance policy document in unified format",
      parameters: {
        type: "object",
        properties: {
          insurer: {
            type: "string",
            description: "Name of the insurance company"
          },
          calculation_id: {
            type: "string",
            description: "Calculation or offer ID from document"
          },
          product_type: {
            type: "string",
            description: "Type of insurance product"
          },
          insured: {
            type: "array",
            description: "List of insured persons with their plans",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                age: {
                  anyOf: [
                    { type: "number" },
                    {
                      type: "string",
                      description: "Age as number string, e.g. '38'"
                    }
                  ]
                },
                role: { type: "string" },
                plans: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      type: { type: "string" },
                      sum: {
                        anyOf: [
                          { type: "number" },
                          {
                            type: "string",
                            description: "Sum insured as number string, e.g. '50000' or '50 000 PLN'"
                          }
                        ]
                      },
                      premium: {
                        anyOf: [
                          { type: "number" },
                          {
                            type: "string",
                            description: "Premium amount as number string, e.g. '123.45'"
                          }
                        ]
                      },
                      variant: { type: "string" },
                      duration: { type: "string" }
                    }
                  }
                }
              }
            }
          },
          base_contracts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                sum: {
                  anyOf: [
                    { type: "number" },
                    {
                      type: "string",
                      description: "Coverage sum as number string"
                    }
                  ]
                },
                premium: {
                  anyOf: [
                    { type: "number" },
                    {
                      type: "string",
                      description: "Premium amount as number string"
                    }
                  ]
                },
                variant: { type: "string" }
              }
            }
          },
          additional_contracts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                coverage: { type: "string" },
                premium: {
                  anyOf: [
                    { type: "number" },
                    {
                      type: "string",
                      description: "Premium amount as number string"
                    }
                  ]
                }
              }
            }
          },
          discounts: {
            type: "array",
            items: { type: "string" }
          },
          total_premium_before_discounts: {
            anyOf: [
              { type: "number" },
              {
                type: "string",
                description: "Total premium before discounts as number string"
              }
            ],
            description: "Total premium before any discounts"
          },
          total_premium_after_discounts: {
            anyOf: [
              { type: "number" },
              {
                type: "string",
                description: "Total premium after discounts as number string"
              }
            ],
            description: "Final total premium after discounts"
          },
          assistance: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                coverage: { type: "string" },
                limits: { type: "string" },
                response_time: { type: "string" },
                contact: { type: "string" },
                exclusions: {
                  type: "array",
                  items: { type: "string" }
                }
              }
            }
          },
          duration: {
            type: "object",
            properties: {
              start: { type: "string" },
              end: { type: "string" },
              variant: { type: "string" }
            }
          },
          notes: {
            type: "array",
            items: { type: "string" }
          },
          // Legacy fields for backward compatibility
          coverage: {
            type: "object",
            additionalProperties: true
          },
            exclusions: {
              type: "array",
              items: {
                anyOf: [
                  { type: "string" },
                  {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      description: { type: "string" },
                      keywords: {
                        type: "array",
                        items: { type: "string" }
                      }
                    }
                  }
                ]
              }
            },
          deductible: {
            type: "object",
            properties: {
              amount: { type: "string" },
              currency: { type: "string" }
            }
          },
          premium: {
            type: "object",
            properties: {
              total: { type: "string" },
              currency: { type: "string" },
              period: { type: "string" }
            }
          },
          valid_from: { type: "string" },
          valid_to: { type: "string" }
        },
        required: ["insurer"]
      }
    };

    console.log('✅ Step 15: Preparing Lovable AI Gateway payload...');

    let extractedData: any = {};

    const pagesPerSegment = mineruPages.length > 6 ? 4 : 3;
    const segmentsCount = Math.max(1, Math.ceil(mineruPages.length / pagesPerSegment));

    for (let segmentIndex = 0; segmentIndex < segmentsCount; segmentIndex++) {
      const start = segmentIndex * pagesPerSegment;
      const end = Math.min(start + pagesPerSegment, mineruPages.length);
      const segmentPages = mineruPages.slice(start, end);
      const segmentText = segmentPages.map(page => page.text).join('\n\n');
      const segmentPageStart = segmentPages[0]?.pageNumber ?? start + 1;
      const segmentPageEnd = segmentPages[segmentPages.length - 1]?.pageNumber ?? end;

      const segmentSections = sections.filter(section => {
        if (!section.pageRange) return false;
        return (
          section.pageRange.start >= segmentPageStart &&
          section.pageRange.end <= segmentPageEnd
        );
      });

      const segmentSummary = segmentSections
        .map(section => `${section.type}(${Math.round(section.confidence * 100)}%)`)
        .join(', ') || 'brak sekcji';

      const structuralSummary = mineruStructureSummary?.pages
        ?.filter(page => page.pageNumber >= segmentPageStart && page.pageNumber <= segmentPageEnd)
        ?.map(page => {
          const headings = page.headings?.slice(0, 5).join(', ') || 'brak nagłówków';
          return `Strona ${page.pageNumber}: ${page.blockCount} bloków, nagłówki: ${headings}`;
        }) ?? [];

      const segmentContent: LovableContentBlock[] = [
        {
          type: 'text',
          text: `Segment ${segmentIndex + 1}/${segmentsCount}. Strony ${segmentPageStart}-${segmentPageEnd}. Tekst:\n\n${segmentText}`
        },
        {
          type: 'text',
          text: `Sekcje z MinerU: ${segmentSummary}`
        }
      ];

      if (structuralSummary.length > 0) {
        segmentContent.push({
          type: 'text',
          text: `Struktura segmentu: ${structuralSummary.join(' | ')}`
        });
      }

      console.log(`🚚 Segment ${segmentIndex + 1}/${segmentsCount} wysłany do AI (długość tekstu: ${segmentText.length})`);

      const aiSegmentData = await callLovableWithRetry(
        lovableApiKey,
        extractionSchema.parameters,
        segmentContent,
        {
          maxRetries: 1,
          timeoutMs: 120000
        }
      );

      const parsedSegmentData = parseAiExtractionResponse(aiSegmentData);
      extractedData = mergeExtractedData(extractedData, parsedSegmentData);
    }

      console.log('✅ Step 20: Building unified offer structure...');

      const unifiedOfferResult = buildUnifiedOffer(
        sections,
        {
          documentId: document_id,
          fileName: document.file_name,
          calculationId: extractedData?.calculation_id || extractedData?.calculationId
        },
        extractedData
      );
      const unifiedOffer = unifiedOfferResult.offer;
      const unifiedSources = unifiedOfferResult.sources;
      const builderProductHeuristic = unifiedOfferResult.productTypeHeuristic;

      console.log('✅ Step 21: Unified offer structure complete');
      console.log(`📊 Offer ID: ${unifiedOffer.offer_id}`);
      console.log(`📊 Confidence: ${unifiedOffer.extraction_confidence}`);
      console.log(`📊 Missing fields: ${unifiedOffer.missing_fields.length}`);

      const aggregatedSources = [
        ...segmentationSources.map(source => ({
          origin: 'segmentation' as const,
          category: source.sectionType,
          sectionType: source.sectionType,
          pageRange: source.pageRange ?? null,
          snippet: source.snippet,
          confidence: source.confidence
        })),
        ...unifiedSources.map(source => ({
          origin: 'unified_builder' as const,
          category: source.category,
          sectionType: source.sectionType,
          pageRange: source.pageRange ?? null,
          snippet: source.snippet,
          confidence: source.confidence
        }))
      ];

      const aiProductType = typeof extractedData?.product_type === 'string'
        ? extractedData.product_type
        : typeof extractedData?.productType === 'string'
          ? extractedData.productType
          : null;

      const heuristicPredictions = {
        segmentation: segmentationProductHeuristic,
        unified_builder: builderProductHeuristic
      };

      const resolvedProductType =
        aiProductType ||
        segmentationProductHeuristic?.predictedType ||
        builderProductHeuristic?.predictedType ||
        null;

      if (aiProductType) {
        console.log(`📊 AI product type: ${aiProductType}`);
      }
      if (segmentationProductHeuristic?.predictedType) {
        console.log(
          `📊 Segmentation heuristic product type: ${segmentationProductHeuristic.predictedType} (${Math.round(segmentationProductHeuristic.confidence * 100)}%)`
        );
      }
      if (builderProductHeuristic?.predictedType) {
        console.log(
          `📊 Builder heuristic product type: ${builderProductHeuristic.predictedType} (${Math.round(builderProductHeuristic.confidence * 100)}%)`
        );
      }

      if (!resolvedProductType) {
        console.warn('⚠️ Product type not detected by AI ani heurystyki');
      }

      const currencyNormalization = {
        status: 'pending',
        normalized_fields: [],
        available: false,
        notes: 'awaiting normalization pipeline'
      };

      const mineruDiagnostics = mineruStructureSummary
        ? {
            provider: 'mineru',
            confidence: mineruStructureSummary.confidence,
            block_counts: mineruStructureSummary.blockCounts,
            tables: mineruStructureSummary.tables,
            key_value_pairs: mineruStructureSummary.keyValuePairs,
            pages: mineruStructureSummary.pages
          }
        : null;

      const diagnostics = {
        extraction_confidence: unifiedOffer.extraction_confidence,
        missing_fields: unifiedOffer.missing_fields,
        sections: sections.map((section, index) => ({
          index,
          type: section.type,
          confidence: section.confidence,
          keywords: section.keywords,
          pageRange: section.pageRange,
          snippet: section.snippet
        })),
        text_confidence: textConfidence,
        segments_processed: segmentsCount,
        product_type_predictions: {
          ai: aiProductType,
          heuristic: heuristicPredictions,
          resolved: resolvedProductType
        },
        sources: aggregatedSources,
        currency_normalization: currencyNormalization,
        mineru: mineruDiagnostics
      };

      // Merge unified structure with original extracted data for backward compatibility
      const finalData: Record<string, any> = {
        ...extractedData
      };

      if (resolvedProductType && !finalData.product_type) {
        finalData.product_type = resolvedProductType;
      }
      if (resolvedProductType && !finalData.productType) {
        finalData.productType = resolvedProductType;
      }

      const existingPredictions =
        typeof finalData.product_type_predictions === 'object' && finalData.product_type_predictions !== null
          ? finalData.product_type_predictions
          : {};
      finalData.product_type_predictions = {
        ...existingPredictions,
        ai: aiProductType,
        heuristic: heuristicPredictions,
        resolved: resolvedProductType
      };

      const existingSources = Array.isArray(finalData.sources) ? finalData.sources : [];
      finalData.sources = [...existingSources, ...aggregatedSources];
      finalData.currency_normalization = {
        ...(typeof finalData.currency_normalization === 'object' && finalData.currency_normalization !== null
          ? finalData.currency_normalization
          : {}),
        ...currencyNormalization
      };
      finalData.unified = unifiedOffer;
      finalData.diagnostics = diagnostics;

      const normalizedProductType = normalizeProductTypeValue(finalData.product_type);
      finalData.product_type = normalizedProductType;

      if (finalData.resolved && typeof finalData.resolved === 'object') {
        finalData.resolved = {
          ...finalData.resolved,
          product_type: normalizedProductType
        };
      }

      if (Array.isArray(finalData.documents)) {
        finalData.documents = finalData.documents.map((doc: any) => ({
          ...doc,
          product_type: normalizeProductTypeValue(doc?.product_type ?? normalizedProductType)
        }));
      }

      console.log('✅ Step 22: Updating document with extracted data...');

    // Update document with extracted data
    const { error: updateError } = await supabase
      .from('documents')
      .update({
        extracted_data: finalData,
        status: 'completed'
      })
      .eq('id', document_id);

    if (updateError) {
      throw new Error(`Failed to update document: ${updateError.message}`);
    }

    console.log('✅ Step 23: Document processed successfully:', document_id);

    // Note: No cleanup needed - we're using base64 directly, not storage

    return new Response(
      JSON.stringify({ 
        success: true, 
        data: finalData,
        unified: unifiedOffer 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const mineruHttpError = error instanceof MineruHttpError ? error : undefined;
    const rawMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorMessage = mineruHttpError?.hint ?? rawMessage;

    console.error('Error in extract-insurance-data:', {
      message: rawMessage,
      document_id,
      status: mineruHttpError?.status,
      hint: mineruHttpError?.hint,
    });

    // Update document status to 'failed'
    if (document_id && supabase) {
      try {
        const { data: currentDoc } = await supabase
          .from('documents')
          .select('extracted_data')
          .eq('id', document_id)
          .single();

        const attemptCount = (currentDoc?.extracted_data?.attempt_count || 0) + 1;

        await supabase
          .from('documents')
          .update({
            status: 'failed',
            extracted_data: {
              error: errorMessage,
              failed_at: new Date().toISOString(),
              attempt_count: attemptCount
            }
          })
          .eq('id', document_id);

        console.log('Document status updated to failed:', document_id);
      } catch (updateError) {
        const updateMessage = updateError instanceof Error ? updateError.message : String(updateError);
        console.error('Failed to update document status:', { message: updateMessage, document_id });
      }
    }

    const statusCode = mineruHttpError?.status ?? 500;
    const responsePayload = mineruHttpError
      ? {
          error: 'MinerU extraction failed',
          status: mineruHttpError.status,
          hint: mineruHttpError.hint,
        }
      : { error: errorMessage };

    return new Response(
      JSON.stringify(responsePayload),
      { status: statusCode, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

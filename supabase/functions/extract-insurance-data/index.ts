import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as base64Encode, decode as base64Decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { parsePdfText, combinePagesText, ParsedPage } from './pdf-parser.ts';
import {
  segmentInsuranceSections,
  calculateExtractionConfidence,
  ParsedSection,
  SectionSource,
  ProductTypeHeuristicResult
} from './classifier.ts';
import { buildUnifiedOffer, UnifiedOfferBuildResult } from './unified-builder.ts';

type LovableContentBlock = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

const IMAGE_PAYLOAD_TARGET_BYTES = 4 * 1024 * 1024; // 4 MB safety window before hard 6 MB limit

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

function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return '';
  }

  // Convert Uint8Array to ArrayBuffer for base64Encode
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return base64Encode(arrayBuffer);
}

function base64ToUint8Array(base64: string): Uint8Array {
  if (!base64) {
    return new Uint8Array();
  }

  return base64Decode(base64);
}

async function shrinkImageIfNeeded(
  bytes: Uint8Array,
  mimeType: string,
  maxBytes: number = IMAGE_PAYLOAD_TARGET_BYTES
): Promise<{ bytes: Uint8Array; mimeType: string; warning?: string }> {
  if (bytes.length <= maxBytes) {
    return { bytes, mimeType };
  }

  const convertApiSecret = Deno.env.get('CONVERTAPI_SECRET');
  console.warn(
    `⚠️ Image payload ${(bytes.length / (1024 * 1024)).toFixed(2)}MB exceeds ${(maxBytes / (1024 * 1024)).toFixed(2)}MB target. Attempting compression.`
  );

  if (!convertApiSecret) {
    console.warn('⚠️ Cannot shrink image - CONVERTAPI_SECRET missing.');
    return {
      bytes,
      mimeType,
      warning: 'Image exceeds recommended size and compression was skipped due to missing CONVERTAPI_SECRET.'
    };
  }

  const extension = mimeType.split('/')[1] || 'image';
  const formData = new FormData();
  // Extract ArrayBuffer from Uint8Array for Blob
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([arrayBuffer], { type: mimeType });
  formData.append('File', blob, `image.${extension}`);
  formData.append('ImageResolution', '150');
  formData.append('JpgQuality', '70');

  const response = await fetch(
    `https://v2.convertapi.com/convert/${extension}/to/jpg?Secret=${convertApiSecret}`,
    {
      method: 'POST',
      body: formData
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ Image compression failed:', errorText);
    return {
      bytes,
      mimeType,
      warning: 'Image compression attempt failed; using original bytes.'
    };
  }

  const result = await response.json();

  if (!result.Files || !Array.isArray(result.Files) || !result.Files[0]?.FileData) {
    console.error('❌ Image compression response invalid:', result);
    return {
      bytes,
      mimeType,
      warning: 'Image compression response invalid; using original bytes.'
    };
  }

  const compressedBytes = base64ToUint8Array(result.Files[0].FileData);
  console.log(
    '🛠️ Image compressed via ConvertAPI',
    {
      beforeMB: (bytes.length / (1024 * 1024)).toFixed(2),
      afterMB: (compressedBytes.length / (1024 * 1024)).toFixed(2)
    }
  );

  return {
    bytes: compressedBytes,
    mimeType: 'image/jpeg',
    warning: 'Image was recompressed to JPEG to fit payload recommendations.'
  };
}

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

// Helper: Convert PDF to JPG using ConvertAPI - returns base64 encoded JPGs
async function convertPdfToJpgs(
  pdfBytes: Uint8Array,
  maxPages: number = 3
): Promise<{ base64Pages: string[], sizes: number[] }> {
  const convertApiSecret = Deno.env.get('CONVERTAPI_SECRET');
  console.log('📝 ConvertAPI: Secret present?', !!convertApiSecret);
  console.log('📝 ConvertAPI: Input size', pdfBytes.length, 'bytes');
  
  if (!convertApiSecret) {
    throw new Error('CONVERTAPI_SECRET is not configured');
  }
  
  const formData = new FormData();
  // Create a Blob object from the Uint8Array for better Deno compatibility
  const pdfBlob = new Blob([pdfBytes as any], { type: 'application/pdf' });
  formData.append('File', pdfBlob, 'document.pdf');
  formData.append('PageRange', `1-${maxPages}`);
  formData.append('ImageResolution', '150'); // DPI
  formData.append('JpgQuality', '70'); // 0-100
  
  console.log('📝 ConvertAPI: Sending request...');
  
  const response = await fetch(
    `https://v2.convertapi.com/convert/pdf/to/jpg?Secret=${convertApiSecret}`,
    {
      method: 'POST',
      body: formData
    }
  );
  
  console.log('📝 ConvertAPI: Response status', response.status);
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ ConvertAPI: Error response', errorText);
    throw new Error(`ConvertAPI failed: ${response.status} - ${errorText}`);
  }
  
  const result = await response.json();
  console.log('📝 ConvertAPI: Result structure', { 
    hasFiles: !!result.Files, 
    filesCount: result.Files?.length || 0 
  });
  
  // Validate response structure
  if (!result.Files || !Array.isArray(result.Files) || result.Files.length === 0) {
    console.error('❌ ConvertAPI: Invalid response format', result);
    throw new Error('ConvertAPI returned invalid response: no Files array');
  }
  
  const base64Pages: string[] = [];
  const sizes: number[] = [];
  
  for (let i = 0; i < result.Files.length; i++) {
    const file = result.Files[i];
    
    // Validate that FileData exists
    if (!file.FileData) {
      console.error(`❌ ConvertAPI: File ${i + 1} missing FileData`, file);
      throw new Error(`ConvertAPI File ${i + 1} has no FileData - check ConvertAPI configuration`);
    }
    
    base64Pages.push(file.FileData);
    sizes.push(file.FileSize);
    console.log(`✅ Page ${i + 1}: ${(file.FileSize / 1024).toFixed(1)}KB`);
  }
  
  return { base64Pages, sizes };
}

// Helper removed: No longer uploading to storage, using base64 directly

// Helper: Cleanup temporary files
async function cleanupTempFiles(supabase: any, documentId: string) {
  try {
    const { data: files } = await supabase.storage
      .from('tmp-ai-inputs')
      .list(documentId);
    
    if (files && files.length > 0) {
      const filePaths = files.map((f: any) => `${documentId}/${f.name}`);
      await supabase.storage
        .from('tmp-ai-inputs')
        .remove(filePaths);
      console.log(`Cleaned up ${filePaths.length} temporary files`);
    }
  } catch (cleanupError) {
    console.error('Cleanup failed:', cleanupError);
  }
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
    
    const mimeType = document.mime_type || 'application/pdf';
    
    // Step 1: Try to extract text from PDF
    let parsedText = '';
    let parsedPages: ParsedPage[] = [];
    let parsedLines: string[] | undefined;
    let linePageMap: number[] | undefined;
    let useTextExtraction = false;

    if (mimeType === 'application/pdf') {
      console.log('📖 Step 11a: Attempting text extraction from PDF...');
      const parseResult = await parsePdfText(bytes);

      if (parseResult.success && parseResult.pages.length > 0) {
        parsedText = parseResult.fullText ?? combinePagesText(parseResult.pages);
        parsedPages = parseResult.pages;
        parsedLines = parseResult.lines;
        linePageMap = parseResult.linePageMap;
        useTextExtraction = parsedText.length > 100; // Only use if we got meaningful text
        console.log(`✅ Text extraction ${useTextExtraction ? 'successful' : 'insufficient'}: ${parsedText.length} chars`);
      }
    }

    // Prepare containers for AI payloads
    let imageContent: LovableContentBlock[] = [];
    let sections: ParsedSection[] = [];
    let segmentationSources: SectionSource[] = [];
    let segmentationProductHeuristic: ProductTypeHeuristicResult | null = null;
    let textConfidence: 'high' | 'medium' | 'low' = 'low';
    let previewImage: string | null = null;
    
    // Handle PDFs - convert to JPG and use base64 directly
    if (mimeType === 'application/pdf') {
      console.log('✅ Step 11: Detected PDF, starting conversion...');
      
      // Determine max pages based on file size (degradation)
      let maxPages = 3;
      if (fileSizeMB > 15) {
        maxPages = 1;
        console.log('⚠️ Large PDF (>15MB): limiting to 1 page');
      } else if (fileSizeMB > 10) {
        maxPages = 2;
        console.log('⚠️ Medium PDF (>10MB): limiting to 2 pages');
      }
      
      // Convert PDF to JPG base64
      const { base64Pages, sizes } = await convertPdfToJpgs(bytes, maxPages);
      console.log(`✅ Step 12: Converted to ${base64Pages.length} JPG(s), sizes:`, sizes.map(s => `${(s / 1024).toFixed(1)}KB`));
      
      // Calculate total size
      const totalSize = sizes.reduce((sum, size) => sum + size, 0);
      const totalSizeMB = totalSize / (1024 * 1024);
      console.log(`✅ Step 13: Total payload size: ${totalSizeMB.toFixed(2)}MB`);
      
      // Check payload limit (6 MB for base64)
      if (totalSize > 6 * 1024 * 1024) {
        console.warn(`⚠️ Total size ${totalSizeMB.toFixed(2)}MB exceeds 6MB limit`);
        throw new Error(`Converted images too large (${totalSizeMB.toFixed(1)}MB). Please use a smaller PDF or fewer pages.`);
      }
      
        // Build content array - prefer text if available
        if (useTextExtraction && parsedText) {
          console.log('🔍 Step 14a: Classifying document sections...');
          const segmentationOutput = segmentInsuranceSections({
            pages: parsedPages,
            linePageMap,
            lines: parsedLines,
            fullText: parsedText
          });
          sections = segmentationOutput.sections;
          segmentationSources = segmentationOutput.sources;
          segmentationProductHeuristic = segmentationOutput.productTypeHeuristic;
          textConfidence = calculateExtractionConfidence(sections);
          previewImage = base64Pages.length > 0 ? base64Pages[0] : null;
          console.log(`📊 Section classification complete (confidence: ${textConfidence})`);
          console.log(`✅ Step 14: Using segmented text extraction with ${sections.length} zidentyfikowanych sekcji`);
        } else {
          // Fallback to image-only approach
          imageContent = [
            { type: 'text', text: `Ekstrahuj dane z tego dokumentu ubezpieczeniowego (${base64Pages.length} ${base64Pages.length === 1 ? 'strona' : 'strony'}):` },
            ...base64Pages.map(base64 => ({
              type: 'image_url' as const,
              image_url: { url: `data:image/jpeg;base64,${base64}` }
            }))
          ];

          previewImage = base64Pages.length > 0 ? base64Pages[0] : null;

          console.log(`✅ Step 14: Prepared ${base64Pages.length} image(s) as base64 data URLs (text extraction failed)`);
        }
      
    } else if (['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
      console.log('✅ Step 11: Detected image format, using base64...');
      console.log('📝 Step 11a: Raw image byte length', bytes.length);

      const { bytes: preparedBytes, mimeType: preparedMimeType, warning } = await shrinkImageIfNeeded(bytes, mimeType);

      if (warning) {
        console.warn(`⚠️ Image preprocessing warning: ${warning}`);
      }

      if (preparedBytes !== bytes) {
        console.log(
          '🛠️ Step 11b: Image bytes adjusted',
          {
            beforeMB: (bytes.length / (1024 * 1024)).toFixed(2),
            afterMB: (preparedBytes.length / (1024 * 1024)).toFixed(2)
          }
        );
      }

      if (preparedBytes.length > 6 * 1024 * 1024) {
        throw new Error('Image file too large (max 6MB). Please reduce file size.');
      }

      const base64 = uint8ArrayToBase64(preparedBytes);
      console.log('📝 Step 11c: Base64 payload length', base64.length);

      imageContent.push({
        type: 'image_url',
        image_url: { url: `data:${preparedMimeType};base64,${base64}` }
      });

      previewImage = base64;

      console.log('✅ Step 12: Image prepared as base64');
    } else {
      throw new Error(`Unsupported file type: ${mimeType}`);
    }

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

      if (useTextExtraction && parsedPages.length > 0) {
        console.log('✅ Step 16: Running segmented text extraction');
        const pagesPerSegment = 3;
        const segmentsCount = Math.ceil(parsedPages.length / pagesPerSegment);

        for (let segmentIndex = 0; segmentIndex < segmentsCount; segmentIndex++) {
          const start = segmentIndex * pagesPerSegment;
          const end = Math.min(start + pagesPerSegment, parsedPages.length);
          const segmentPages = parsedPages.slice(start, end);
          const segmentText = segmentPages.map(page => page.text).join('\n\n');
          const segmentSections = segmentInsuranceSections({ pages: segmentPages }).sections;
          const segmentSummary = segmentSections
            .map(section => `${section.type}(${Math.round(section.confidence * 100)}%)`)
            .join(', ') || 'brak sekcji';
          const segmentPageStart = segmentPages[0]?.pageNumber ?? start + 1;
          const segmentPageEnd = segmentPages[segmentPages.length - 1]?.pageNumber ?? end;

          const segmentContent: LovableContentBlock[] = [
            {
              type: 'text',
              text: `Segment ${segmentIndex + 1}/${segmentsCount}. Strony ${segmentPageStart}-${segmentPageEnd}. Tekst:\n\n${segmentText}`
            },
            {
              type: 'text',
              text: `Sekcje w segmencie: ${segmentSummary}`
            }
          ];

          if (segmentIndex === 0 && previewImage) {
            segmentContent.push({
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${previewImage}` }
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
      } else {
        console.log('✅ Step 16: Calling Lovable AI using image-based fallback');
        const aiData = await callLovableWithRetry(
          lovableApiKey,
          extractionSchema.parameters,
          imageContent,
          {
            maxRetries: 2,
            timeoutMs: 120000,
            onRetry: async (errorText) => {
              if ((errorText.includes('Failed to extract') || errorText.includes('too large')) && mimeType === 'application/pdf') {
                console.log('⚠️ Degrading: reducing to 1 page and retrying...');
                const { base64Pages: degradedPages } = await convertPdfToJpgs(bytes, 1);
                return {
                  shouldRetry: true,
                  updatedContent: [
                    { type: 'text', text: 'Ekstrahuj dane z pierwszej strony dokumentu:' },
                    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${degradedPages[0]}` } }
                  ]
                };
              }

              return { shouldRetry: false };
            }
          }
        );

        extractedData = parseAiExtractionResponse(aiData);
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
        segments_processed: useTextExtraction && parsedPages.length > 0
          ? Math.ceil(parsedPages.length / 3)
          : 1,
        product_type_predictions: {
          ai: aiProductType,
          heuristic: heuristicPredictions,
          resolved: resolvedProductType
        },
        sources: aggregatedSources,
        currency_normalization: currencyNormalization
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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in extract-insurance-data:', { message: errorMessage, document_id });

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

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let document_id: string | undefined;
  let supabase: any;
  
  try {
    console.log('✅ Step 1: Request received');
    
    const body = await req.json();
    console.log('✅ Step 2: Body parsed', { document_id: body.document_id });
    
    document_id = body.document_id;
    console.log('✅ Step 3: Document ID extracted:', document_id);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;
    console.log('✅ Step 4: Env vars loaded');

    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('✅ Step 5: Supabase client created');

    // Get document details
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('*')
      .eq('id', document_id)
      .single();
    
    console.log('✅ Step 6: Document fetched', { exists: !!document, error: !!docError });

    if (docError || !document) {
      throw new Error('Document not found');
    }
    
    console.log('✅ Step 7: Document details', { 
      mime_type: document.mime_type, 
      file_path: document.file_path 
    });

    // Update status to processing
    await supabase
      .from('documents')
      .update({ status: 'processing' })
      .eq('id', document_id);
    
    console.log('✅ Step 8: Status updated to processing');

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
    
    // Prepare image content array for AI
    let imageContent: Array<{ type: string; image_url?: { url: string }; text?: string }> = [
      { type: 'text', text: 'Ekstrahuj dane z tego dokumentu ubezpieczeniowego:' }
    ];
    
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
      
      // Build content array with base64 data URLs
      imageContent = [
        { type: 'text', text: `Ekstrahuj dane z tego dokumentu ubezpieczeniowego (${base64Pages.length} ${base64Pages.length === 1 ? 'strona' : 'strony'}):` },
        ...base64Pages.map(base64 => ({
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${base64}` }
        }))
      ];
      
      console.log(`✅ Step 14: Prepared ${base64Pages.length} image(s) as base64 data URLs`);
      
    } else if (['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
      console.log('✅ Step 11: Detected image format, using base64...');
      // For images: use base64 directly (no conversion needed)
      const base64 = btoa(String.fromCharCode(...bytes));
      
      // Check size limit
      if (bytes.length > 6 * 1024 * 1024) {
        throw new Error('Image file too large (max 6MB). Please reduce file size.');
      }
      
      imageContent.push({
        type: 'image_url',
        image_url: { url: `data:${mimeType};base64,${base64}` }
      });
      
      console.log('✅ Step 12: Image prepared as base64');
    } else {
      throw new Error(`Unsupported file type: ${mimeType}`);
    }

    // Define JSON Schema for structured extraction
    const extractionSchema = {
      name: "extract_insurance_data",
      description: "Extract structured data from insurance policy document",
      parameters: {
        type: "object",
        properties: {
          insurer: {
            type: "string",
            description: "Name of the insurance company"
          },
          product_type: {
            type: "string",
            description: "Type of insurance product (e.g., 'OC/AC', 'Życie', 'Majątek')"
          },
          coverage: {
            type: "object",
            description: "Coverage details with amounts",
            additionalProperties: true
          },
          exclusions: {
            type: "array",
            description: "List of coverage exclusions",
            items: { type: "string" }
          },
          deductible: {
            type: "object",
            description: "Deductible information",
            properties: {
              amount: { type: "string" },
              currency: { type: "string" }
            }
          },
          assistance: {
            type: "array",
            description: "List of assistance services",
            items: { type: "string" }
          },
          premium: {
            type: "object",
            description: "Premium information",
            properties: {
              total: { type: "string" },
              currency: { type: "string" },
              period: { type: "string" }
            },
            required: ["total"]
          },
          valid_from: {
            type: "string",
            description: "Policy start date (ISO format or natural language)"
          },
          valid_to: {
            type: "string",
            description: "Policy end date (ISO format or natural language)"
          }
        },
        required: ["insurer", "product_type", "premium"]
      }
    };

    console.log('✅ Step 15: Calling Lovable AI Gateway...');
    
    // Call Lovable AI with retry logic
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 min timeout

    let aiResponse;
    let retryCount = 0;
    const maxRetries = 2;
    
    while (retryCount <= maxRetries) {
      try {
        console.log(`✅ Step 16.${retryCount + 1}: Sending AI request (attempt ${retryCount + 1}/${maxRetries + 1})...`);
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
                content: 'Jesteś ekspertem od ekstrakcji danych z ofert ubezpieczeniowych. Ekstrahuj wszystkie istotne informacje z dokumentu.'
              },
              {
                role: 'user',
                content: imageContent
              }
            ],
            tools: [
              {
                type: "function",
                function: extractionSchema
              }
            ],
            tool_choice: {
              type: "function",
              function: { name: "extract_insurance_data" }
            }
          }),
        });
        
        console.log('✅ Step 17: AI response received, status:', aiResponse.status);
        
        if (aiResponse.ok) {
          console.log('✅ Step 18: AI request successful!');
          break; // Success - exit retry loop
        } else {
          const errorText = await aiResponse.text();
          console.error(`❌ AI API error (attempt ${retryCount + 1}):`, errorText);
          
          // Check if we should retry with degradation
          if ((errorText.includes('Failed to extract') || errorText.includes('too large')) && retryCount < maxRetries) {
            retryCount++;
            console.log(`⚠️ Degrading: reducing to 1 page and retrying...`);
            
            // Degradation: use only page 1 with lower quality
            if (mimeType === 'application/pdf') {
              const { base64Pages } = await convertPdfToJpgs(bytes, 1); // Only page 1
              
              imageContent = [
                { type: 'text', text: 'Ekstrahuj dane z pierwszej strony dokumentu:' },
                { 
                  type: 'image_url', 
                  image_url: { url: `data:image/jpeg;base64,${base64Pages[0]}` } 
                }
              ];
              console.log('✅ Degradation: using only 1 page as base64');
            }
          } else {
            throw new Error(`AI API error: ${aiResponse.status} - ${errorText}`);
          }
        }
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

    const aiData = await aiResponse.json();
    console.log('✅ Step 19: AI response parsed successfully');
    
    // Extract structured data from tool call
    let extractedData;
    try {
      console.log('✅ Step 20: Extracting structured data from AI response...');
      const message = aiData.choices[0].message;
      
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
        raw_response: aiData.choices[0].message 
      };
    }

    console.log('✅ Step 21: Updating document with extracted data...');
    
    // Update document with extracted data
    const { error: updateError } = await supabase
      .from('documents')
      .update({
        extracted_data: extractedData,
        status: 'completed'
      })
      .eq('id', document_id);

    if (updateError) {
      throw new Error(`Failed to update document: ${updateError.message}`);
    }

    console.log('✅ Step 22: Document processed successfully:', document_id);

    // Note: No cleanup needed - we're using base64 directly, not storage

    return new Response(
      JSON.stringify({ success: true, data: extractedData }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in extract-insurance-data:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
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
        console.error('Failed to update document status:', updateError);
      }
    }
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

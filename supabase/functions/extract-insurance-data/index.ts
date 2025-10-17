import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let document_id: string | undefined;
  
  try {
    const body = await req.json();
    document_id = body.document_id;
    console.log('Processing document:', document_id);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get document details
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('*')
      .eq('id', document_id)
      .single();

    if (docError || !document) {
      throw new Error('Document not found');
    }

    // Update status to processing
    await supabase
      .from('documents')
      .update({ status: 'processing' })
      .eq('id', document_id);

    // Download file from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('insurance-documents')
      .download(document.file_path);

    if (downloadError) {
      throw new Error(`Failed to download file: ${downloadError.message}`);
    }

    // Convert to base64 for AI processing
    const arrayBuffer = await fileData.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    
    const fileSizeMB = bytes.length / (1024 * 1024);
    console.log(`File size: ${fileSizeMB.toFixed(2)}MB`);
    
    const mimeType = document.mime_type || 'application/pdf';
    
    // Helper function to convert bytes to base64
    const bytesToBase64 = (bytes: Uint8Array): string => {
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
        binary += String.fromCharCode.apply(null, Array.from(chunk));
      }
      return btoa(binary);
    };
    
    // Prepare image content array for AI
    const imageContent: Array<{ type: string; image_url?: { url: string }; text?: string }> = [
      { type: 'text', text: 'Ekstrahuj dane z tego dokumentu ubezpieczeniowego:' }
    ];
    
    // Handle PDFs differently - extract first 3 pages as separate images
    if (mimeType === 'application/pdf') {
      try {
        console.log('Processing PDF - extracting first 3 pages...');
        const pdfDoc = await PDFDocument.load(bytes);
        const totalPages = pdfDoc.getPageCount();
        const pagesToExtract = Math.min(3, totalPages);
        
        console.log(`PDF has ${totalPages} pages, extracting ${pagesToExtract} pages`);
        
        for (let i = 0; i < pagesToExtract; i++) {
          // Create a new PDF with just one page
          const singlePagePdf = await PDFDocument.create();
          const [copiedPage] = await singlePagePdf.copyPages(pdfDoc, [i]);
          singlePagePdf.addPage(copiedPage);
          
          // Convert to bytes
          const pdfBytes = await singlePagePdf.save();
          const base64 = bytesToBase64(new Uint8Array(pdfBytes));
          
          console.log(`Page ${i + 1}: ${(pdfBytes.length / 1024).toFixed(1)}KB`);
          
          imageContent.push({
            type: 'image_url',
            image_url: {
              url: `data:application/pdf;base64,${base64}`
            }
          });
        }
      } catch (error) {
        console.error('PDF page extraction failed, using full PDF:', error);
        // Fallback to sending full PDF as single image
        const base64 = bytesToBase64(bytes);
        imageContent.push({
          type: 'image_url',
          image_url: {
            url: `data:${mimeType};base64,${base64}`
          }
        });
      }
    } else {
      // For JPG/PNG/WEBP - send as single image
      const base64 = bytesToBase64(bytes);
      imageContent.push({
        type: 'image_url',
        image_url: {
          url: `data:${mimeType};base64,${base64}`
        }
      });
    }
    
    console.log(`Prepared ${imageContent.length - 1} image(s) for AI processing`);

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

    // Call Lovable AI with tool calling for structured extraction
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 min timeout

    let aiResponse;
    try {
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
      clearTimeout(timeoutId);
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('AI processing timeout - file may be too large or complex');
      }
      throw error;
    }

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI API error response:', errorText);
      
      // Parse specific errors
      if (errorText.includes('Failed to extract') && errorText.includes('image')) {
        throw new Error('Plik jest za duży lub w nieobsługiwanym formacie. Spróbuj zmniejszyć rozmiar pliku lub użyć niższej rozdzielczości.');
      }
      
      throw new Error(`AI API error: ${aiResponse.status} - ${errorText}`);
    }

    const aiData = await aiResponse.json();
    console.log('AI response received');
    
    // Extract structured data from tool call
    let extractedData;
    try {
      const message = aiData.choices[0].message;
      
      if (message.tool_calls && message.tool_calls.length > 0) {
        // Data extracted via tool calling (structured)
        const toolCall = message.tool_calls[0];
        extractedData = JSON.parse(toolCall.function.arguments);
        console.log('Structured data extracted via tool calling');
      } else if (message.content) {
        // Fallback: try to parse content as JSON
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

    console.log('Document processed successfully:', document_id);

    return new Response(
      JSON.stringify({ success: true, data: extractedData }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in extract-insurance-data:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Update document status to 'failed' so it doesn't stay stuck in 'processing'
    if (document_id) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseKey);
        
        // Get current attempt count
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

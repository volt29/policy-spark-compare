import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

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

    // Convert to base64 for AI processing using chunked processing
    const arrayBuffer = await fileData.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    
    // Check file size before processing (20MB limit for base64)
    const fileSizeMB = bytes.length / (1024 * 1024);
    if (fileSizeMB > 20) {
      throw new Error(`Plik jest za duży (${fileSizeMB.toFixed(1)}MB). Maksymalny rozmiar: 20MB. Spróbuj zmniejszyć rozdzielczość lub użyć kompresji.`);
    }
    
    let binary = '';
    const chunkSize = 8192; // Process 8KB at a time to avoid call stack limit
    
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    
    const base64 = btoa(binary);
    const mimeType = document.mime_type || 'application/pdf';
    
    console.log(`File size: ${fileSizeMB.toFixed(2)}MB, Base64 length: ${base64.length}`);

    // Call Lovable AI to extract structured data with timeout
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
          model: 'google/gemini-2.5-pro',
          messages: [
            {
              role: 'system',
              content: `Jesteś ekspertem od ekstrakcji danych z ofert ubezpieczeniowych. 
              Ekstrahuj strukturalne dane z dokumentu i zwróć JSON z polami:
              - insurer (string): nazwa ubezpieczyciela
              - product_type (string): typ produktu (np. "OC/AC", "Życie", "Majątek")
              - coverage (object): zakres ubezpieczenia z kwotami
              - exclusions (array): lista wyłączeń
              - deductible (object): franszyza {amount, currency}
              - assistance (array): lista świadczeń assistance
              - premium (object): składka {total, currency, period}
              - valid_from (string): data rozpoczęcia
              - valid_to (string): data zakończenia
              
              Jeśli jakieś pole nie jest dostępne, zwróć null. Zwróć TYLKO JSON bez dodatkowego tekstu.`
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Ekstrahuj dane z tego dokumentu ubezpieczeniowego:'
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${mimeType};base64,${base64}`
                  }
                }
              ]
            }
          ]
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
    const extractedText = aiData.choices[0].message.content;
    
    // Parse JSON from AI response
    let extractedData;
    try {
      // Remove markdown code blocks if present
      const jsonMatch = extractedText.match(/```json\n?([\s\S]*?)\n?```/) || 
                       extractedText.match(/```\n?([\s\S]*?)\n?```/);
      const jsonText = jsonMatch ? jsonMatch[1] : extractedText;
      extractedData = JSON.parse(jsonText.trim());
    } catch (parseError) {
      console.error('Failed to parse AI response as JSON:', extractedText);
      extractedData = { raw_text: extractedText, parse_error: true };
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
        
        await supabase
          .from('documents')
          .update({ 
            status: 'failed',
            extracted_data: { error: errorMessage }
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

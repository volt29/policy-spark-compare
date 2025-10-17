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

  try {
    const { comparison_id } = await req.json();
    console.log('Comparing offers for:', comparison_id);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get comparison details
    const { data: comparison, error: compError } = await supabase
      .from('comparisons')
      .select('*')
      .eq('id', comparison_id)
      .single();

    if (compError || !comparison) {
      throw new Error('Comparison not found');
    }

    // Get all documents for this comparison
    const { data: documents, error: docsError } = await supabase
      .from('documents')
      .select('*')
      .in('id', comparison.document_ids);

    if (docsError || !documents || documents.length === 0) {
      throw new Error('Documents not found');
    }

    // Check if all documents have extracted data
    const documentsWithData = documents.filter(d => d.extracted_data && d.status === 'completed');
    if (documentsWithData.length !== documents.length) {
      throw new Error('Not all documents have been processed yet');
    }

    // Prepare data for AI comparison
    const offersData = documentsWithData.map((doc, idx) => ({
      offer_id: idx + 1,
      insurer: doc.extracted_data.insurer,
      data: doc.extracted_data
    }));

    // Call Lovable AI to compare offers
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: `Jesteś ekspertem od porównywania ofert ubezpieczeniowych.
            Porównaj dostarczone oferty i zwróć szczegółową analizę w formacie JSON:
            {
              "coverage_comparison": {
                "category": "nazwa kategorii",
                "offers": [{
                  "offer_id": 1,
                  "insurer": "nazwa",
                  "value": "wartość",
                  "highlight": "best" | "warning" | "neutral",
                  "note": "opcjonalna notatka"
                }]
              },
              "price_comparison": { podobna struktura },
              "exclusions_diff": { lista różnic w wyłączeniach },
              "assistance_comparison": { porównanie świadczeń assistance },
              "key_highlights": ["najważniejsze różnice"],
              "recommendations": ["zalecenia dla klienta"]
            }
            
            Zwróć TYLKO JSON bez dodatkowego tekstu.`
          },
          {
            role: 'user',
            content: `Porównaj te oferty ubezpieczeniowe:\n\n${JSON.stringify(offersData, null, 2)}`
          }
        ]
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      throw new Error(`AI API error: ${aiResponse.status} - ${errorText}`);
    }

    const aiData = await aiResponse.json();
    const comparisonText = aiData.choices[0].message.content;
    
    // Parse JSON from AI response
    let comparisonData;
    try {
      const jsonMatch = comparisonText.match(/```json\n?([\s\S]*?)\n?```/) || 
                       comparisonText.match(/```\n?([\s\S]*?)\n?```/);
      const jsonText = jsonMatch ? jsonMatch[1] : comparisonText;
      comparisonData = JSON.parse(jsonText.trim());
    } catch (parseError) {
      console.error('Failed to parse AI comparison as JSON:', comparisonText);
      comparisonData = { raw_text: comparisonText, parse_error: true };
    }

    // Update comparison with results
    const { error: updateError } = await supabase
      .from('comparisons')
      .update({
        comparison_data: comparisonData,
        status: 'completed'
      })
      .eq('id', comparison_id);

    if (updateError) {
      throw new Error(`Failed to update comparison: ${updateError.message}`);
    }

    console.log('Comparison completed successfully:', comparison_id);

    return new Response(
      JSON.stringify({ success: true, data: comparisonData }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in compare-offers:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

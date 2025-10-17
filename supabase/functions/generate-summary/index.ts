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
    console.log('Generating summary for:', comparison_id);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get comparison with its data
    const { data: comparison, error: compError } = await supabase
      .from('comparisons')
      .select('*')
      .eq('id', comparison_id)
      .single();

    if (compError || !comparison || !comparison.comparison_data) {
      throw new Error('Comparison or comparison data not found');
    }

    // Call Lovable AI to generate summary
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
            content: `Jesteś doradcą ubezpieczeniowym, który pisze podsumowania dla klientów.
            Na podstawie porównania ofert napisz krótkie, zrozumiałe podsumowanie (max 150 słów):
            - Język prosty i przyjazny dla klienta
            - Podkreśl najważniejsze różnice między ofertami
            - Wskaż ofertę najkorzystniejszą (jeśli jest oczywista)
            - Zwróć uwagę na istotne wyłączenia lub różnice w zakresie
            - Dodaj praktyczne zalecenia
            
            Zwróć sam tekst podsumowania, bez formatowania markdown.`
          },
          {
            role: 'user',
            content: `Napisz podsumowanie na podstawie tego porównania:\n\n${JSON.stringify(comparison.comparison_data, null, 2)}`
          }
        ]
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      throw new Error(`AI API error: ${aiResponse.status} - ${errorText}`);
    }

    const aiData = await aiResponse.json();
    const summaryText = aiData.choices[0].message.content.trim();

    // Update comparison with summary
    const { error: updateError } = await supabase
      .from('comparisons')
      .update({ summary_text: summaryText })
      .eq('id', comparison_id);

    if (updateError) {
      throw new Error(`Failed to update summary: ${updateError.message}`);
    }

    console.log('Summary generated successfully:', comparison_id);

    return new Response(
      JSON.stringify({ success: true, summary: summaryText }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in generate-summary:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

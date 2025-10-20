import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

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

const comparisonSchema = z.object({
  comparison_id: z.string().min(1, "comparison_id is required"),
});

serve(async (req) => {
  const origin = req.headers.get("Origin");
  const corsHeaders = createCorsHeaders(origin);

  if (!isOriginAllowed(origin)) {
    return new Response(
      JSON.stringify({ error: "Origin not allowed" }),
      {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");

    if (!authHeader || authHeader.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization header" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    let parsedBody: unknown;

    try {
      parsedBody = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON payload" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const validation = comparisonSchema.safeParse(parsedBody);

    if (!validation.success) {
      return new Response(
        JSON.stringify({
          error: "Invalid request payload",
          details: validation.error.flatten().fieldErrors,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const { comparison_id } = validation.data;
    console.log("Comparing offers for:", comparison_id);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    const {
      data: { user },
      error: userError,
    } = accessToken
      ? await supabase.auth.getUser(accessToken)
      : { data: { user: null }, error: null } as const;

    if (userError || !user) {
      console.warn("compare-offers: user authentication failed", {
        hasError: !!userError,
      });
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Get comparison details
    const { data: comparison, error: compError } = await supabase
      .from('comparisons')
      .select('*')
      .eq('id', comparison_id)
      .single();

    if (compError || !comparison) {
      throw new Error('Comparison not found');
    }

    if (comparison.user_id !== user.id) {
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Get all documents for this comparison
    const { data: documents, error: docsError } = await supabase
      .from('documents')
      .select('*')
      .in('id', comparison.document_ids);

    if (docsError || !documents || documents.length === 0) {
      throw new Error('Documents not found');
    }

    const unauthorizedDocument = documents.find((doc) => doc.user_id !== user.id);

    if (unauthorizedDocument) {
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Check if all documents have extracted data
    const documentsWithData = documents.filter(d => d.extracted_data && d.status === 'completed');
    if (documentsWithData.length !== documents.length) {
      throw new Error('Not all documents have been processed yet');
    }

    const productTypeCounts = new Map<string, number>();
    for (const doc of documentsWithData) {
      const rawType = doc.extracted_data?.product_type;
      if (typeof rawType === 'string') {
        const normalized = rawType.trim();
        if (normalized.length > 0) {
          productTypeCounts.set(normalized, (productTypeCounts.get(normalized) ?? 0) + 1);
        }
      }
    }

    const aggregatedProductType = Array.from(productTypeCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([type]) => type)[0] ?? null;

    // Prepare data for AI comparison
    const offersData = documentsWithData.map((doc, idx) => ({
      offer_id: idx + 1,
      insurer: doc.extracted_data.insurer,
      data: doc.extracted_data,
      diagnostics: doc.extracted_data?.diagnostics || null
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
      console.error('Failed to parse AI comparison as JSON');
      comparisonData = { raw_text: comparisonText, parse_error: true };
    }

    // Update comparison with results
    const { error: updateError } = await supabase
      .from('comparisons')
      .update({
        comparison_data: comparisonData,
        status: 'completed',
        product_type: aggregatedProductType
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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in compare-offers:', { message: errorMessage });

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

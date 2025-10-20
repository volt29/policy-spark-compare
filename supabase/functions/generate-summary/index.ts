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

type SummaryKeyNumber = {
  label: string;
  value: string;
};

type SummaryRecommendedOffer = {
  name?: string | null;
  insurer?: string | null;
  summary?: string | null;
  key_numbers?: SummaryKeyNumber[] | null;
};

type SummaryData = {
  recommended_offer?: SummaryRecommendedOffer | null;
  reasons?: string[] | null;
  risks?: string[] | null;
  next_steps?: string[] | null;
  fallback_text?: string | null;
  raw_text?: string | null;
  parse_error?: boolean | null;
};

const parseStringArray = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const entries = value
    .map((item) => (typeof item === "string" ? item.trim() : null))
    .filter((item): item is string => !!item && item.length > 0);

  return entries.length > 0 ? entries : null;
};

const parseKeyNumbers = (value: unknown): SummaryKeyNumber[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const metrics = value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const record = item as Record<string, unknown>;
      const label = typeof record.label === "string" ? record.label.trim() : null;
      const metricValue = typeof record.value === "string" ? record.value.trim() : null;

      if (!label || !metricValue) {
        return null;
      }

      return { label, value: metricValue } satisfies SummaryKeyNumber;
    })
    .filter((item): item is SummaryKeyNumber => item !== null);

  return metrics.length > 0 ? metrics : null;
};

const parseRecommendedOffer = (value: unknown): SummaryRecommendedOffer | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : null;
  const insurer = typeof record.insurer === "string" ? record.insurer.trim() : null;
  const summary = typeof record.summary === "string" ? record.summary.trim() : null;
  const keyNumbers = parseKeyNumbers(record.key_numbers ?? record.key_metrics);

  if (!name && !insurer && !summary && !keyNumbers) {
    return null;
  }

  const recommended: SummaryRecommendedOffer = {};
  if (name) recommended.name = name;
  if (insurer) recommended.insurer = insurer;
  if (summary) recommended.summary = summary;
  if (keyNumbers) recommended.key_numbers = keyNumbers;

  return recommended;
};

const sanitizeSummary = (value: unknown, rawText: string): SummaryData | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const summary: SummaryData = {
    raw_text: rawText,
    parse_error: false,
  };

  const recommendedOffer = parseRecommendedOffer(record.recommended_offer);
  if (recommendedOffer) {
    summary.recommended_offer = recommendedOffer;
  }

  const reasons = parseStringArray(record.reasons);
  if (reasons) {
    summary.reasons = reasons;
  }

  const risks = parseStringArray(record.risks);
  if (risks) {
    summary.risks = risks;
  }

  const nextSteps = parseStringArray(record.next_steps);
  if (nextSteps) {
    summary.next_steps = nextSteps;
  }

  if (
    typeof record.fallback_text === "string" &&
    record.fallback_text.trim().length > 0
  ) {
    summary.fallback_text = record.fallback_text.trim();
  }

  if (!summary.fallback_text && typeof record.summary_text === "string") {
    const text = record.summary_text.trim();
    if (text.length > 0) {
      summary.fallback_text = text;
    }
  }

  if (!summary.fallback_text && rawText.length > 0) {
    summary.fallback_text = rawText;
  }

  return summary;
};

const parseSummaryResponse = (content: string): { data: SummaryData; rawText: string } => {
  const rawText = content.trim();
  const jsonMatch =
    rawText.match(/```json\n?([\s\S]*?)\n?```/) ||
    rawText.match(/```\n?([\s\S]*?)\n?```/);
  const jsonText = jsonMatch ? jsonMatch[1] : rawText;

  if (jsonText.trim().length === 0) {
    return {
      data: { raw_text: rawText || null, fallback_text: rawText || null, parse_error: true },
      rawText,
    };
  }

  try {
    const parsed = JSON.parse(jsonText.trim());
    const sanitized = sanitizeSummary(parsed, rawText);
    if (sanitized) {
      return { data: sanitized, rawText };
    }
  } catch (parseError) {
    console.error("Failed to parse AI summary JSON");
  }

  return {
    data: { raw_text: rawText || null, fallback_text: rawText || null, parse_error: true },
    rawText,
  };
};

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
    console.log("Generating summary for:", comparison_id);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
    const {
      data: { user },
      error: userError,
    } = accessToken
      ? await supabase.auth.getUser(accessToken)
      : { data: { user: null }, error: null } as const;

    if (userError || !user) {
      console.warn("generate-summary: user authentication failed", {
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

    // Get comparison with its data
    const { data: comparison, error: compError } = await supabase
      .from("comparisons")
      .select("*")
      .eq("id", comparison_id)
      .single();

    if (compError || !comparison || !comparison.comparison_data) {
      throw new Error("Comparison or comparison data not found");
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

    // Call Lovable AI to generate summary
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `Jesteś doradcą ubezpieczeniowym, który przygotowuje rekomendacje dla klientów.
            Na podstawie porównania ofert zwróć TYLKO poprawny JSON w następującym formacie:
            {
              "recommended_offer": {
                "name": "nazwa oferty lub ubezpieczyciela",
                "insurer": "nazwa towarzystwa (opcjonalnie)",
                "summary": "krótkie uzasadnienie wyboru",
                "key_numbers": [
                  { "label": "np. Składka roczna", "value": "1230 zł" }
                ]
              },
              "reasons": ["najważniejsze powody wyboru, preferowane liczby"],
              "risks": ["kluczowe ryzyka lub ograniczenia"],
              "next_steps": ["konkretne działania dla klienta"],
              "fallback_text": "zwięzłe tekstowe podsumowanie (max 150 słów)"
            }

            - Użyj języka prostego i przyjaznego.
            - Jeśli czegoś nie wiesz, pomiń pole lub użyj wartości null.
            - Nie dodawaj żadnego dodatkowego tekstu ani formatowania.`,
          },
          {
            role: "user",
            content: `Napisz podsumowanie na podstawie tego porównania:\n\n${JSON.stringify(
              comparison.comparison_data,
              null,
              2,
            )}`,
          },
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      throw new Error(`AI API error: ${aiResponse.status} - ${errorText}`);
    }

    const aiData = await aiResponse.json();
    const aiContent = aiData.choices?.[0]?.message?.content ?? "";
    const parsedSummary = parseSummaryResponse(aiContent);
    const summaryPayload = JSON.stringify(parsedSummary.data);

    // Update comparison with summary
    const { error: updateError } = await supabase
      .from("comparisons")
      .update({ summary_text: summaryPayload })
      .eq("id", comparison_id);

    if (updateError) {
      throw new Error(`Failed to update summary: ${updateError.message}`);
    }

    console.log("Summary generated successfully:", comparison_id);

    return new Response(
      JSON.stringify({ success: true, summary: parsedSummary.data }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in generate-summary:", { message: errorMessage });

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

import { assertEquals, assertExists } from "https://deno.land/std@0.168.0/testing/asserts.ts";

/**
 * Integration test for extract-insurance-data edge function
 * 
 * This test verifies the complete extraction pipeline:
 * 1. MinerU OCR extraction
 * 2. Segmentation and classification
 * 3. AI-powered structured data extraction
 * 4. Unified offer structure building
 * 5. Data validation and quality checks
 * 
 * To run: deno test --allow-net --allow-env supabase/functions/extract-insurance-data/integration.test.ts
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "http://localhost:54321";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const TEST_DOCUMENT_ID = Deno.env.get("TEST_DOCUMENT_ID"); // User must provide a real test document ID

Deno.test({
  name: "Extract insurance data - should return valid unified structure",
  ignore: !TEST_DOCUMENT_ID, // Skip if no test document provided
  async fn() {
    if (!SUPABASE_ANON_KEY) {
      throw new Error("SUPABASE_ANON_KEY not set");
    }

    if (!TEST_DOCUMENT_ID) {
      throw new Error("TEST_DOCUMENT_ID not set - please provide a document ID for testing");
    }

    console.log("Testing extraction for document:", TEST_DOCUMENT_ID);

    const response = await fetch(`${SUPABASE_URL}/functions/v1/extract-insurance-data`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ document_id: TEST_DOCUMENT_ID })
    });

    const result = await response.json();

    console.log("Response status:", response.status);
    console.log("Response data:", JSON.stringify(result, null, 2));

    // Basic response validation
    assertEquals(response.ok, true, "Response should be successful");
    assertEquals(result.success, true, "Success flag should be true");
    assertExists(result.unified, "Unified structure should exist");

    const unified = result.unified;

    // Structure validation
    assertExists(unified.offer_id, "offer_id should exist");
    assertEquals(typeof unified.offer_id, "string", "offer_id should be a string");

    assertExists(unified.extraction_confidence, "extraction_confidence should exist");
    assertEquals(
      ["high", "medium", "low"].includes(unified.extraction_confidence),
      true,
      "extraction_confidence should be high/medium/low"
    );

    // Insured validation
    assertExists(unified.insured, "insured array should exist");
    assertEquals(Array.isArray(unified.insured), true, "insured should be an array");
    
    if (unified.insured.length > 0) {
      const firstInsured = unified.insured[0];
      assertExists(firstInsured.name, "insured.name should exist");
      assertExists(firstInsured.age, "insured.age should exist");
      
      if (firstInsured.age !== 'missing') {
        assertEquals(
          typeof firstInsured.age,
          "number",
          "insured.age should be a number when present"
        );
      }
    }

    // Premium validation
    if (unified.total_premium_after_discounts !== 'missing') {
      assertEquals(
        typeof unified.total_premium_after_discounts,
        "number",
        "total_premium_after_discounts should be a number when present"
      );
    }

    // Data quality checks
    if (result.data) {
      assertExists(result.data.data_quality_score, "data_quality_score should exist");
      assertEquals(
        typeof result.data.data_quality_score,
        "number",
        "data_quality_score should be a number"
      );

      const qualityScore = result.data.data_quality_score;
      console.log("Data quality score:", qualityScore);

      if (qualityScore < 0.5) {
        console.warn("⚠️ Low quality score detected:", {
          score: qualityScore,
          missing_fields: unified.missing_fields,
          confidence: unified.extraction_confidence
        });
      }
    }

    // Diagnostic checks
    if (result.data?.diagnostics) {
      const diag = result.data.diagnostics;
      
      assertExists(diag.sections, "diagnostics.sections should exist");
      assertEquals(Array.isArray(diag.sections), true, "sections should be an array");
      
      console.log("Sections found:", diag.sections.length);
      console.log("Section types:", diag.sections.reduce((acc: any, s: any) => {
        acc[s.type] = (acc[s.type] || 0) + 1;
        return acc;
      }, {}));

      if (diag.sections.length === 0) {
        console.warn("⚠️ No sections identified - segmentation may have failed");
      }
    }

    console.log("✅ All validations passed");
  }
});

Deno.test({
  name: "Extract insurance data - should handle missing document gracefully",
  async fn() {
    if (!SUPABASE_ANON_KEY) {
      throw new Error("SUPABASE_ANON_KEY not set");
    }

    const response = await fetch(`${SUPABASE_URL}/functions/v1/extract-insurance-data`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ document_id: "00000000-0000-0000-0000-000000000000" })
    });

    assertEquals(response.ok, false, "Should return error for missing document");
    
    const result = await response.json();
    assertExists(result.error, "Error message should be present");
  }
});

Deno.test({
  name: "Extract insurance data - should validate request schema",
  async fn() {
    if (!SUPABASE_ANON_KEY) {
      throw new Error("SUPABASE_ANON_KEY not set");
    }

    const response = await fetch(`${SUPABASE_URL}/functions/v1/extract-insurance-data`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({}) // Missing document_id
    });

    assertEquals(response.ok, false, "Should return error for invalid request");
    
    const result = await response.json();
    assertExists(result.error, "Error message should be present");
  }
});

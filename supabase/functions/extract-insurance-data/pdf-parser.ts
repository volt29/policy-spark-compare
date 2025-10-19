// PDF Parser Module - extracts text from PDF bytes
// Uses pdf-parse library for Deno

export interface ParsedPage {
  pageNumber: number;
  text: string;
  metadata?: Record<string, any>;
}

export interface PdfParseResult {
  pages: ParsedPage[];
  totalPages: number;
  success: boolean;
  /**
   * Full text representation with normalized newlines. Useful for downstream
   * heuristics and keyword lookups.
   */
  fullText?: string;
  /**
   * Individual lines extracted from the PDF text (after normalization).
   */
  lines?: string[];
  /**
   * Mapping of each line (matching {@link lines}) to a 1-indexed page number.
   * Enables downstream consumers to determine page ranges for snippets.
   */
  linePageMap?: number[];
  error?: string;
}

/**
 * Parse PDF bytes and extract text per page
 * Falls back to empty result if parsing fails
 */
export async function parsePdfText(
  pdfBytes: Uint8Array
): Promise<PdfParseResult> {
  try {
    console.log('📖 PDF Parser: Starting text extraction...');
    
    // Import pdf-parse from npm via esm.sh
    const pdfParse = (await import('https://esm.sh/pdf-parse@1.1.1')).default;
    
    // Parse PDF
    const data = await pdfParse(pdfBytes);
    
    console.log(`📖 PDF Parser: Extracted ${data.numpages} pages`);
    
    // Split text by page markers (heuristic approach)
    // PDF-parse doesn't provide per-page text directly, so we need to estimate
    const fullText = (data.text || '').replace(/\r\n/g, '\n');
    const lines = fullText.length > 0 ? fullText.split('\n') : [];

    // Estimate pages based on content length and page count
    const estimatedLinesPerPage = Math.ceil(lines.length / data.numpages);
    const pages: ParsedPage[] = [];
    const linePageMap: number[] = new Array(lines.length).fill(0);

    for (let i = 0; i < data.numpages; i++) {
      const startLine = i * estimatedLinesPerPage;
      const endLine = Math.min((i + 1) * estimatedLinesPerPage, lines.length);
      const pageText = lines.slice(startLine, endLine).join('\n');

      pages.push({
        pageNumber: i + 1,
        text: pageText,
        metadata: {
          estimatedLines: endLine - startLine,
          startLine,
          endLine
        }
      });

      for (let lineIndex = startLine; lineIndex < endLine; lineIndex++) {
        linePageMap[lineIndex] = i + 1;
      }
    }

    console.log('✅ PDF Parser: Text extraction successful');

    return {
      pages,
      totalPages: data.numpages,
      success: true,
      fullText,
      lines,
      linePageMap
    };
    
  } catch (error) {
    console.error('❌ PDF Parser: Failed to extract text', error);
    return {
      pages: [],
      totalPages: 0,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Extract text from all pages and return as single string
 */
export function combinePagesText(pages: ParsedPage[]): string {
  return pages.map(p => p.text).join('\n\n');
}

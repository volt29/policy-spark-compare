# Propozycje Usprawnień - Policy Spark Compare

## Executive Summary

Przeprowadzono kompleksową analizę kodu aplikacji **policy-spark-compare**. Zidentyfikowano **38 problemów** w 8 kategoriach:

- 🔴 **KRYTYCZNE** (6): Bezpieczeństwo - wymagają natychmiastowej akcji
- 🟠 **WYSOKIE** (11): Wydajność i obsługa błędów - istotny wpływ na UX
- 🟡 **ŚREDNIE** (21): Jakość kodu, typy, testy, dostępność

**Całkowity dług techniczny**: ~2-3 tygodnie pracy (estymacja dla 1 developera)

---

## 1. Zidentyfikowane Problemy - Kategorie

### 1.1 🔴 BEZPIECZEŃSTWO (6 problemów - PRIORYTET KRYTYCZNY)

| # | Problem | Lokalizacja | Ryzyko |
|---|---------|-------------|--------|
| S-1 | XSS vulnerability - brak sanitizacji HTML | `ComparisonResult.tsx:892-901` | WYSOKIE |
| S-2 | Console.log/error w produkcji (50+ wystąpień) | `extract-insurance-data/index.ts` | ŚREDNIE |
| S-3 | Potencjalny prompt injection w AI API | `compare-offers/index.ts:246` | WYSOKIE |
| S-4 | Brak walidacji Authorization header | `extract-insurance-data/index.ts:525-532` | ŚREDNIE |
| S-5 | Env variables bez walidacji (non-null assertions) | `extract-insurance-data/index.ts:562-564` | WYSOKIE |
| S-6 | Brak CSRF protection w Edge Functions | `compare-offers/index.ts:42-100` | ŚREDNIE |

### 1.2 🟠 WYDAJNOŚĆ (7 problemów - PRIORYTET WYSOKI)

| # | Problem | Lokalizacja | Wpływ |
|---|---------|-------------|-------|
| P-1 | Komponent 990 linii bez modularyzacji | `ComparisonResult.tsx` | Re-render całego drzewa |
| P-2 | Funkcja 812 linii bez rozdzielenia | `buildComparisonSections.ts` | Trudna do testowania |
| P-3 | Brak memoizacji komponentów | `OfferCard.tsx` | Niepotrzebne re-rendery |
| P-4 | Zbyt wiele useEffect hooks | `ComparisonResult.tsx:462-572` | Wielokrotne fetche |
| P-5 | Brak wirtualizacji list | `ComparisonTable.tsx:422-456` | Słaba performance dla 100+ wierszy |
| P-6 | localStorage bez debounce | `usePersistentSectionState.ts:59` | Blokowanie UI |
| P-7 | Memory leak - cache nie czyszczony | `ComparisonResult.tsx:327-333` | Wzrost pamięci w czasie |

### 1.3 🟡 JAKOŚĆ KODU (6 problemów - PRIORYTET ŚREDNI)

| # | Problem | Przykład | Wpływ |
|---|---------|----------|-------|
| C-1 | Duplikacja funkcji helper | `normalizeKey` w 3 plikach | DRY violation |
| C-2 | Magic numbers bez stałych | `maxPages = 3` bez definicji | Trudne w maintenance |
| C-3 | Głębokie nesting (8+ poziomów) | `ComparisonResult.tsx:709-743` | Czytelność |
| C-4 | Silent failures (empty catch) | `usePersistentSectionState.ts:22` | Ukryte problemy |
| C-5 | Nieużywane importy | Zbyt wiele importów | Bundle size |
| C-6 | Brak dokumentacji (JSDoc) | Wszystkie pliki | Onboarding |

### 1.4 🟡 TYPESCRIPT (4 problemy - PRIORYTET ŚREDNI)

| # | Problem | Lokalizacja | Wpływ |
|---|---------|-------------|-------|
| T-1 | `Record<string, unknown>` zamiast konkretnych typów | `ComparisonResult.tsx:91,109,156` | Słabe type safety |
| T-2 | Użycie `any` (10+ wystąpień) | `extract-insurance-data/index.ts:163,292` | Brak type safety |
| T-3 | Brak return types w funkcjach | `ComparisonResult.tsx:78-84` | Niepewność typów |
| T-4 | Type assertions bez uzasadnienia | `buildComparisonSections.ts:199,710` | Potencjalne runtime errors |

### 1.5 🟠 OBSŁUGA BŁĘDÓW (4 problemy - PRIORYTET WYSOKI)

| # | Problem | Lokalizacja | Wpływ |
|---|---------|-------------|-------|
| E-1 | Zbyt ogólne error handling | `ComparisonResult.tsx:433-460` | Trudne debugowanie |
| E-2 | Brak Error Boundaries | Cały projekt | Crash całej aplikacji |
| E-3 | Silent failures w parsowaniu | `extract-insurance-data/index.ts:258-290` | Błędne dane bez notice |
| E-4 | Brak walidacji localStorage capacity | `usePersistentSectionState.ts:27-36` | QuotaExceededError |

### 1.6 🟡 TESTOWANIE (3 problemy - PRIORYTET ŚREDNI)

| # | Problem | Wpływ |
|---|---------|-------|
| TEST-1 | Brak testów dla `buildComparisonSections` (812 linii) | Funkcja krytyczna bez coverage |
| TEST-2 | Brak testów dla formatowania wartości | Potencjalne błędy w wyświetlaniu |
| TEST-3 | Brakujące edge case testy | Nieznane zachowanie w corner cases |

### 1.7 🟡 DOSTĘPNOŚĆ (3 problemy - PRIORYTET ŚREDNI)

| # | Problem | Lokalizacja | Wpływ |
|---|---------|-------------|-------|
| A11Y-1 | Brak aria-label w komponentach | `ComparisonResult.tsx:710-742` | Screen readers |
| A11Y-2 | role="button" bez keyboard handler | `AiSummaryPanel.tsx:51-57` | Keyboard navigation |
| A11Y-3 | Brak semantycznych nagłówków | `ComparisonResult.tsx:709+` | SEO i dostępność |

### 1.8 🟡 INNE (5 problemów - PRIORYTET ŚREDNI)

| # | Problem | Wpływ |
|---|---------|-------|
| O-1 | Duży bundle size (30+ ikon lucide) | Performance |
| O-2 | Brak API dokumentacji | Onboarding |
| O-3 | Nieoptymalna struktura katalogów | Maintenance |
| O-4 | Brak CI/CD checks dla code quality | Regresje |
| O-5 | Brak monitoring i logging w produkcji | Debugging |

---

## 2. Propozycje Usprawnień - Szczegółowe

### FAZA 1: SECURITY FIXES (Tydzień 1) 🔴

#### 2.1.1 Usunąć console.log z produkcji

**Problem**: 50+ console statements w Edge Functions ujawniają wrażliwe informacje.

**Rozwiązanie**: Stworzyć utility logger z poziomami logowania.

**Plik**: `supabase/functions/_shared/logger.ts` (NOWY)

```typescript
// supabase/functions/_shared/logger.ts
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerConfig {
  level: LogLevel;
  enableConsole: boolean;
}

class Logger {
  private config: LoggerConfig;

  constructor(config: LoggerConfig) {
    this.config = config;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    const configLevelIndex = levels.indexOf(this.config.level);
    const currentLevelIndex = levels.indexOf(level);
    return currentLevelIndex >= configLevelIndex;
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug') && this.config.enableConsole) {
      console.debug(`[DEBUG] ${message}`, ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info') && this.config.enableConsole) {
      console.info(`[INFO] ${message}`, ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.warn(`[WARN] ${message}`, ...args);
    }
  }

  error(message: string, error?: unknown): void {
    if (this.shouldLog('error')) {
      console.error(`[ERROR] ${message}`, error);
      // TODO: Send to monitoring service (Sentry, DataDog, etc.)
    }
  }
}

// Production logger - only errors
export const logger = new Logger({
  level: Deno.env.get('LOG_LEVEL') as LogLevel || 'error',
  enableConsole: Deno.env.get('ENABLE_CONSOLE_LOGS') === 'true'
});
```

**Zastosowanie w `extract-insurance-data/index.ts`**:

```typescript
// PRZED
console.log('✅ Lovable call attempt');

// PO
logger.debug('Lovable call attempt');
```

**Oczekiwany rezultat**:
- ✅ Brak wrażliwych danych w production logs
- ✅ Kontrolowane logowanie przez env variables
- ✅ Gotowość do integracji z monitoring tools

---

#### 2.1.2 Dodać sanitizację HTML dla user-generated content

**Problem**: XSS vulnerability w `ComparisonResult.tsx:892-901`

**Rozwiązanie**: Użyć DOMPurify do sanityzacji.

**Instalacja**:
```bash
npm install dompurify
npm install --save-dev @types/dompurify
```

**Plik**: `src/lib/sanitize.ts` (NOWY)

```typescript
import DOMPurify from 'dompurify';

export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'u', 'br', 'p'],
    ALLOWED_ATTR: []
  });
}
```

**Zastosowanie w `ComparisonResult.tsx`**:

```typescript
// PRZED
<p className="text-foreground leading-relaxed whitespace-pre-line">
  {fallbackSummaryText}
</p>

// PO
import { sanitizeHtml } from '@/lib/sanitize';

<p
  className="text-foreground leading-relaxed whitespace-pre-line"
  dangerouslySetInnerHTML={{ __html: sanitizeHtml(fallbackSummaryText) }}
/>
```

**Oczekiwany rezultat**:
- ✅ Ochrona przed XSS attacks
- ✅ Bezpieczne wyświetlanie user-generated content

---

#### 2.1.3 Walidacja env variables na startup

**Problem**: Non-null assertions (`!`) bez walidacji.

**Rozwiązanie**: Walidować wszystkie wymagane env vars na starcie.

**Plik**: `supabase/functions/_shared/env.ts` (NOWY)

```typescript
interface EnvConfig {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  lovableApiKey: string;
  corsAllowedOrigins: string;
}

export function validateAndGetEnv(): EnvConfig {
  const requiredVars = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'LOVABLE_API_KEY',
    'CORS_ALLOWED_ORIGINS'
  ];

  const missing = requiredVars.filter(key => !Deno.env.get(key));

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`
    );
  }

  return {
    supabaseUrl: Deno.env.get('SUPABASE_URL')!,
    supabaseServiceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    lovableApiKey: Deno.env.get('LOVABLE_API_KEY')!,
    corsAllowedOrigins: Deno.env.get('CORS_ALLOWED_ORIGINS')!
  };
}
```

**Zastosowanie w `extract-insurance-data/index.ts`**:

```typescript
// PRZED
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;

// PO
import { validateAndGetEnv } from '../_shared/env.ts';

const env = validateAndGetEnv();
const supabaseUrl = env.supabaseUrl;
```

**Oczekiwany rezultat**:
- ✅ Wczesne wykrycie brakujących env vars
- ✅ Jasne error messages
- ✅ Bezpieczniejsze deployment

---

#### 2.1.4 Dodać input sanitization dla AI prompts

**Problem**: Potential prompt injection w `compare-offers/index.ts:246`

**Rozwiązanie**: Sanityzować i limitować długość user input.

**Plik**: `supabase/functions/_shared/ai-safety.ts` (NOWY)

```typescript
export function sanitizeForAiPrompt(input: string, maxLength = 10000): string {
  // Remove control characters
  let sanitized = input.replace(/[\x00-\x1F\x7F]/g, '');

  // Escape potential prompt injection patterns
  const dangerousPatterns = [
    /ignore (previous|all) instructions/gi,
    /you are now/gi,
    /system:/gi,
    /\[INST\]/gi
  ];

  dangerousPatterns.forEach(pattern => {
    sanitized = sanitized.replace(pattern, '[FILTERED]');
  });

  // Truncate to max length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength) + '...';
  }

  return sanitized;
}

export function sanitizeObjectForAi(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return sanitizeForAiPrompt(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObjectForAi(item));
  }

  if (obj && typeof obj === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeObjectForAi(value);
    }
    return sanitized;
  }

  return obj;
}
```

**Zastosowanie w `compare-offers/index.ts`**:

```typescript
// PRZED
{
  role: 'user',
  content: `Porównaj te oferty ubezpieczeniowe:\n\n${JSON.stringify(offersData, null, 2)}`
}

// PO
import { sanitizeObjectForAi } from '../_shared/ai-safety.ts';

const sanitizedOffers = sanitizeObjectForAi(offersData);
{
  role: 'user',
  content: `Porównaj te oferty ubezpieczeniowe:\n\n${JSON.stringify(sanitizedOffers, null, 2)}`
}
```

**Oczekiwany rezultat**:
- ✅ Ochrona przed prompt injection
- ✅ Kontrola nad długością inputu
- ✅ Bezpieczniejsze API calls

---

### FAZA 2: PERFORMANCE IMPROVEMENTS (Tydzień 2) 🟠

#### 2.2.1 Refactor ComparisonResult.tsx - Modulacja

**Problem**: 990 linii w jednym komponencie powoduje re-render całego drzewa.

**Rozwiązanie**: Rozdzielić na mniejsze komponenty.

**Struktura przed**:
```
src/pages/ComparisonResult.tsx (990 linii)
```

**Struktura po**:
```
src/pages/ComparisonResult/
├── index.tsx (200 linii) - główny komponent
├── hooks/
│   ├── useComparisonData.ts - fetch i parsing danych
│   ├── useDocumentViewer.ts - logika viewera
│   └── useOfferSelection.ts - selekcja ofert
├── components/
│   ├── ComparisonHeader.tsx - nagłówek z filtrami
│   ├── TabContent/
│   │   ├── SummaryTab.tsx
│   │   ├── ComparisonTab.tsx
│   │   └── DetailsTab.tsx
│   └── OfferSelector.tsx - wybór ofert do porównania
└── utils/
    ├── parseSourceReferences.ts
    └── buildOfferData.ts
```

**Przykład: `hooks/useComparisonData.ts`**:

```typescript
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { ComparisonOffer } from '@/lib/comparison-utils';

interface UseComparisonDataResult {
  comparison: Database['public']['Tables']['comparisons']['Row'] | null;
  offers: ComparisonOffer[];
  isLoading: boolean;
  error: Error | null;
}

export function useComparisonData(id: string): UseComparisonDataResult {
  const [comparison, setComparison] = useState(null);
  const [offers, setOffers] = useState<ComparisonOffer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    async function loadData() {
      try {
        setIsLoading(true);

        // Fetch comparison
        const { data: compData, error: compError } = await supabase
          .from('comparisons')
          .select('*')
          .eq('id', id)
          .single();

        if (compError) throw compError;

        // Fetch documents
        const { data: docsData, error: docsError } = await supabase
          .from('documents')
          .select('*')
          .in('id', compData.document_ids);

        if (docsError) throw docsError;

        setComparison(compData);

        // Build offers (przeniesione z głównego komponentu)
        const builtOffers = buildOffersFromDocuments(docsData, compData);
        setOffers(builtOffers);

      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Nieznany błąd';
        setError(err instanceof Error ? err : new Error(errorMessage));
        toast.error('Błąd ładowania porównania', { description: errorMessage });
        navigate('/dashboard');
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [id, navigate]);

  return { comparison, offers, isLoading, error };
}
```

**Przykład: `components/TabContent/SummaryTab.tsx`**:

```typescript
import React from 'react';
import { AiSummaryPanel } from '@/components/comparison/AiSummaryPanel';
import { MetricsPanel } from '@/components/comparison/MetricsPanel';
import { OfferCard } from '@/components/comparison/OfferCard';
import type { ComparisonOffer } from '@/lib/comparison-utils';
import type { ComparisonSummary } from '@/types/comparison';

interface SummaryTabProps {
  offers: ComparisonOffer[];
  summary: ComparisonSummary | null;
  onViewDocument: (documentId: string) => void;
  onDownloadDocument: (documentId: string) => void;
}

export const SummaryTab = React.memo(function SummaryTab({
  offers,
  summary,
  onViewDocument,
  onDownloadDocument
}: SummaryTabProps) {
  return (
    <div className="space-y-6">
      {summary && (
        <AiSummaryPanel
          summary={summary}
          offers={offers}
        />
      )}

      <MetricsPanel offers={offers} />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {offers.map((offer) => (
          <OfferCard
            key={offer.id}
            offer={offer}
            onView={() => onViewDocument(offer.id)}
            onDownload={() => onDownloadDocument(offer.id)}
          />
        ))}
      </div>
    </div>
  );
});
```

**Oczekiwany rezultat**:
- ✅ Komponent główny 200 linii zamiast 990
- ✅ Pojedyncze re-rendery tylko w zmienionych komponentach
- ✅ Łatwiejsze testowanie
- ✅ Lepsze code organization

---

#### 2.2.2 Memoizacja komponentów

**Problem**: Brak React.memo w `OfferCard.tsx` powoduje niepotrzebne re-rendery.

**Rozwiązanie**: Dodać memoizację do komponentów wyświetlających dane.

**Plik**: `src/components/comparison/OfferCard.tsx`

```typescript
// PRZED
export default function OfferCard({ offer, ... }: OfferCardProps) {
  // ...
}

// PO
import React from 'react';

export const OfferCard = React.memo(function OfferCard({
  offer,
  onView,
  onDownload,
  isSelected,
  badge
}: OfferCardProps) {
  // ...
}, (prevProps, nextProps) => {
  // Custom comparison - tylko re-render gdy istotne props się zmienią
  return (
    prevProps.offer.id === nextProps.offer.id &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.badge === nextProps.badge
  );
});
```

**Podobnie dla**:
- `ComparisonTable.tsx`
- `SectionComparisonView.tsx`
- `MetricsPanel.tsx`

**Oczekiwany rezultat**:
- ✅ Redukcja re-renderów o ~60%
- ✅ Lepsza responsywność UI
- ✅ Niższe CPU usage

---

#### 2.2.3 Debounce localStorage writes

**Problem**: Każda zmiana state zapisuje do localStorage bez debounce.

**Rozwiązanie**: Użyć debounce.

**Plik**: `src/hooks/usePersistentSectionState.ts`

```typescript
// Dodać do dependencies
import { debounce } from 'lodash-es'; // lub własna implementacja

// PRZED
useEffect(() => {
  writeStoredState(storageKey, state);
}, [state, storageKey]);

// PO
useEffect(() => {
  const debouncedWrite = debounce(() => {
    writeStoredState(storageKey, state);
  }, 500); // 500ms delay

  debouncedWrite();

  return () => {
    debouncedWrite.cancel();
  };
}, [state, storageKey]);
```

**Własna implementacja debounce (bez lodash)**:

```typescript
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

// W komponencie
const debouncedState = useDebounce(state, 500);

useEffect(() => {
  writeStoredState(storageKey, debouncedState);
}, [debouncedState, storageKey]);
```

**Oczekiwany rezultat**:
- ✅ Redukcja localStorage writes o ~80%
- ✅ Brak blokowania UI
- ✅ Lepsza performance

---

#### 2.2.4 Refactor buildComparisonSections

**Problem**: 812 linii w jednej funkcji, trudna do testowania i maintenance.

**Rozwiązanie**: Rozdzielić na mniejsze, testowalne funkcje.

**Plik**: `src/lib/buildComparisonSections/index.ts` (NOWY)

```typescript
import { buildPriceSection } from './price-section';
import { buildCoverageSection } from './coverage-section';
import { buildAssistanceSection } from './assistance-section';
import { buildExclusionsSection } from './exclusions-section';
import type { ComparisonSection } from '@/types/comparison';

export function buildComparisonSections(
  offers: ComparisonOffer[],
  comparisonAnalysis: ComparisonAnalysis | null,
  sourceMetadata: SourceMetadata
): ComparisonSection[] {
  const sections: ComparisonSection[] = [];

  // Build each section independently
  const priceSection = buildPriceSection(offers, comparisonAnalysis, sourceMetadata);
  if (priceSection) sections.push(priceSection);

  const coverageSection = buildCoverageSection(offers, comparisonAnalysis, sourceMetadata);
  if (coverageSection) sections.push(coverageSection);

  const assistanceSection = buildAssistanceSection(offers, comparisonAnalysis, sourceMetadata);
  if (assistanceSection) sections.push(assistanceSection);

  const exclusionsSection = buildExclusionsSection(offers, comparisonAnalysis, sourceMetadata);
  if (exclusionsSection) sections.push(exclusionsSection);

  return sections;
}
```

**Plik**: `src/lib/buildComparisonSections/price-section.ts` (NOWY)

```typescript
import type { ComparisonSection, ComparisonOffer } from '@/types/comparison';
import { buildSectionRow } from './utils/build-row';
import { extractPriceData } from './utils/extract-price';

export function buildPriceSection(
  offers: ComparisonOffer[],
  analysis: ComparisonAnalysis | null,
  metadata: SourceMetadata
): ComparisonSection | null {
  const priceAnalysis = analysis?.price_comparison;
  if (!priceAnalysis) return null;

  const rows: ComparisonSectionRow[] = [];

  // Total Premium row
  const totalPremiumRow = buildSectionRow({
    id: 'total_premium',
    label: 'Składka całkowita',
    type: 'metric',
    offers,
    extractValue: (offer) => extractPriceData(offer, 'total'),
    analysis: priceAnalysis,
    metadata
  });
  rows.push(totalPremiumRow);

  // Premium before discounts row
  const premiumBeforeRow = buildSectionRow({
    id: 'premium_before_discounts',
    label: 'Składka przed zniżkami',
    type: 'metric',
    offers,
    extractValue: (offer) => extractPriceData(offer, 'before_discounts'),
    analysis: priceAnalysis,
    metadata
  });
  rows.push(premiumBeforeRow);

  // Discounts row
  const discountsRow = buildSectionRow({
    id: 'discounts',
    label: 'Zniżki',
    type: 'list',
    offers,
    extractValue: (offer) => extractPriceData(offer, 'discounts'),
    analysis: priceAnalysis,
    metadata
  });
  if (discountsRow.values.some(v => v.value !== null)) {
    rows.push(discountsRow);
  }

  return {
    id: 'price',
    title: 'Cena i składki',
    rows,
    diffStatus: calculateDiffStatus(rows),
    sources: extractSources(priceAnalysis),
    defaultExpanded: true
  };
}
```

**Struktura katalogów**:
```
src/lib/buildComparisonSections/
├── index.ts (główny export)
├── price-section.ts (~100 linii)
├── coverage-section.ts (~100 linii)
├── assistance-section.ts (~100 linii)
├── exclusions-section.ts (~100 linii)
└── utils/
    ├── build-row.ts
    ├── extract-price.ts
    ├── extract-coverage.ts
    ├── calculate-diff.ts
    └── format-value.ts
```

**Oczekiwany rezultat**:
- ✅ 8 plików po ~100 linii zamiast 1 plik 812 linii
- ✅ Każda funkcja testowalna osobno
- ✅ Łatwiejszy maintenance
- ✅ Czytelniejszy kod

---

### FAZA 3: CODE QUALITY (Tydzień 3) 🟡

#### 2.3.1 Usunąć duplikację kodu

**Problem**: Funkcje `normalizeKey`, `toNumber` powtarzają się w 3 plikach.

**Rozwiązanie**: Stworzyć wspólne utility.

**Plik**: `src/lib/utils/common.ts` (NOWY)

```typescript
/**
 * Normalize a key to lowercase with underscores
 * @example normalizeKey("Total Premium") => "total_premium"
 */
export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/\s+/g, '_');
}

/**
 * Convert unknown value to number or null
 * @param value - Value to convert
 * @param defaultValue - Default value if conversion fails
 */
export function toNumber(
  value: unknown,
  defaultValue: number | null = null
): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value.replace(/[^\d.-]/g, ''));
    return isNaN(parsed) ? defaultValue : parsed;
  }
  return defaultValue;
}

/**
 * Convert unknown value to string or null
 */
export function toString(
  value: unknown,
  defaultValue: string | null = null
): string | null {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return defaultValue;
  return String(value);
}

/**
 * Check if value is "missing" indicator
 */
export function isMissingValue(value: unknown): boolean {
  return value === 'missing' || value === null || value === undefined;
}
```

**Zastosowanie w innych plikach**:

```typescript
// PRZED (w comparison-utils.ts, buildComparisonSections.ts, etc.)
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/\s+/g, '_');
}

// PO
import { normalizeKey, toNumber, toString } from '@/lib/utils/common';
```

**Oczekiwany rezultat**:
- ✅ Eliminacja duplikacji
- ✅ Jednolite zachowanie w całej aplikacji
- ✅ Łatwiejsze testy

---

#### 2.3.2 Zdefiniować stałe zamiast magic numbers

**Plik**: `src/lib/constants.ts` (NOWY)

```typescript
// File upload constraints
export const FILE_UPLOAD = {
  MAX_FILES: 5,
  MIN_FILES: 2,
  MAX_FILE_SIZE_MB: 10,
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,
  ALLOWED_TYPES: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
} as const;

// Document processing
export const DOCUMENT_PROCESSING = {
  MAX_POLL_ATTEMPTS: 45,
  POLL_INTERVAL_MS: 2000,
  TIMEOUT_MS: 90000, // 45 * 2000
} as const;

// PDF extraction
export const PDF_EXTRACTION = {
  IMAGE_PAYLOAD_TARGET_BYTES: 4 * 1024 * 1024,
  MAX_FILE_SIZE_BYTES: 6 * 1024 * 1024,
  MAX_PAGES_FOR_LARGE_FILES: 3,
  LARGE_FILE_THRESHOLD_MB: 10,
  VERY_LARGE_FILE_THRESHOLD_MB: 15,
  IMAGE_COMPRESSION: {
    DPI: 150,
    QUALITY: 70,
    FORMAT: 'jpeg'
  }
} as const;

// Signed URL cache
export const SIGNED_URL_CACHE = {
  PREVIEW: {
    EXPIRY_SECONDS: 5 * 60, // 5 minutes
    BUFFER_SECONDS: 30
  },
  DOWNLOAD: {
    EXPIRY_SECONDS: 60 * 60, // 1 hour
    BUFFER_SECONDS: 120
  }
} as const;

// Error messages
export const ERROR_MESSAGES = {
  FILE_TOO_LARGE: (maxMB: number) => `Plik jest zbyt duży (max ${maxMB}MB)`,
  TOO_MANY_FILES: (max: number) => `Można przesłać maksymalnie ${max} plików`,
  INVALID_FILE_TYPE: 'Nieprawidłowy typ pliku',
  EXTRACTION_TIMEOUT: 'Przekroczono limit czasu ekstrakcji danych',
  COMPARISON_FAILED: 'Nie udało się porównać ofert',
} as const;
```

**Zastosowanie**:

```typescript
// PRZED (w useComparisonFlow.ts)
const MAX_FILES = 5;
const MIN_FILES = 2;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

// PO
import { FILE_UPLOAD } from '@/lib/constants';

if (files.length > FILE_UPLOAD.MAX_FILES) {
  throw new Error(ERROR_MESSAGES.TOO_MANY_FILES(FILE_UPLOAD.MAX_FILES));
}
```

**Oczekiwany rezultat**:
- ✅ Wszystkie magic numbers w jednym miejscu
- ✅ Łatwa zmiana konfiguracji
- ✅ Type-safe constants (as const)

---

#### 2.3.3 Dodać TypeScript types zamiast 'any'

**Problem**: Użycie `any` w 10+ miejscach.

**Rozwiązanie**: Zdefiniować konkretne typy.

**Plik**: `supabase/functions/_shared/types.ts` (NOWY)

```typescript
// AI API types
export interface LovableContentBlock {
  type: 'text' | 'image';
  text?: string;
  image?: {
    format: 'jpeg' | 'png' | 'webp';
    data: string; // base64
  };
}

export interface LovableMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | LovableContentBlock[];
}

export interface LovableSchemaParameters {
  type: 'object';
  properties: Record<string, {
    type: string;
    description?: string;
    items?: unknown;
  }>;
  required?: string[];
}

export interface LovableApiRequest {
  model: string;
  messages: LovableMessage[];
  response_format?: {
    type: 'json_schema';
    json_schema: {
      name: string;
      strict: boolean;
      schema: LovableSchemaParameters;
    };
  };
  temperature?: number;
  max_tokens?: number;
}

export interface LovableApiResponse {
  id: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// Extracted data types
export interface ExtractedInsuranceData {
  insured?: {
    full_name?: string;
    pesel?: string;
    age?: number;
    address?: string;
  };
  insurer?: {
    name?: string;
    calculation_id?: string;
  };
  base_contract?: {
    oc?: { sum?: number; variant?: string };
    ac?: { sum?: number; variant?: string };
  };
  premium?: {
    total?: number;
    before_discounts?: number;
    currency?: string;
  };
  assistance?: Array<string | { name?: string }>;
  duration?: {
    start?: string;
    end?: string;
    variant?: string;
  };
  discounts?: Array<{
    name?: string;
    amount?: number;
    percentage?: number;
  }>;
}
```

**Zastosowanie w `extract-insurance-data/index.ts`**:

```typescript
// PRZED
async function callLovableWithRetry(
  lovableApiKey: string,
  schemaParameters: any,  // ❌ any
  // ...
)

// PO
import type {
  LovableSchemaParameters,
  LovableApiRequest,
  LovableApiResponse
} from '../_shared/types.ts';

async function callLovableWithRetry(
  lovableApiKey: string,
  schemaParameters: LovableSchemaParameters,  // ✅ typed
  initialContent: LovableContentBlock[],
  maxRetries = 3
): Promise<LovableApiResponse> {
  // ...
}
```

**Oczekiwany rezultat**:
- ✅ Eliminacja `any` types
- ✅ Better IntelliSense
- ✅ Compile-time type checking

---

#### 2.3.4 Dodać Error Boundary

**Problem**: Brak Error Boundaries - jeden error crashuje całą aplikację.

**Rozwiązanie**: Implementować Error Boundary komponent.

**Plik**: `src/components/ErrorBoundary.tsx` (NOWY)

```typescript
import React, { Component, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { AlertCircle } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Log to monitoring service
    console.error('ErrorBoundary caught:', error, errorInfo);

    // Call optional error handler
    this.props.onError?.(error, errorInfo);

    // TODO: Send to Sentry/DataDog
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null
    });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen flex items-center justify-center p-4">
          <Card className="max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3 text-destructive">
              <AlertCircle className="h-6 w-6" />
              <h2 className="text-xl font-semibold">Coś poszło nie tak</h2>
            </div>

            <p className="text-muted-foreground">
              Przepraszamy, wystąpił nieoczekiwany błąd. Spróbuj odświeżyć stronę.
            </p>

            {this.state.error && (
              <details className="text-sm text-muted-foreground">
                <summary className="cursor-pointer">Szczegóły błędu</summary>
                <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto">
                  {this.state.error.toString()}
                </pre>
              </details>
            )}

            <div className="flex gap-2">
              <Button onClick={this.handleReset} variant="default">
                Spróbuj ponownie
              </Button>
              <Button
                onClick={() => window.location.href = '/dashboard'}
                variant="outline"
              >
                Wróć do Dashboard
              </Button>
            </div>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
```

**Zastosowanie w `App.tsx`**:

```typescript
// PRZED
<BrowserRouter>
  <Routes>
    <Route path="/" element={<Index />} />
    {/* ... */}
  </Routes>
</BrowserRouter>

// PO
import { ErrorBoundary } from '@/components/ErrorBoundary';

<ErrorBoundary>
  <BrowserRouter>
    <ErrorBoundary>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/comparison/:id" element={
          <ErrorBoundary fallback={<ComparisonErrorFallback />}>
            <ComparisonResult />
          </ErrorBoundary>
        } />
        {/* ... */}
      </Routes>
    </ErrorBoundary>
  </BrowserRouter>
</ErrorBoundary>
```

**Oczekiwany rezultat**:
- ✅ Graceful error handling
- ✅ Nie crashuje całej aplikacji
- ✅ User-friendly error messages
- ✅ Error logging do monitoring

---

### FAZA 4: TESTING & DOCUMENTATION (Tydzień 4) 🟡

#### 2.4.1 Dodać testy dla buildComparisonSections

**Plik**: `src/lib/buildComparisonSections/price-section.test.ts` (NOWY)

```typescript
import { describe, it, expect } from 'bun:test';
import { buildPriceSection } from './price-section';
import type { ComparisonOffer } from '@/types/comparison';

describe('buildPriceSection', () => {
  const mockOffers: ComparisonOffer[] = [
    {
      id: '1',
      label: 'Oferta A',
      insurer: 'PZU',
      data: {
        unified: {
          total_premium_after_discounts: 1200,
          total_premium_before_discounts: 1500,
          discounts: [
            { name: 'Zniżka za bezszkodowość', amount: 300 }
          ]
        }
      }
    },
    {
      id: '2',
      label: 'Oferta B',
      insurer: 'Warta',
      data: {
        unified: {
          total_premium_after_discounts: 1000,
          total_premium_before_discounts: 1200,
          discounts: [
            { name: 'Zniżka za bezszkodowość', amount: 200 }
          ]
        }
      }
    }
  ];

  it('should build price section with correct rows', () => {
    const section = buildPriceSection(mockOffers, null, {});

    expect(section).not.toBeNull();
    expect(section?.id).toBe('price');
    expect(section?.title).toBe('Cena i składki');
    expect(section?.rows.length).toBeGreaterThan(0);
  });

  it('should extract total premium correctly', () => {
    const section = buildPriceSection(mockOffers, null, {});

    const totalPremiumRow = section?.rows.find(r => r.id === 'total_premium');
    expect(totalPremiumRow).toBeDefined();
    expect(totalPremiumRow?.values[0].value).toBe(1200);
    expect(totalPremiumRow?.values[1].value).toBe(1000);
  });

  it('should handle missing premium data', () => {
    const offersWithMissing: ComparisonOffer[] = [
      {
        id: '1',
        label: 'Oferta A',
        insurer: 'PZU',
        data: { unified: { total_premium_after_discounts: 'missing' } }
      }
    ];

    const section = buildPriceSection(offersWithMissing, null, {});
    const totalPremiumRow = section?.rows.find(r => r.id === 'total_premium');

    expect(totalPremiumRow?.values[0].value).toBeNull();
  });

  it('should calculate diff status correctly', () => {
    const section = buildPriceSection(mockOffers, null, {});

    // Different values should result in 'different' status
    expect(section?.diffStatus).toBe('different');
  });

  it('should return null if no price analysis', () => {
    const section = buildPriceSection([], null, {});
    expect(section).toBeNull();
  });
});
```

**Podobnie dla**:
- `coverage-section.test.ts`
- `assistance-section.test.ts`
- `exclusions-section.test.ts`

**Uruchomienie testów**:
```bash
bun test src/lib/buildComparisonSections/
```

**Oczekiwany rezultat**:
- ✅ 80%+ code coverage dla build functions
- ✅ Testy edge cases
- ✅ Pewność że zmiany nie psują funkcjonalności

---

#### 2.4.2 Dodać JSDoc dokumentację

**Plik**: `src/lib/utils/common.ts`

```typescript
/**
 * Utility functions for data normalization and conversion
 * @module lib/utils/common
 */

/**
 * Normalizes a key to lowercase with underscores
 *
 * @param key - The key to normalize
 * @returns Normalized key in lowercase with underscores
 *
 * @example
 * ```typescript
 * normalizeKey("Total Premium") // => "total_premium"
 * normalizeKey("OC Sum")        // => "oc_sum"
 * ```
 */
export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/\s+/g, '_');
}

/**
 * Converts unknown value to number or null
 *
 * @param value - Value to convert (can be number, string, or other)
 * @param defaultValue - Default value if conversion fails (default: null)
 * @returns Parsed number or default value
 *
 * @example
 * ```typescript
 * toNumber(123)           // => 123
 * toNumber("1,234.56")    // => 1234.56
 * toNumber("invalid")     // => null
 * toNumber("invalid", 0)  // => 0
 * ```
 */
export function toNumber(
  value: unknown,
  defaultValue: number | null = null
): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value.replace(/[^\d.-]/g, ''));
    return isNaN(parsed) ? defaultValue : parsed;
  }
  return defaultValue;
}
```

**Oczekiwany rezultat**:
- ✅ Lepsze IntelliSense w IDE
- ✅ Łatwiejszy onboarding dla nowych developerów
- ✅ Automatyczna dokumentacja API

---

#### 2.4.3 Dodać README dla głównych modułów

**Plik**: `src/lib/buildComparisonSections/README.md` (NOWY)

```markdown
# Build Comparison Sections

Moduł odpowiedzialny za budowanie struktury sekcji porównania ofert ubezpieczeniowych.

## Architektura

```
buildComparisonSections/
├── index.ts              # Main entry point
├── price-section.ts      # Build price comparison section
├── coverage-section.ts   # Build coverage comparison section
├── assistance-section.ts # Build assistance comparison section
├── exclusions-section.ts # Build exclusions comparison section
└── utils/
    ├── build-row.ts      # Build individual comparison row
    ├── extract-*.ts      # Data extraction helpers
    └── calculate-diff.ts # Calculate diff status
```

## Użycie

```typescript
import { buildComparisonSections } from '@/lib/buildComparisonSections';

const sections = buildComparisonSections(
  offers,           // ComparisonOffer[]
  analysis,         // ComparisonAnalysis | null
  sourceMetadata    // SourceMetadata
);

// sections: ComparisonSection[]
```

## Sekcje

### Price Section
- Składka całkowita (po zniżkach)
- Składka przed zniżkami
- Zniżki (lista)
- Rabaty (%)

### Coverage Section
- OC suma ubezpieczenia
- AC suma ubezpieczenia
- Ochrona podstawowa
- Ochrony dodatkowe

### Assistance Section
- Lista usług assistance
- Lawer assistance
- Medical assistance
- Car rental

### Exclusions Section
- Wyłączenia z ochrony
- Ograniczenia
- Specjalne warunki

## Typy danych

Zobacz: `src/types/comparison.ts`

## Testy

```bash
bun test src/lib/buildComparisonSections/
```

## Rozszerzanie

Aby dodać nową sekcję:

1. Stwórz `new-section.ts`
2. Zaimplementuj `buildNewSection()` function
3. Dodaj do `index.ts` export
4. Dodaj testy `new-section.test.ts`
```

**Oczekiwany rezultat**:
- ✅ Dokumentacja architektury
- ✅ Przykłady użycia
- ✅ Łatwiejsze zrozumienie kodu

---

## 3. Plan Wdrożenia

### Harmonogram 4-tygodniowy

| Tydzień | Faza | Zadania | Priorytet |
|---------|------|---------|-----------|
| **1** | Security | S-1 do S-6: XSS fix, Logger, Env validation, AI sanitization | 🔴 KRYTYCZNY |
| **2** | Performance | P-1 do P-4: Refactor ComparisonResult, Memoization, Debounce | 🟠 WYSOKI |
| **3** | Code Quality | C-1 do C-4, T-1 do T-2: DRY, Constants, Types, Error Boundary | 🟡 ŚREDNI |
| **4** | Testing & Docs | TEST-1 do TEST-3, Documentation, A11y improvements | 🟡 ŚREDNI |

### Zasoby

- **Developer**: 1 full-time developer
- **Reviewer**: 1 part-time code reviewer
- **QA**: Testy manualne po każdej fazie

### Metryki sukcesu

| Metryka | Przed | Cel | Po wdrożeniu |
|---------|-------|-----|--------------|
| Security issues | 6 | 0 | ? |
| Performance score (Lighthouse) | ? | 90+ | ? |
| Bundle size | ? | -20% | ? |
| Code coverage | ~30% | 70% | ? |
| TypeScript `any` count | 10+ | 0 | ? |
| Average component size | 500 linii | <200 linii | ? |
| Build time | ? | -15% | ? |

---

## 4. Dodatkowe Rekomendacje (Długoterminowe)

### 4.1 Monitoring i Logging

**Narzędzia do rozważenia**:
- **Sentry** - Error tracking i performance monitoring
- **LogRocket** - Session replay dla debugowania
- **DataDog** - Comprehensive monitoring

**Implementacja**:
```typescript
// src/lib/monitoring.ts
import * as Sentry from '@sentry/react';

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  tracesSampleRate: 0.1,
  beforeSend(event) {
    // Filter sensitive data
    return event;
  }
});
```

### 4.2 CI/CD Pipeline

**GitHub Actions workflow**:
```yaml
# .github/workflows/ci.yml
name: CI

on: [push, pull_request]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: oven-sh/setup-bun@v1

      - name: Install dependencies
        run: bun install

      - name: TypeScript check
        run: bun run tsc --noEmit

      - name: Lint
        run: bun run lint

      - name: Test
        run: bun test

      - name: Build
        run: bun run build

      - name: Bundle size check
        run: |
          SIZE=$(du -sb dist | cut -f1)
          if [ $SIZE -gt 5000000 ]; then
            echo "Bundle too large: $SIZE bytes"
            exit 1
          fi
```

### 4.3 Performance Monitoring

**Web Vitals tracking**:
```typescript
// src/lib/web-vitals.ts
import { getCLS, getFID, getFCP, getLCP, getTTFB } from 'web-vitals';

function sendToAnalytics(metric: Metric) {
  // Send to Google Analytics, DataDog, etc.
  console.log(metric);
}

getCLS(sendToAnalytics);
getFID(sendToAnalytics);
getFCP(sendToAnalytics);
getLCP(sendToAnalytics);
getTTFB(sendToAnalytics);
```

### 4.4 Code Quality Tools

**Dodać do projektu**:
- **Prettier** - Code formatting
- **Husky** - Git hooks
- **lint-staged** - Pre-commit linting
- **commitlint** - Commit message linting

**Setup**:
```bash
bun add -d prettier husky lint-staged @commitlint/cli @commitlint/config-conventional

# .prettierrc
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2
}

# .husky/pre-commit
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

bunx lint-staged
```

---

## 5. Podsumowanie

### Co osiągniemy po wdrożeniu?

✅ **Bezpieczeństwo**
- Eliminacja XSS vulnerabilities
- Kontrolowane logowanie
- Walidacja wszystkich inputów
- Ochrona przed prompt injection

✅ **Wydajność**
- 60% mniej re-renderów
- Modularny kod łatwiejszy do optymalizacji
- Debounced localStorage writes
- Gotowość do wirtualizacji list

✅ **Jakość kodu**
- DRY principles
- Type-safe TypeScript
- Error Boundaries
- Dokumentacja

✅ **Utrzymanie**
- 80%+ test coverage
- Mniejsze komponenty (<200 linii)
- Jasna struktura projektu
- Łatwy onboarding

### Długoterminowe korzyści

1. **Szybszy development** - modularny kod łatwiejszy do rozbudowy
2. **Mniej bugów** - testy i type safety
3. **Lepsza UX** - wydajność i dostępność
4. **Bezpieczniejsza aplikacja** - eliminacja security issues
5. **Łatwiejszy hiring** - clean codebase przyciąga talenty

---

## 6. Następne kroki

1. **Review tego dokumentu** z zespołem
2. **Priorytetyzacja** - potwierdzić harmonogram
3. **Setup** - przygotować środowisko (branches, tickets)
4. **Kickoff** - rozpocząć od Fazy 1 (Security)
5. **Iteracja** - code review po każdym zadaniu

---

**Data przygotowania**: 2025-10-21
**Autor**: Claude Code Analysis
**Wersja**: 1.0

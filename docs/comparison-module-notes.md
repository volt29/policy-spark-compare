# Notatki wdrożeniowe modułu porównania ofert

## Zakres zmian

- Warstwa danych Supabase (`supabase/functions/extract-insurance-data/unified-builder.ts`) wzbogacona o ekstrakcję `payment_schedule` z normalizacją cykli oraz gromadzeniem cytatów źródłowych wykorzystywanych przez UI.
- Warstwa UI korzysta z `getPaymentDisplayInfo` i nowych struktur sekcji (`src/lib/comparison-utils.ts`, `src/lib/buildComparisonSections.ts`) do prezentacji płatności oraz rekomendacji zgodnych z analizą AI.
- Tooltipy korzystają z komponentu `SourceTooltip`, a linki są filtrowane i oznaczane pod kątem bezpieczeństwa (`src/lib/safeLinks.ts`).

## Decyzje projektowe

- **Ekstrakcja danych**: Rozbudowaliśmy parser Supabase o identyfikację cyklu płatności i wskazań źródłowych, aby UI miał jednoznaczne informacje o płatnościach i cytaty do tooltipów. Pozwala to stabilnie wspierać zarówno nowe, jak i historyczne dokumenty.
- **Rekomendacja ofert**: Funkcja `analyzeBestOffers` wybiera rekomendację na podstawie `summary.recommended_offer` z analizy AI. Gdy brak jednoznacznego dopasowania, fallback wybiera najtańszą ofertę, zapewniając pojedynczy znacznik „Rekomendowana”.

## Ograniczenia i dalsze kroki

- Wykrywanie cyklu płatności opiera się na dopasowaniu słów kluczowych; nietypowe formaty mogą trafić do kategorii „inne”. Rozszerzenie słowników lub heurystyk pomoże w kolejnych iteracjach.
- Tooltipy wymagają, aby Supabase dostarczyło cytaty z lokalizacją w dokumencie. Dla plików bez metadanych prezentujemy tooltip bez lokalizacji — warto rozważyć wymuszanie tych danych podczas ekstrakcji.
- Walidacja linków oznacza jako niebezpieczne wszystko poza HTTPS i hostami publicznymi. Można rozważyć białą listę znanych domen ubezpieczycieli, aby ograniczyć false-positives.

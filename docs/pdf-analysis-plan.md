# Poprawiony prompt dla analizy ofert PDF

🧠 **Kontekst**

Moduł porównywania ofert w aplikacji Policy Spark korzysta z funkcji brzegowej Supabase `extract-insurance-data`. Funkcja przyjmuje PDF-y przesłane przez użytkowników (np. „Kalkulacja_nr_4381280…”) i przetwarza je przy pomocy:

- konwersji PDF → obrazy (ConvertAPI) w celu obsługi wielostronicowych dokumentów,
- parsera tekstu ([PDF Parser]) do pozyskiwania surowych danych z każdej strony,
- lekkiego klasyfikatora słów kluczowych (np. "ON", "CU", "AB14", "YO14", "Assistance") do mapowania sekcji,
- gatewaya Lovable AI do rekonstrukcji brakujących struktur.

🧾 **Task**

1. Przetwórz każdą stronę PDF poprzez [PDF Parser], a w razie potrzeby uzupełnij brakujące pola na podstawie analiz AI.
2. Wykryj i znormalizuj sekcje dokumentu:
   - dane ubezpieczonych (imię, wiek, rola),
   - umowy podstawowe i dodatkowe (wraz z wariantem/zakresem),
   - sumy ubezpieczenia oraz składki przed i po zniżkach,
   - okres obowiązywania i warianty (np. pełny, rozszerzony),
   - assistance, zniżki oraz dodatkowe świadczenia.
3. Zbuduj zunifikowaną strukturę JSON (neutralną względem TU) zgodną ze schematem:

```json
{
  "offer_id": "3411939.4381280",
  "source_document": "Kalkulacja_nr_4381280.pdf",
  "insured": [
    {
      "name": "Maciej",
      "age": 38,
      "role": "ubezpieczony",
      "plans": [
        {"type": "Nowotwór", "sum": 50000, "premium": 36.92, "variant": "pełny", "duration": "12 miesięcy"},
        {"type": "Szpital", "sum": 20000, "premium": 92.83, "variant": "premium", "duration": "36 miesięcy"}
      ]
    }
  ],
  "base_contracts": [
    {"name": "Życie", "sum": 250000, "premium": 122.40, "variant": "standard"}
  ],
  "additional_contracts": [
    {"name": "Assistance domowy", "coverage": "do 10 interwencji", "premium": 14.50}
  ],
  "discounts": ["Więcej za mniej", "Płatność zlecenie"],
  "total_premium_before_discounts": 615.90,
  "total_premium_after_discounts": 584.77,
  "assistance": [
    {"name": "Medicover Assistance", "coverage": "24/7", "limits": "nielimitowane konsultacje"}
  ],
  "duration": {
    "start": "2024-05-01",
    "end": "2025-04-30",
    "variant": "pełny"
  },
  "notes": ["Wariant rozszerzony zawiera świadczenia szpitalne"],
  "missing_fields": ["insured[0].age"],
  "extraction_confidence": "high"
}
```

Wartości nieodczytane oznacz jako "missing" lub dodaj do tablicy `missing_fields`. Każda oferta musi posiadać unikalny `offer_id`, listę `insured` oraz pola sumy składek. Struktura musi być gotowa do bezpośredniego porównania po typie planu, sumie, składce i czasie trwania.

🧩 **Guidelines**

- Priorytetowo wykorzystuj dane z parsera PDF; AI traktuj jako uzupełnienie.
- Utrzymuj neutralne nazewnictwo pól (bez skrótów TU).
- Stosuj klasyfikator słów kluczowych do identyfikacji planów i wariantów.
- Nie modyfikuj istniejącej logiki uploadu ani schematów bazodanowych bez konsultacji.
- Zapewnij możliwość powiązania każdego rekordu z dokumentem źródłowym (`source_document`).

---

# Plan implementacji

1. **Wydobycie tekstu z PDF**  
   - Dodaj moduł `pdf-parser.ts` w `supabase/functions/extract-insurance-data/` odpowiedzialny za parsowanie PDF (np. poprzez Deno npm import `pdf-parse` lub `pdfjs-dist`).  
   - Wykorzystaj istniejący strumień bajtów `bytes` (pobrany z magazynu Supabase) do uruchomienia parsera i zwróć tekst posegmentowany per strona.  
   - Zaimplementuj fallback do konwersji na obrazy (obecny mechanizm ConvertAPI) przy błędach parsera.

2. **Normalizacja sekcji**  
   - Stwórz helper `segmentInsuranceSections(textPages: string[])` identyfikujący sekcje po słowach kluczowych i nagłówkach.  
   - Zaimplementuj prosty klasyfikator (mapa słów kluczowych → kategorie) wykorzystywany w helperze.  
   - Przechowuj wyniki w strukturze pośredniej (np. `ParsedSection[]`).

3. **Budowa zunifikowanego JSON**  
   - Dodaj funkcję `buildUnifiedOffer(sections, metadata)` generującą strukturę zgodną z nowym schematem.  
   - Wykorzystaj dokumentowe metadane (np. nazwa pliku, identyfikatory z bazy) do konstruowania `offer_id` i `source_document`.  
   - Upewnij się, że brakujące wartości są oznaczane jako "missing" i listowane w `missing_fields`.

4. **Integracja z Lovable AI**  
   - Przeprojektuj payload wysyłany do Lovable tak, aby zawierał: tekst z parsera, wybrane fragmenty obrazów (dla potwierdzenia) oraz opis powstałych sekcji.  
   - Zaktualizuj schemat funkcji narzędzia (`extractionSchema`) do nowej struktury.  
   - W systemowym promptcie uwzględnij korzystanie z danych parsera jako źródła prawdy oraz zasady fallbacku.

5. **Zapis wyników i kompatybilność UI**  
   - Zaktualizuj miejsca w aplikacji React (`src/pages/ComparisonResult.tsx`, `src/components/comparison/*`) aby operowały na polach `total_premium_before_discounts`, `total_premium_after_discounts`, `insured[].plans[]` itd.  
   - Dodaj funkcje pomocnicze mapujące nowe dane na obecne widoki (np. generowanie list świadczeń, wyliczanie metryk).

6. **Testy i monitoring**  
   - Dodaj testy jednostkowe dla klasyfikatora i buildera JSON (np. w Deno).  
   - W Supabase Edge Function zaimplementuj dodatkowe logowanie (liczba wykrytych sekcji, brakujące pola).  
   - Zweryfikuj działanie na próbkach PDF (min. 2 dokumenty) i opisz wyniki w README lub osobnym raporcie.


const DEFAULT_LOCALE = "pl-PL";

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const sanitized = value.replace(/\s+/g, "").replace(",", ".");
    const parsed = Number(sanitized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const normalizeCurrencyCode = (currency?: string | null): string => {
  if (typeof currency !== "string") {
    return "PLN";
  }
  const cleaned = currency.trim().toUpperCase();
  return cleaned.length === 3 ? cleaned : "PLN";
};

export interface FormatValueOptions {
  type?: "currency" | "number";
  unit?: string | null;
  source?: string | null;
  normalization?: string | null;
  locale?: string;
  maximumFractionDigits?: number;
  minimumFractionDigits?: number;
  note?: string | null;
}

export interface FormattedValueResult {
  displayValue: string | null;
  normalizedValue: number | null;
  tooltip: string | null;
  isNumeric: boolean;
  unit?: string | null;
}

const buildTooltip = (
  source?: string | null,
  normalization?: string | null,
  note?: string | null,
): string | null => {
  const parts: string[] = [];
  if (source) {
    parts.push(`Źródło: ${source}`);
  }
  if (normalization) {
    parts.push(`Normalizacja: ${normalization}`);
  }
  if (note) {
    parts.push(note);
  }
  return parts.length > 0 ? parts.join(" | ") : null;
};

export const formatValueWithUnit = (
  value: unknown,
  {
    type,
    unit,
    source,
    normalization,
    locale = DEFAULT_LOCALE,
    maximumFractionDigits,
    minimumFractionDigits,
    note,
  }: FormatValueOptions = {},
): FormattedValueResult => {
  const numericValue = toNumber(value);
  const tooltip = buildTooltip(source, normalization, note);

  if (numericValue === null) {
    if (typeof value === "string" && value.trim().length > 0) {
      return {
        displayValue: value.trim(),
        normalizedValue: null,
        tooltip,
        isNumeric: false,
        unit,
      };
    }

    return {
      displayValue: null,
      normalizedValue: null,
      tooltip,
      isNumeric: false,
      unit,
    };
  }

  const formatterOptions: Intl.NumberFormatOptions = {};
  const fractionDigits = {
    minimumFractionDigits,
    maximumFractionDigits,
  };

  if (type === "currency") {
    const currency = normalizeCurrencyCode(unit ?? normalization ?? undefined);
    formatterOptions.style = "currency";
    formatterOptions.currency = currency;
    formatterOptions.maximumFractionDigits = fractionDigits.maximumFractionDigits ?? 2;
    formatterOptions.minimumFractionDigits = fractionDigits.minimumFractionDigits ?? 0;
  } else {
    formatterOptions.maximumFractionDigits = fractionDigits.maximumFractionDigits ?? 2;
    if (typeof fractionDigits.minimumFractionDigits === "number") {
      formatterOptions.minimumFractionDigits = fractionDigits.minimumFractionDigits;
    }
  }

  let displayValue = new Intl.NumberFormat(locale, formatterOptions).format(numericValue);

  if (type !== "currency" && unit) {
    displayValue = `${displayValue} ${unit}`.trim();
  }

  return {
    displayValue,
    normalizedValue: numericValue,
    tooltip,
    isNumeric: true,
    unit,
  };
};

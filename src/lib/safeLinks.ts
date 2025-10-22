const URL_REGEX = /(https?:\/\/[^\s<]+)/gi;

export interface TextSegment {
  type: "text" | "link";
  value: string;
  url?: string;
  safe?: boolean;
  reason?: string;
}

interface LinkSafetyResult {
  safe: boolean;
  reason?: string;
}

const SUSPICIOUS_HOSTS = new Set(["localhost", "127.0.0.1"]);

const isIpAddress = (host: string): boolean => {
  if (!host) return false;
  const ipv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
  const ipv6 = /^[0-9a-f:]+$/i;
  return ipv4.test(host) || ipv6.test(host);
};

export const evaluateLinkSafety = (rawUrl: string): LinkSafetyResult => {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") {
      return { safe: false, reason: "Dozwolone są tylko bezpieczne adresy HTTPS." };
    }
    const host = url.hostname.toLowerCase();
    if (SUSPICIOUS_HOSTS.has(host) || isIpAddress(host)) {
      return { safe: false, reason: "Adres prowadzi do niezaufanego hosta." };
    }
    if (host.includes("@") || host.includes("%")) {
      return { safe: false, reason: "Adres wygląda na podejrzany." };
    }
    return { safe: true };
  } catch {
    return { safe: false, reason: "Nieprawidłowy adres URL." };
  }
};

export const segmentTextWithLinks = (input: string): TextSegment[] => {
  if (!input) {
    return [];
  }

  const segments: TextSegment[] = [];
  let lastIndex = 0;

  for (const match of input.matchAll(URL_REGEX)) {
    const url = match[0];
    const index = match.index ?? 0;

    if (index > lastIndex) {
      segments.push({ type: "text", value: input.slice(lastIndex, index) });
    }

    const safety = evaluateLinkSafety(url);
    segments.push({
      type: "link",
      value: url,
      url,
      safe: safety.safe,
      reason: safety.reason,
    });
    lastIndex = index + url.length;
  }

  if (lastIndex < input.length) {
    segments.push({ type: "text", value: input.slice(lastIndex) });
  }

  return segments;
};

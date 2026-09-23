import type { Certificate } from "./types";

// Match certificate words, not unrelated keys such as INSERT.
const certificateWord = /(?:certificat|sertifikat|сертиф)|(?:^|[^a-z])(?:cert|sert)(?:$|[^a-z])/iu;
const fileField = /^(?:value|values|file|files|url|src|href|path|link|download_url)$/i;
const metadataField = /^(?:name|label|title|description|original_name|file_name)$/i;

function decodeEntities(value: string): string {
  const named: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (match, entity: string) => {
    if (!entity.startsWith("#")) return named[entity.toLowerCase()] ?? match;
    const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

function documentUrl(value: string): string | null {
  const candidate = decodeEntities(value).trim();
  // A bare word/ID is not a relative URL. Require an explicit path or filename.
  if (!candidate || /[<>"'\\\u0000-\u001f\u007f]/u.test(candidate)) return null;
  const absolute = /^https:\/\/[^/]/i.test(candidate);
  const relative = /^(?:\/(?!\/)|\.\.?\/)/.test(candidate)
    || /^(?:[^/:?#]+\/)+[^?#]+/.test(candidate)
    || /^[^/:?#]+\.(?:pdf|jpe?g|png|webp|tiff?)(?:[?#]|$)/i.test(candidate)
    || /^\/\/[^/]/.test(candidate);
  if (!absolute && !relative) return null;
  try {
    const url = new URL(candidate, "https://ekt.kz");
    if (url.protocol !== "https:" || url.username || url.password || url.pathname === "/") return null;
    return url.href;
  } catch { return null; }
}

/** Extract source links only; a link does not establish validity or product applicability. */
export function extractCertificates(raw: Record<string, unknown>): Certificate[] {
  const result: Certificate[] = [];
  const seen = new Set<string>();
  const add = (value: string, label: string, source: string) => {
    const url = documentUrl(value);
    if (!url || seen.has(url)) return;
    seen.add(url);
    result.push({ label, url, source });
  };
  const anchors = (html: string, source: string, contextLabel?: string) => {
    // Strip comments and non-content blocks before inspecting real anchor attributes.
    const content = html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
    for (const anchor of content.matchAll(/<a\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/a\s*>/gi)) {
      const label = decodeEntities(anchor[2].replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
      if (!contextLabel && !certificateWord.test(label)) continue;
      const attrs = anchor[1].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g);
      for (const attr of attrs) {
        if (attr[1].toLowerCase() === "href") {
          add(attr[2] ?? attr[3] ?? attr[4], contextLabel ?? label, source);
          break;
        }
      }
    }
  };

  const visited = new WeakSet<object>();
  const walk = (value: unknown, source: string, label?: string, depth = 0) => {
    if (depth > 20 || value == null) return;
    if (typeof value === "string") {
      if (/<a\b/i.test(value)) anchors(value, source, label);
      else if (label) add(value, label, source);
      return;
    }
    if (typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      value.forEach((entry, i) => walk(entry, `${source}[${i}]`, label, depth + 1));
      return;
    }
    const entries = Object.entries(value);
    const fileLabel = entries.find(([key, text]) => metadataField.test(key) && typeof text === "string" && certificateWord.test(text))?.[1];
    const context = label ?? (source && typeof fileLabel === "string" ? fileLabel : undefined);
    for (const [key, child] of entries) {
      if (metadataField.test(key)) {
        if (typeof child === "string") anchors(child, source ? `${source}.${key}` : key);
        continue;
      }
      const childSource = source ? `${source}.${key}` : key;
      const childLabel = certificateWord.test(key) ? key : fileField.test(key) ? context : undefined;
      walk(child, childSource, childLabel, depth + 1);
    }
  };
  walk(raw, "");
  return result;
}

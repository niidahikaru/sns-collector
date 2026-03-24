import type { MetricValue } from './types';

/**
 * Parse a metric display string into a MetricValue.
 * "1.2K" -> { raw: "1.2K", parsed: 1200 }
 * "123"  -> { raw: "123", parsed: 123 }
 * ""     -> { raw: "", parsed: null }
 * "—"    -> { raw: "—", parsed: null }
 */
export function parseMetricText(text: string): MetricValue {
  const raw = text.trim();
  if (!raw || raw === '—' || raw === '-') {
    return { raw, parsed: null };
  }

  const cleaned = raw.replace(/,/g, '');

  // Japanese suffixes: 万 (×10,000), 億 (×100,000,000)
  const jpMatch = cleaned.match(/^([\d.]+)\s*([万億])$/);
  if (jpMatch) {
    const num = parseFloat(jpMatch[1]!);
    if (isNaN(num)) return { raw, parsed: null };
    const multiplier = jpMatch[2] === '万' ? 10000 : 100000000;
    return { raw, parsed: Math.round(num * multiplier) };
  }

  const match = cleaned.match(/^([\d.]+)([KkMm])?$/);
  if (!match) {
    return { raw, parsed: null };
  }

  let num = parseFloat(match[1]!);
  const suffix = match[2]?.toUpperCase();
  if (suffix === 'K') num *= 1000;
  if (suffix === 'M') num *= 1000000;

  return { raw, parsed: Math.round(num) };
}

/**
 * Extract a number from an aria-label string.
 * "1,234 replies" -> "1,234"
 * "15 Likes" -> "15"
 */
export function extractNumberFromAriaLabel(element: Element): string | null {
  const ariaLabel =
    element.getAttribute('aria-label') ||
    element.closest('[aria-label]')?.getAttribute('aria-label') ||
    '';
  const match = ariaLabel.match(/([\d,.]+[KkMm]?)\s/);
  if (match) return match[1]!;

  const text = (element as HTMLElement).innerText?.trim();
  if (!text) return null;
  if (/^[\d,.]+[KkMm]?$/.test(text)) return text;
  const m = text.match(/([\d,.]+[KkMm]?)/);
  return m ? m[1]! : null;
}

// Last-pass filter so Muse tool payloads cannot carry a price, even if a
// directory or CRM field starts returning one.

const PRICE_KEY = /price|cost|fee|currency|hourly|amount/i;
const TEXT_KEY = /description|notes|message/i;
const PRICE_TEXT = /(?:\$|USD|EUR|GBP)\s?\d/;

export function looksLikePriceText(value: string): boolean {
  return PRICE_TEXT.test(value);
}

export function omitPriceFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => omitPriceFields(item));
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (PRICE_KEY.test(key)) continue;
    if (typeof child === 'string' && TEXT_KEY.test(key) && looksLikePriceText(child)) continue;
    out[key] = omitPriceFields(child);
  }
  return out;
}

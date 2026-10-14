import type { DirectoryDetailer } from './types';
import { detailerAirportCodes } from './search';
import { looksLikePriceText, omitPriceFields } from './sanitize';

export interface CrmService {
  name: string;
  description?: string;
}

export interface CrmProfile {
  description: string | null;
  phone: string | null;
  website_url: string | null;
  services: CrmService[];
  insured: boolean | null;
  verified_finish: boolean | null;
  certifications: string[] | null;
  online_booking: boolean | null;
  avg_rating: number | null;
  review_count: number | null;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || looksLikePriceText(text)) return null;
  return text;
}

export function parseCrmProfile(json: unknown): CrmProfile | null {
  if (!json || typeof json !== 'object') return null;
  const root = json as Record<string, unknown>;
  const detailer = root.detailer && typeof root.detailer === 'object' ? (root.detailer as Record<string, unknown>) : root;
  const servicesRaw = Array.isArray(detailer.services) ? detailer.services : [];
  const services: CrmService[] = [];
  for (const item of servicesRaw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!name || looksLikePriceText(name)) continue;
    const description = cleanText(row.description);
    services.push(description ? { name, description } : { name });
  }
  return {
    description: cleanText(detailer.description),
    phone: cleanText(detailer.phone),
    website_url: cleanText(detailer.website_url),
    services,
    insured: typeof detailer.insured === 'boolean' ? detailer.insured : null,
    verified_finish: typeof detailer.verified_finish === 'boolean' ? detailer.verified_finish : null,
    certifications: Array.isArray(detailer.certifications)
      ? detailer.certifications.filter((item): item is string => typeof item === 'string' && !looksLikePriceText(item))
      : null,
    online_booking: typeof detailer.online_booking === 'boolean' ? detailer.online_booking : null,
    avg_rating: typeof detailer.avg_rating === 'number' ? detailer.avg_rating : null,
    review_count: typeof detailer.review_count === 'number' ? detailer.review_count : null,
  };
}

export function publicWebsite(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function projectDetailer(detailer: DirectoryDetailer, crm: CrmProfile | null, siteUrl: string): Record<string, unknown> {
  const slug = detailer.slug || '';
  const company = (detailer.company || '').trim() || (detailer.name || '').trim() || 'Aircraft detailer';
  const descriptions = new Map<string, string>();
  for (const service of crm?.services || []) {
    if (service.description) descriptions.set(service.name.toLowerCase(), service.description);
  }
  const names = detailer.services?.length ? detailer.services : (crm?.services || []).map((service) => service.name);
  const services = names
    .filter((name) => name && !looksLikePriceText(name))
    .map((name) => {
      const description = descriptions.get(name.toLowerCase());
      return description ? { name, description } : { name };
    });
  const rating = detailer.combined_avg_rating ?? crm?.avg_rating ?? null;
  const reviewCount = detailer.combined_review_count || crm?.review_count || 0;
  return omitPriceFields({
    company,
    contact_name: (detailer.name || '').trim() || null,
    slug,
    profile_url: `${siteUrl.replace(/\/$/, '')}/detailer/${slug}`,
    home_airport: detailer.home_airport || null,
    airports: detailerAirportCodes(detailer),
    city: detailer.city || null,
    region: detailer.region || null,
    country: detailer.country || null,
    description: (detailer.directory_description || '').trim() || crm?.description || null,
    services,
    certifications: detailer.certifications?.length ? detailer.certifications : crm?.certifications || [],
    insurance_verified: Boolean(detailer.insurance_verified || crm?.insured),
    verified_finish: Boolean(detailer.verified_finish || crm?.verified_finish),
    online_booking: Boolean(detailer.has_online_booking || crm?.online_booking),
    rating,
    review_count: reviewCount,
    plan: detailer.plan || 'free',
    sponsored: false,
    phone: crm?.phone || null,
    website: publicWebsite(crm?.website_url || null),
    logo_url: detailer.logo_url || null,
  }) as Record<string, unknown>;
}

export async function getPublicDetailer(
  slug: string,
  deps: {
    detailers: DirectoryDetailer[];
    fetchCrmProfile: (slug: string) => Promise<CrmProfile | null>;
    siteUrl: string;
  },
): Promise<Record<string, unknown> | null> {
  const wanted = slug.trim().toLowerCase();
  if (!wanted) return null;
  const detailer = deps.detailers.find((row) => (row.slug || '').toLowerCase() === wanted);
  if (!detailer?.slug) return null;
  let crm: CrmProfile | null = null;
  try {
    crm = await deps.fetchCrmProfile(detailer.slug);
  } catch {
    crm = null;
  }
  return projectDetailer(detailer, crm, deps.siteUrl);
}

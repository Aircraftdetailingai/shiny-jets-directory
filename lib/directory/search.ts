import { distanceMiles } from '../detailer';
import type { ResolvedPlace } from './airports';
import { omitPriceFields } from './sanitize';
import type { DirectoryDetailer } from './types';

export const DEFAULT_RADIUS_MILES = 100;
export const MAX_RADIUS_MILES = 500;
export const MAX_SEARCH_RESULTS = 15;

export const SEARCH_RANK_NOTE =
  'Detailers who serve the resolved airport come first, then shorter distance, then higher combined rating, then more reviews, then name. Paid plans do not change the order. sponsored is false on every result. No prices are included.';

const CODE_RE = /^[A-Z0-9-]{2,7}$/;

export function detailerAirportCodes(detailer: DirectoryDetailer): string[] {
  const raw: string[] = [];
  if (detailer.home_airport) raw.push(detailer.home_airport);
  for (const code of detailer.airports_served || []) raw.push(String(code));
  for (const location of detailer.locations || []) {
    if (location.airport_icao) raw.push(location.airport_icao);
  }
  const out = new Set<string>();
  for (const item of raw) {
    for (const part of item.split(/[^A-Za-z0-9-]+/)) {
      const code = part.trim().toUpperCase();
      if (CODE_RE.test(code)) out.add(code);
    }
  }
  return Array.from(out);
}

export function nearestMiles(detailer: DirectoryDetailer, lat: number, lng: number): number | null {
  const points: Array<[number, number]> = [];
  if (typeof detailer.lat === 'number' && typeof detailer.lng === 'number' && Number.isFinite(detailer.lat) && Number.isFinite(detailer.lng)) {
    points.push([detailer.lat, detailer.lng]);
  }
  for (const location of detailer.locations || []) {
    if (Number.isFinite(location.latitude) && Number.isFinite(location.longitude)) {
      points.push([location.latitude, location.longitude]);
    }
  }
  if (points.length === 0) return null;
  let best = Infinity;
  for (const [plat, plng] of points) {
    const miles = distanceMiles(lat, lng, plat, plng);
    if (miles < best) best = miles;
  }
  return Number.isFinite(best) ? best : null;
}

function serviceMatches(detailer: DirectoryDetailer, service: string): boolean {
  const needle = service.trim().toLowerCase();
  if (!needle) return true;
  return (detailer.services || []).some((name) => name.toLowerCase().includes(needle));
}

function displayName(detailer: DirectoryDetailer): string {
  const company = (detailer.company || '').trim();
  const name = (detailer.name || '').trim();
  return company || name || 'Aircraft detailer';
}

export interface RankedHit {
  detailer: DirectoryDetailer;
  serves: boolean;
  matchedCode: string | null;
  distance: number | null;
}

export function rankDetailers(detailers: DirectoryDetailer[], place: ResolvedPlace, radiusMiles: number, service?: string): RankedHit[] {
  const wanted = new Set(place.codes.map((code) => code.toUpperCase()));
  const hits: RankedHit[] = [];
  for (const detailer of detailers) {
    if (!detailer.slug) continue;
    if (service && !serviceMatches(detailer, service)) continue;
    const codes = detailerAirportCodes(detailer);
    const matchedCode = codes.find((code) => wanted.has(code)) || null;
    const distance = nearestMiles(detailer, place.lat, place.lng);
    const within = distance != null && distance <= radiusMiles;
    if (!matchedCode && !within) continue;
    hits.push({ detailer, serves: Boolean(matchedCode), matchedCode, distance });
  }

  hits.sort((a, b) => {
    if (a.serves !== b.serves) return a.serves ? -1 : 1;
    const aDist = a.distance == null ? null : a.distance;
    const bDist = b.distance == null ? null : b.distance;
    if (aDist == null && bDist != null) return 1;
    if (bDist == null && aDist != null) return -1;
    if (aDist != null && bDist != null && Math.abs(aDist - bDist) > 0.05) return aDist - bDist;
    const aRating = a.detailer.combined_avg_rating;
    const bRating = b.detailer.combined_avg_rating;
    if (aRating == null && bRating != null) return 1;
    if (bRating == null && aRating != null) return -1;
    if (aRating != null && bRating != null && aRating !== bRating) return bRating - aRating;
    const byReviews = (b.detailer.combined_review_count || 0) - (a.detailer.combined_review_count || 0);
    if (byReviews !== 0) return byReviews;
    return displayName(a.detailer).localeCompare(displayName(b.detailer));
  });
  return hits;
}

function roundMiles(miles: number): number {
  return Math.round(miles * 10) / 10;
}

export function projectHit(hit: RankedHit, place: ResolvedPlace, siteUrl: string): Record<string, unknown> {
  const detailer = hit.detailer;
  const slug = detailer.slug || '';
  const placeLabel = place.code || place.city || place.query;
  const matchReason = hit.serves
    ? `Serves ${hit.matchedCode || placeLabel}`
    : hit.distance != null
      ? `${Math.round(hit.distance)} miles from ${placeLabel}`
      : `Near ${placeLabel}`;
  return {
    company: displayName(detailer),
    contact_name: (detailer.name || '').trim() || null,
    slug,
    profile_url: `${siteUrl}/detailer/${slug}`,
    home_airport: detailer.home_airport || null,
    airports: detailerAirportCodes(detailer),
    city: detailer.city || null,
    region: detailer.region || null,
    country: detailer.country || null,
    distance_miles: hit.distance == null ? null : roundMiles(hit.distance),
    serves_airport: hit.serves,
    match_reason: matchReason,
    services: detailer.services || [],
    certifications: detailer.certifications || [],
    insurance_verified: Boolean(detailer.insurance_verified),
    verified_finish: Boolean(detailer.verified_finish),
    online_booking: Boolean(detailer.has_online_booking),
    rating: detailer.combined_avg_rating,
    review_count: detailer.combined_review_count || 0,
    plan: detailer.plan || 'free',
    sponsored: false,
    description: (detailer.directory_description || '').trim() || null,
  };
}

export async function searchDetailers(
  input: { location?: unknown; service?: unknown; radius_miles?: unknown },
  deps: {
    detailers: DirectoryDetailer[];
    resolve: (query: string) => Promise<ResolvedPlace | null>;
    siteUrl: string;
    limit?: number;
  },
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  if (typeof input.location !== 'string' || input.location.trim().length < 2) {
    return { ok: false, error: 'location is required and must be an airport code or place name.' };
  }
  let service: string | undefined;
  if (input.service != null && input.service !== '') {
    if (typeof input.service !== 'string') return { ok: false, error: 'service must be a string.' };
    service = input.service.trim().slice(0, 160);
  }
  let radius = DEFAULT_RADIUS_MILES;
  if (input.radius_miles != null && input.radius_miles !== '') {
    const n = typeof input.radius_miles === 'number' ? input.radius_miles : Number(input.radius_miles);
    if (!Number.isFinite(n) || n < 1 || n > MAX_RADIUS_MILES) {
      return { ok: false, error: `radius_miles must be a number from 1 to ${MAX_RADIUS_MILES}.` };
    }
    radius = n;
  }

  const place = await deps.resolve(input.location.trim());
  if (!place) {
    return { ok: false, error: `No airport or place matched "${input.location.trim()}". Try an ICAO or IATA code such as KTEB or TEB.` };
  }

  const ranked = rankDetailers(deps.detailers, place, radius, service);
  const limit = deps.limit ?? MAX_SEARCH_RESULTS;
  const detailers = ranked.slice(0, limit).map((hit) => projectHit(hit, place, deps.siteUrl.replace(/\/$/, '')));
  const data = omitPriceFields({
    location: {
      query: place.query,
      airport: place.name,
      code: place.code,
      codes: place.codes,
      city: place.city,
      region: place.region,
      radius_miles: radius,
    },
    rank: SEARCH_RANK_NOTE,
    service: service || null,
    total_matches: ranked.length,
    returned: detailers.length,
    detailers,
  });
  return { ok: true, data: data as Record<string, unknown> };
}

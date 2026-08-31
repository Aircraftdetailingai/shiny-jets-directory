// Shared detailer shape + helpers used by both the page and the Globe.
// Kept out of Globe.tsx so the page can import them without pulling in three.js.

export interface Detailer {
  id: string;
  company: string;
  name: string;
  home_airport: string;
  plan: string;
  has_online_booking: boolean;
  logo_url?: string;
  slug?: string;
  country?: string;
  avg_rating?: number;
  review_count?: number;
  services?: string[];
  certifications?: string[];
  directory_description?: string;
  airports_served?: string[];
  verified_finish?: boolean;
  insurance_verified?: boolean;
  // Server-resolved home_airport coordinates + place (from /api/detailers).
  lat?: number | null;
  lng?: number | null;
  city?: string | null;
  region?: string | null;
}

export function detailerSlug(d: Detailer): string {
  return (
    d.slug ||
    (d.company || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') ||
    d.id
  );
}

export function detailerPlace(d: Detailer): string | null {
  if (d.city && d.region) return `${d.city}, ${d.region}`;
  return d.city || d.region || null;
}

export function detailerCoords(d: Detailer): [number, number] | null {
  if (typeof d.lat === 'number' && typeof d.lng === 'number' && Number.isFinite(d.lat) && Number.isFinite(d.lng)) {
    return [d.lat, d.lng];
  }
  return null;
}

export function distanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

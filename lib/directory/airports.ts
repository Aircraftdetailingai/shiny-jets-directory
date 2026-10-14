import type { SupabaseClient } from '@supabase/supabase-js';

// Resolve an airport code or place name to a point and the codes detailers
// use for that airport. Ranking matches /api/resolve-airport: ICAO, then GPS,
// then IATA, then local code; scheduled service and larger airports win ties.

export interface AirportRow {
  icao: string | null;
  gps_code: string | null;
  iata: string | null;
  local_code: string | null;
  name: string | null;
  lat: number | string | null;
  lng: number | string | null;
  type: string | null;
  scheduled_service: boolean | null;
  city: string | null;
  iso_region: string | null;
}

export interface ResolvedPlace {
  query: string;
  name: string | null;
  code: string | null;
  codes: string[];
  city: string | null;
  region: string | null;
  lat: number;
  lng: number;
}

export interface AirportLookup {
  byCodes(codes: string[]): Promise<AirportRow[]>;
  byText(text: string): Promise<AirportRow[]>;
}

const CODE_RE = /^[A-Z0-9-]{2,7}$/;

export function regionFromIso(iso: string | null): string | null {
  if (!iso) return null;
  const parts = iso.split('-');
  return parts.length > 1 ? parts[parts.length - 1] : iso;
}

function typeRank(t: string | null): number {
  if (t === 'large_airport') return 0;
  if (t === 'medium_airport') return 1;
  if (t === 'small_airport') return 2;
  return 3;
}

function finiteCoord(value: number | string | null): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function codeRank(row: AirportRow, code: string): number {
  if (row.icao?.toUpperCase() === code) return 1;
  if (row.gps_code?.toUpperCase() === code) return 2;
  if (row.iata?.toUpperCase() === code) return 3;
  if (row.local_code?.toUpperCase() === code) return 4;
  return 5;
}

export function pickBestForCode(rows: AirportRow[], code: string): AirportRow | null {
  const wanted = code.toUpperCase();
  const ranked = rows
    .filter((row) => finiteCoord(row.lat) != null && finiteCoord(row.lng) != null)
    .filter((row) => codeRank(row, wanted) < 5)
    .sort(
      (a, b) =>
        codeRank(a, wanted) - codeRank(b, wanted) ||
        Number(b.scheduled_service === true) - Number(a.scheduled_service === true) ||
        typeRank(a.type) - typeRank(b.type),
    );
  return ranked[0] || null;
}

function textScore(row: AirportRow, query: string): number {
  const q = query.trim().toLowerCase();
  const city = (row.city || '').toLowerCase();
  const name = (row.name || '').toLowerCase();
  let score = 0;
  if (city === q) score += 100;
  else if (city.startsWith(q)) score += 50;
  else if (city.includes(q)) score += 20;
  if (name === q) score += 80;
  else if (name.includes(q)) score += 10;
  return score;
}

function cityExact(row: AirportRow, query: string): boolean {
  return (row.city || '').trim().toLowerCase() === query.trim().toLowerCase();
}

export function pickBestForText(rows: AirportRow[], query: string): AirportRow | null {
  const ranked = rows
    .filter((row) => finiteCoord(row.lat) != null && finiteCoord(row.lng) != null)
    .filter((row) => textScore(row, query) > 0)
    .sort(
      (a, b) =>
        Number(cityExact(b, query)) - Number(cityExact(a, query)) ||
        typeRank(a.type) - typeRank(b.type) ||
        Number(b.scheduled_service === true) - Number(a.scheduled_service === true) ||
        textScore(b, query) - textScore(a, query) ||
        (a.name || '').localeCompare(b.name || ''),
    );
  return ranked[0] || null;
}

function codesOn(row: AirportRow): string[] {
  return [row.icao, row.iata, row.gps_code, row.local_code]
    .map((code) => (code || '').trim().toUpperCase())
    .filter((code) => CODE_RE.test(code));
}

function toPlace(query: string, best: AirportRow, siblings: AirportRow[]): ResolvedPlace | null {
  const lat = finiteCoord(best.lat);
  const lng = finiteCoord(best.lng);
  if (lat == null || lng == null) return null;
  const codes = new Set<string>(codesOn(best));
  const city = (best.city || '').trim().toLowerCase();
  if (city) {
    for (const row of siblings) {
      if ((row.city || '').trim().toLowerCase() !== city) continue;
      for (const code of codesOn(row)) codes.add(code);
    }
  }
  const display = codesOn(best);
  return {
    query,
    name: best.name || null,
    code: display[0] || null,
    codes: Array.from(codes),
    city: best.city || null,
    region: regionFromIso(best.iso_region),
    lat,
    lng,
  };
}

export function codeVariants(raw: string): string[] {
  const code = raw.trim().toUpperCase();
  if (!CODE_RE.test(code)) return [];
  const variants = new Set<string>([code]);
  if (code.length === 3) variants.add(`K${code}`);
  if (code.length === 4 && code.startsWith('K')) variants.add(code.slice(1));
  return Array.from(variants);
}

// PostgREST `or` filters treat commas and * as syntax. Strip them before
// building an ilike pattern. * is the wildcard PostgREST expects.
export function postgrestIlikePattern(raw: string): string | null {
  const cleaned = raw.replace(/[%*,().\\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length < 3) return null;
  return `*${cleaned.replace(/ /g, '*')}*`;
}

export async function resolvePlace(query: string, lookup: AirportLookup): Promise<ResolvedPlace | null> {
  const q = query.trim();
  if (q.length < 2 || q.length > 80) return null;
  const variants = codeVariants(q);
  if (variants.length > 0) {
    const rows = await lookup.byCodes(variants);
    const best = pickBestForCode(rows, q.toUpperCase()) || pickBestForCode(rows, variants.find((v) => v !== q.toUpperCase()) || q.toUpperCase());
    if (best) return toPlace(q, best, [best]);
  }
  const pattern = postgrestIlikePattern(q);
  if (!pattern) return null;
  const rows = await lookup.byText(q);
  const best = pickBestForText(rows, q);
  if (!best) return null;
  return toPlace(q, best, rows);
}

const AIRPORT_COLUMNS = 'icao, gps_code, iata, local_code, name, lat, lng, type, scheduled_service, city, iso_region';

export function createSupabaseAirportLookup(supabase: SupabaseClient): AirportLookup {
  return {
    async byCodes(codes: string[]) {
      const list = codes.filter((code) => CODE_RE.test(code)).join(',');
      if (!list) return [];
      const { data, error } = await supabase
        .from('airports')
        .select(AIRPORT_COLUMNS)
        .or(`icao.in.(${list}),gps_code.in.(${list}),iata.in.(${list}),local_code.in.(${list})`);
      if (error) throw new Error(error.message);
      return (data || []) as AirportRow[];
    },
    async byText(text: string) {
      const pattern = postgrestIlikePattern(text);
      if (!pattern) return [];
      const { data, error } = await supabase
        .from('airports')
        .select(AIRPORT_COLUMNS)
        .or(`city.ilike.${pattern},name.ilike.${pattern}`)
        .limit(25);
      if (error) throw new Error(error.message);
      return (data || []) as AirportRow[];
    },
  };
}

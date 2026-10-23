// Server-only helpers that build the directory's public listing set, plus the
// state / airport landing pages derived from it. Everything here comes from
// real rows: listed_in_directory + active + slug + a non-blank business name.
// Nothing is invented — a page only exists if at least one real listing backs it.
import { getSupabase } from '@/lib/supabase';

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://directory.shinyjets.com';
export const CRM_URL = process.env.NEXT_PUBLIC_CRM_URL || 'https://crm.shinyjets.com';

export const US_STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
  WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
};

/** True when a value is a real, displayable string (not blank, not "null"/"undefined"). */
export function realText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || /^(null|undefined)$/i.test(t)) return null;
  return t;
}

export interface ResolvedAirport {
  code: string; // canonical code shown to users (ICAO/GPS ident when present)
  name: string | null;
  city: string | null;
  stateCode: string | null; // US state 2-letter code, only for US airports
  country: string | null; // ISO 3166-1 alpha-2 from the airports row (iso_region prefix / country)
  countryName: string | null; // English display name for `country`, e.g. "Canada"
  isUS: boolean; // true only for airports in the 50 states + DC (iso_region US-xx)
}

export interface Listing {
  slug: string;
  company: string;
  homeAirportRaw: string | null;
  airport: ResolvedAirport | null;
}

export interface AirportPage {
  slug: string; // lowercase code
  airport: ResolvedAirport;
  listings: Listing[];
}

export interface CountryPage {
  slug: string; // e.g. "canada"
  countryCode: string;
  countryName: string;
  listings: Listing[];
}

export interface StatePage {
  slug: string; // e.g. "california"
  stateCode: string;
  stateName: string;
  listings: Listing[];
  airports: AirportPage[];
}

type AirportRow = {
  icao: string | null; gps_code: string | null; iata: string | null; local_code: string | null;
  name: string | null; type: string | null; scheduled_service: boolean | null;
  city: string | null; iso_region: string | null; country: string | null;
};

type DetailerRow = { slug: string | null; company: string | null; home_airport: string | null; country?: string | null };

const REGION_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });

/** English name for an ISO country code, straight from the runtime's CLDR data. */
export function countryName(cc: string | null | undefined): string | null {
  const c = realText(cc)?.toUpperCase();
  if (!c || !/^[A-Z]{2}$/.test(c)) return null;
  try {
    const n = REGION_NAMES.of(c);
    return n && n !== c ? n : null;
  } catch {
    return null;
  }
}

/**
 * ICAO location-indicator prefixes used by US airports (contiguous US = K,
 * Alaska = PA/PF/PO/PP, Hawaii = PH). Used only as a sanity check against the
 * airports row's iso_region; the row itself decides the country.
 */
export function icaoLooksUS(code: string): boolean {
  if (!/^[A-Z]{4}$/.test(code)) return true; // FAA/local idents (e.g. 0B5) carry no prefix
  return code.startsWith('K') || /^P[AFHOP]/.test(code);
}

export function countrySlug(name: string): string {
  return stateSlug(name.replace(/\./g, ''));
}

export function stateSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Same code-matching priority as /api/detailers (icao > gps_code > iata > local_code,
// then scheduled service, then airport size) so pages agree with the globe.
export function resolveAirports(codes: string[], rows: AirportRow[]): Record<string, ResolvedAirport> {
  const wanted = new Set(codes);
  const typeRank = (t: string | null) =>
    t === 'large_airport' ? 0 : t === 'medium_airport' ? 1 : t === 'small_airport' ? 2 : 3;
  const best: Record<string, { rank: number; sched: boolean; type: number; row: AirportRow }> = {};
  const consider = (code: string, rank: number, a: AirportRow) => {
    if (!wanted.has(code)) return;
    const cand = { rank, sched: a.scheduled_service === true, type: typeRank(a.type), row: a };
    const cur = best[code];
    if (!cur || cand.rank < cur.rank || (cand.rank === cur.rank && cand.sched && !cur.sched) ||
      (cand.rank === cur.rank && cand.sched === cur.sched && cand.type < cur.type)) best[code] = cand;
  };
  for (const a of rows) {
    if (a.icao) consider(a.icao.toUpperCase(), 1, a);
    if (a.gps_code) consider(a.gps_code.toUpperCase(), 2, a);
    if (a.iata) consider(a.iata.toUpperCase(), 3, a);
    if (a.local_code) consider(a.local_code.toUpperCase(), 4, a);
  }
  const out: Record<string, ResolvedAirport> = {};
  for (const [code, { row }] of Object.entries(best)) {
    const iso = row.iso_region || '';
    const [cc, sub] = iso.split('-');
    const country = (realText(row.country) || realText(cc) || '').toUpperCase() || null;
    const isUS = country === 'US' && cc === 'US' && !!sub && !!US_STATE_NAMES[sub];
    out[code] = {
      code: (realText(row.icao) || realText(row.gps_code) || code).toUpperCase(),
      name: realText(row.name),
      city: realText(row.city),
      stateCode: isUS ? sub : null,
      country,
      countryName: countryName(country),
      isUS,
    };
  }
  return out;
}

export function buildListings(detailers: DetailerRow[], airportRows: AirportRow[]): Listing[] {
  const codes = Array.from(new Set(detailers
    .map((d) => (d.home_airport || '').trim().toUpperCase())
    .filter((c) => /^[A-Z0-9-]{2,7}$/.test(c))));
  const resolved = resolveAirports(codes, airportRows);
  const out: Listing[] = [];
  for (const d of detailers) {
    const company = realText(d.company);
    const slug = realText(d.slug);
    if (!company || !slug) continue; // blank business name => not a public listing
    const raw = realText(d.home_airport)?.toUpperCase() || null;
    out.push({ slug, company, homeAirportRaw: raw, airport: raw ? resolved[raw] || null : null });
  }
  return out.sort((a, b) => a.company.localeCompare(b.company));
}

export function buildAirportPages(listings: Listing[]): AirportPage[] {
  const map = new Map<string, AirportPage>();
  for (const l of listings) {
    // US-only: non-US airports are grouped on /country/<name> pages instead.
    if (!l.airport || !l.airport.name || !l.airport.isUS) continue;
    const slug = l.airport.code.toLowerCase();
    if (!/^[a-z0-9-]{2,7}$/.test(slug)) continue;
    if (!map.has(slug)) map.set(slug, { slug, airport: l.airport, listings: [] });
    map.get(slug)!.listings.push(l);
  }
  return Array.from(map.values()).sort((a, b) => a.slug.localeCompare(b.slug));
}

export function buildStatePages(listings: Listing[], airports: AirportPage[]): StatePage[] {
  const map = new Map<string, StatePage>();
  for (const l of listings) {
    const sc = l.airport?.isUS ? l.airport.stateCode : null;
    if (!sc) continue;
    const stateName = US_STATE_NAMES[sc];
    const slug = stateSlug(stateName);
    if (!map.has(slug)) map.set(slug, { slug, stateCode: sc, stateName, listings: [], airports: [] });
    map.get(slug)!.listings.push(l);
  }
  for (const a of airports) {
    const sc = a.airport.isUS ? a.airport.stateCode : null;
    if (sc) map.get(stateSlug(US_STATE_NAMES[sc]))?.airports.push(a);
  }
  return Array.from(map.values()).sort((a, b) => a.slug.localeCompare(b.slug));
}

/** One page per non-US country that has at least one real listing. */
export function buildCountryPages(listings: Listing[]): CountryPage[] {
  const map = new Map<string, CountryPage>();
  for (const l of listings) {
    const a = l.airport;
    if (!a || a.isUS || !a.country || !a.countryName) continue;
    const slug = countrySlug(a.countryName);
    if (!slug) continue;
    if (!map.has(slug)) map.set(slug, { slug, countryCode: a.country, countryName: a.countryName, listings: [] });
    map.get(slug)!.listings.push(l);
  }
  return Array.from(map.values()).filter((c) => c.listings.length > 0).sort((a, b) => a.slug.localeCompare(b.slug));
}

export interface AmbiguousListing {
  slug: string;
  company: string;
  code: string;
  resolvedTo: string | null;
  reasons: string[];
}

/**
 * Report-only: listings whose stored home_airport code looks ambiguous. Never
 * changes data or what the site shows; used by `npm run check:listings`.
 */
export function ambiguousListings(detailers: DetailerRow[], airportRows: AirportRow[]): AmbiguousListing[] {
  const listings = buildListings(detailers, airportRows);
  const bySlug = new Map(detailers.map((d) => [realText(d.slug), d]));
  const out: AmbiguousListing[] = [];
  for (const l of listings) {
    const code = l.homeAirportRaw;
    if (!code) continue;
    const reasons: string[] = [];
    const matches = airportRows.filter((r) =>
      [r.icao, r.gps_code, r.iata, r.local_code].some((c) => (c || '').toUpperCase() === code));
    const countries = Array.from(new Set(matches.map((r) => (r.iso_region || '').split('-')[0]).filter(Boolean)));
    if (!l.airport) reasons.push('code does not match any airport');
    if (countries.length > 1) reasons.push(`code matches airports in ${countries.length} countries (${countries.join(', ')})`);
    const isIcao = !!matches.find((r) => (r.icao || '').toUpperCase() === code || (r.gps_code || '').toUpperCase() === code);
    if (l.airport && !isIcao) reasons.push(`stored as a ${code.length}-character non-ICAO code; resolved to ${l.airport.code}`);
    const listedCountry = realText(bySlug.get(l.slug)?.country)?.toUpperCase();
    if (l.airport?.country && listedCountry && listedCountry !== l.airport.country) {
      reasons.push(`profile country ${listedCountry} differs from airport country ${l.airport.country}`);
    }
    if (l.airport && l.airport.isUS !== icaoLooksUS(l.airport.code)) reasons.push('ICAO prefix disagrees with airport country');
    // Only report codes that are actually unclear: a non-ICAO code alone is fine
    // unless it is paired with a cross-country or profile-country conflict.
    const serious = reasons.filter((r) => !r.startsWith('stored as'));
    if (serious.length > 0) out.push({ slug: l.slug, company: l.company, code, resolvedTo: l.airport?.code || null, reasons });
  }
  return out;
}

/** "City, ST" for US airports, "City, Country" elsewhere (only real values). */
export function airportPlaceLabel(a: ResolvedAirport | null | undefined): string | null {
  if (!a) return null;
  const parts = a.isUS ? [a.city, a.stateCode] : [a.city, a.countryName || a.country];
  const label = parts.filter(Boolean).join(', ');
  return label || null;
}

/** Path of the landing page a listing's home airport belongs to, if any. */
export function countryPath(a: ResolvedAirport | null | undefined): string | null {
  if (!a || a.isUS || !a.countryName) return null;
  const slug = countrySlug(a.countryName);
  return slug ? `/country/${slug}` : null;
}

async function loadRows(): Promise<{ detailers: DetailerRow[]; airports: AirportRow[] }> {
  const supabase = getSupabase();
  if (!supabase) {
    // Local-only fallback so the pages can be exercised without DB creds.
    const fixture = process.env.DIRECTORY_FIXTURE_FILE;
    if (fixture && (process.env.NODE_ENV !== 'production' || process.env.DIRECTORY_ALLOW_FIXTURE === '1')) {
      const fs = await import('fs');
      const j = JSON.parse(fs.readFileSync(fixture!, 'utf8'));
      return { detailers: j.detailers || [], airports: j.airports || [] };
    }
    return { detailers: [], airports: [] };
  }
  const { data, error } = await supabase
    .from('detailers')
    .select('slug, company, home_airport, country')
    .eq('listed_in_directory', true)
    .eq('status', 'active')
    .not('slug', 'is', null)
    .range(0, 999);
  if (error) {
    console.error('[directory/listings] detailers fetch error:', error.message);
    return { detailers: [], airports: [] };
  }
  const detailers = (data || []) as DetailerRow[];
  const codes = Array.from(new Set(detailers
    .map((d) => (d.home_airport || '').trim().toUpperCase())
    .filter((c) => /^[A-Z0-9-]{2,7}$/.test(c))));
  if (codes.length === 0) return { detailers, airports: [] };
  const list = codes.join(',');
  const { data: aRows, error: aErr } = await supabase
    .from('airports')
    .select('icao, gps_code, iata, local_code, name, type, scheduled_service, city, iso_region, country')
    .or(`icao.in.(${list}),gps_code.in.(${list}),iata.in.(${list}),local_code.in.(${list})`);
  if (aErr) console.error('[directory/listings] airports fetch error:', aErr.message);
  return { detailers, airports: (aRows || []) as AirportRow[] };
}

export interface DirectoryData {
  listings: Listing[];
  airportPages: AirportPage[];
  statePages: StatePage[];
  countryPages: CountryPage[];
}

export async function loadDirectoryRows() {
  return loadRows();
}

export async function getDirectoryData(): Promise<DirectoryData> {
  const { detailers, airports } = await loadRows();
  const listings = buildListings(detailers, airports);
  const airportPages = buildAirportPages(listings);
  const statePages = buildStatePages(listings, airportPages);
  const countryPages = buildCountryPages(listings);
  return { listings, airportPages, statePages, countryPages };
}

/** Look up one airport code (as stored on a detailer) for profile pages. */
export async function lookupAirport(raw: string | null | undefined): Promise<ResolvedAirport | null> {
  const code = realText(raw)?.toUpperCase();
  if (!code || !/^[A-Z0-9-]{2,7}$/.test(code)) return null;
  const supabase = getSupabase();
  let rows: AirportRow[] = [];
  if (supabase) {
    const { data } = await supabase
      .from('airports')
      .select('icao, gps_code, iata, local_code, name, type, scheduled_service, city, iso_region, country')
      .or(`icao.eq.${code},gps_code.eq.${code},iata.eq.${code},local_code.eq.${code}`);
    rows = (data || []) as AirportRow[];
  } else {
    rows = (await loadRows()).airports;
  }
  return resolveAirports([code], rows)[code] || null;
}

export const ORG_JSONLD = {
  '@type': 'Organization',
  '@id': 'https://shinyjets.com/#organization',
  name: 'Shiny Jets',
  url: 'https://shinyjets.com',
  logo: `${SITE_URL}/logos/shiny-jets-dark.png`,
};

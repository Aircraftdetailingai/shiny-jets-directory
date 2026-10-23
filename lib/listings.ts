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
  country: string | null;
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

type DetailerRow = { slug: string | null; company: string | null; home_airport: string | null };

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
    const country = realText(row.country) || cc || null;
    const stateCode = cc === 'US' && sub && US_STATE_NAMES[sub] ? sub : null;
    out[code] = {
      code: (realText(row.icao) || realText(row.gps_code) || code).toUpperCase(),
      name: realText(row.name),
      city: realText(row.city),
      stateCode,
      country,
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
    if (!l.airport || !l.airport.name) continue;
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
    const sc = l.airport?.stateCode;
    if (!sc) continue;
    const stateName = US_STATE_NAMES[sc];
    const slug = stateSlug(stateName);
    if (!map.has(slug)) map.set(slug, { slug, stateCode: sc, stateName, listings: [], airports: [] });
    map.get(slug)!.listings.push(l);
  }
  for (const a of airports) {
    const sc = a.airport.stateCode;
    if (sc) map.get(stateSlug(US_STATE_NAMES[sc]))?.airports.push(a);
  }
  return Array.from(map.values()).sort((a, b) => a.slug.localeCompare(b.slug));
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
    .select('slug, company, home_airport')
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
}

export async function getDirectoryData(): Promise<DirectoryData> {
  const { detailers, airports } = await loadRows();
  const listings = buildListings(detailers, airports);
  const airportPages = buildAirportPages(listings);
  const statePages = buildStatePages(listings, airportPages);
  return { listings, airportPages, statePages };
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

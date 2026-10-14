import type { SupabaseClient } from '@supabase/supabase-js';
import { compareDirectoryDetailers } from './sort';
import type { DirectoryDetailer, DirectoryLocation } from './types';

type AirportRow = {
  icao: string | null;
  gps_code: string | null;
  iata: string | null;
  local_code: string | null;
  lat: number | string | null;
  lng: number | string | null;
  type: string | null;
  scheduled_service: boolean | null;
  city: string | null;
  iso_region: string | null;
};

type ResolvedAirport = { lat: number; lng: number; city: string | null; region: string | null };

type DetailerRow = {
  id: string;
  name: string | null;
  company: string | null;
  country: string | null;
  home_airport: string | null;
  airports_served: string[] | null;
  plan: string | null;
  has_online_booking: boolean | null;
  logo_url: string | null;
  theme_logo_url: string | null;
  slug: string | null;
  directory_description: string | null;
  certifications: string[] | null;
  verified_finish: boolean | null;
  insurance_verified: boolean | null;
  operating_hours_per_week: number | null;
  google_rating: number | null;
  google_review_count: number | null;
};

function regionFromIso(iso: string | null): string | null {
  if (!iso) return null;
  const parts = iso.split('-');
  return parts.length > 1 ? parts[parts.length - 1] : iso;
}

// Resolve free-form home_airport codes to lat/lng against the full `airports`
// reference table. Match icao / gps_code / iata / local_code, with a strict
// priority so a well-known IATA code wins over an unrelated local_code.
async function resolveAirportCoords(
  supabase: SupabaseClient,
  rawCodes: string[],
): Promise<Record<string, ResolvedAirport>> {
  const codes = Array.from(
    new Set(
      rawCodes
        .map((c) => (c || '').trim().toUpperCase())
        .filter((c) => /^[A-Z0-9-]{2,7}$/.test(c)),
    ),
  );
  if (codes.length === 0) return {};

  const list = codes.join(',');
  const { data, error } = await supabase
    .from('airports')
    .select('icao, gps_code, iata, local_code, lat, lng, type, scheduled_service, city, iso_region')
    .or(`icao.in.(${list}),gps_code.in.(${list}),iata.in.(${list}),local_code.in.(${list})`);

  if (error) {
    console.error('[directory/api] airport resolve error:', error.message);
    return {};
  }

  const wanted = new Set(codes);
  const typeRank = (t: string | null) =>
    t === 'large_airport' ? 0 : t === 'medium_airport' ? 1 : t === 'small_airport' ? 2 : 3;

  const best: Record<string, { rank: number; sched: boolean; type: number } & ResolvedAirport> = {};
  const consider = (code: string, rank: number, a: AirportRow) => {
    if (!wanted.has(code)) return;
    const lat = Number(a.lat);
    const lng = Number(a.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const cand = {
      rank,
      sched: a.scheduled_service === true,
      type: typeRank(a.type),
      lat,
      lng,
      city: a.city || null,
      region: regionFromIso(a.iso_region),
    };
    const cur = best[code];
    if (
      !cur ||
      cand.rank < cur.rank ||
      (cand.rank === cur.rank && cand.sched && !cur.sched) ||
      (cand.rank === cur.rank && cand.sched === cur.sched && cand.type < cur.type)
    ) {
      best[code] = cand;
    }
  };

  for (const a of (data || []) as AirportRow[]) {
    if (a.icao) consider(a.icao.toUpperCase(), 1, a);
    if (a.gps_code) consider(a.gps_code.toUpperCase(), 2, a);
    if (a.iata) consider(a.iata.toUpperCase(), 3, a);
    if (a.local_code) consider(a.local_code.toUpperCase(), 4, a);
  }

  const out: Record<string, ResolvedAirport> = {};
  for (const [code, v] of Object.entries(best)) out[code] = { lat: v.lat, lng: v.lng, city: v.city, region: v.region };
  return out;
}

// Directory data source shared by /api/detailers and the Muse connector.
// Gate is exact:
//   listed_in_directory = true AND slug IS NOT NULL AND status = 'active'
export async function loadDirectoryDetailers(supabase: SupabaseClient): Promise<DirectoryDetailer[]> {
  const { data: detailers, error } = await supabase
    .from('detailers')
    .select(
      'id, name, company, country, home_airport, airports_served, plan, has_online_booking, logo_url, theme_logo_url, slug, directory_description, certifications, verified_finish, insurance_verified, operating_hours_per_week, google_rating, google_review_count',
    )
    .eq('listed_in_directory', true)
    .eq('status', 'active')
    .not('slug', 'is', null)
    .range(0, 999);

  if (error) {
    console.error('[directory/api] detailers fetch error:', error.message);
    throw new Error('Failed to fetch detailers');
  }

  const rows = (detailers || []) as DetailerRow[];
  const ids = rows.map((d) => d.id);

  const locationsByDetailer: Record<string, DirectoryLocation[]> = {};
  if (ids.length > 0) {
    const { data: locRows, error: locErr } = await supabase
      .from('detailer_locations')
      .select('id, detailer_id, name, location_type, airport_icao, address, latitude, longitude')
      .in('detailer_id', ids)
      .eq('active', true)
      .not('latitude', 'is', null)
      .not('longitude', 'is', null);
    if (locErr) {
      console.error('[directory/api] locations fetch error:', locErr.message);
    } else {
      for (const l of locRows || []) {
        if (!locationsByDetailer[l.detailer_id]) locationsByDetailer[l.detailer_id] = [];
        locationsByDetailer[l.detailer_id].push({
          id: l.id,
          name: l.name || null,
          location_type: l.location_type || null,
          airport_icao: l.airport_icao || null,
          address: l.address || null,
          latitude: Number(l.latitude),
          longitude: Number(l.longitude),
        });
      }
    }
  }

  const servicesByDetailer: Record<string, string[]> = {};
  if (ids.length > 0) {
    const { data: svcRows } = await supabase.from('services').select('detailer_id, name').in('detailer_id', ids);
    for (const s of svcRows || []) {
      if (!servicesByDetailer[s.detailer_id]) servicesByDetailer[s.detailer_id] = [];
      if (s.name) servicesByDetailer[s.detailer_id].push(s.name);
    }
  }

  const statsMap: Record<string, { vTotal: number; vSum: number; gTotal: number; gSum: number }> = {};
  if (ids.length > 0) {
    const [vec, goog] = await Promise.all([
      supabase.from('feedback').select('detailer_id, rating').in('detailer_id', ids).eq('is_public', true),
      supabase.from('google_reviews').select('detailer_id, rating').in('detailer_id', ids),
    ]);
    for (const r of (vec.data || []) as Array<{ detailer_id: string; rating: number }>) {
      if (!statsMap[r.detailer_id]) statsMap[r.detailer_id] = { vTotal: 0, vSum: 0, gTotal: 0, gSum: 0 };
      statsMap[r.detailer_id].vTotal += 1;
      statsMap[r.detailer_id].vSum += r.rating;
    }
    for (const r of (goog.data || []) as Array<{ detailer_id: string; rating: number }>) {
      if (!statsMap[r.detailer_id]) statsMap[r.detailer_id] = { vTotal: 0, vSum: 0, gTotal: 0, gSum: 0 };
      statsMap[r.detailer_id].gTotal += 1;
      statsMap[r.detailer_id].gSum += r.rating;
    }
  }

  const homeCoordsByCode = await resolveAirportCoords(
    supabase,
    rows.map((d) => d.home_airport).filter(Boolean) as string[],
  );

  const enriched: DirectoryDetailer[] = rows.map((d) => {
    const s = statsMap[d.id];
    const homeCoords = d.home_airport ? homeCoordsByCode[d.home_airport.toUpperCase()] : undefined;
    const vAvg = s && s.vTotal > 0 ? parseFloat((s.vSum / s.vTotal).toFixed(1)) : null;
    const gAvg = s && s.gTotal > 0 ? parseFloat((s.gSum / s.gTotal).toFixed(1)) : null;
    const total = (s?.vTotal || 0) + (s?.gTotal || 0);
    const combinedAvg = total > 0 ? parseFloat((((s?.vSum || 0) + (s?.gSum || 0)) / total).toFixed(1)) : null;
    return {
      id: d.id,
      name: d.name,
      company: d.company,
      country: d.country,
      home_airport: d.home_airport,
      airports_served: d.airports_served,
      plan: d.plan,
      has_online_booking: d.has_online_booking,
      logo_url: d.theme_logo_url || d.logo_url || null,
      slug: d.slug,
      directory_description: d.directory_description,
      certifications: d.certifications,
      verified_finish: d.verified_finish,
      insurance_verified: d.insurance_verified,
      operating_hours_per_week: d.operating_hours_per_week,
      google_rating: d.google_rating,
      services: servicesByDetailer[d.id] || [],
      locations: locationsByDetailer[d.id] || [],
      review_count: s?.vTotal || 0,
      avg_rating: vAvg,
      google_review_count: s?.gTotal || 0,
      google_avg_rating: gAvg,
      combined_review_count: total,
      combined_avg_rating: combinedAvg,
      lat: homeCoords?.lat ?? null,
      lng: homeCoords?.lng ?? null,
      city: homeCoords?.city ?? null,
      region: homeCoords?.region ?? null,
    };
  });

  enriched.sort(compareDirectoryDetailers);
  return enriched;
}

import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

// Dynamic (reads Supabase per origin request) but the response carries an
// explicit s-maxage so Vercel's CDN serves repeat loads warm. No force-no-store
// / revalidate:0 here — those would suppress the edge cache we want.
export const dynamic = 'force-dynamic';

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

// iso_region is like "US-CA" / "CA-ON"; the trailing segment is the state/province.
function regionFromIso(iso: string | null): string | null {
  if (!iso) return null;
  const parts = iso.split('-');
  return parts.length > 1 ? parts[parts.length - 1] : iso;
}

// Resolve free-form home_airport codes to lat/lng against the full `airports`
// reference table (OurAirports-derived). The globe previously resolved codes
// against a hardcoded ~170-airport table and silently dropped anyone whose
// airport wasn't in it. Here we match a code against icao / gps_code / iata /
// local_code, with a strict priority so a well-known IATA code (STT, SIG, YHM)
// wins over an unrelated foreign airport that happens to share a local_code.
async function resolveAirportCoords(
  supabase: SupabaseClient,
  rawCodes: string[],
): Promise<Record<string, ResolvedAirport>> {
  // Airport codes are alphanumeric (+ occasional hyphen); filter anything else
  // out before it reaches the PostgREST in-filter.
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

  // For each requested code, keep the best-ranked matching airport.
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

// Directory data source. Queries the same `detailers` table the CRM reads
// from, but here so the globe never depends on the CRM API surface being
// available, gated correctly, or non-truncated. Gate is exact:
//   listed_in_directory = true AND slug IS NOT NULL AND status = 'active'
// Locations are LEFT-merged in a second query so detailers with zero active
// service locations still appear in the response (the globe falls back to
// home_airport coords, the card falls back to a textual service area).
export async function GET() {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

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
    return NextResponse.json({ error: 'Failed to fetch detailers' }, { status: 500 });
  }

  const ids = (detailers || []).map((d) => d.id);

  // LEFT-merge: detailers with zero matching locations still appear in the
  // response with locations: [].
  const locationsByDetailer: Record<string, Array<{ id: string; name: string | null; location_type: string | null; airport_icao: string | null; address: string | null; latitude: number; longitude: number }>> = {};
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

  // Bulk-fetch published services for chip rendering on the card.
  const servicesByDetailer: Record<string, string[]> = {};
  if (ids.length > 0) {
    const { data: svcRows } = await supabase
      .from('services')
      .select('detailer_id, name')
      .in('detailer_id', ids);
    for (const s of svcRows || []) {
      if (!servicesByDetailer[s.detailer_id]) servicesByDetailer[s.detailer_id] = [];
      if (s.name) servicesByDetailer[s.detailer_id].push(s.name);
    }
  }

  // Combined review stats (platform feedback + Google reviews) so the card
  // can render a single rating + count without two queries on every render.
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

  // Resolve each detailer's home_airport to lat/lng for the globe, so it no
  // longer depends on the hardcoded client-side airport table.
  const homeCoordsByCode = await resolveAirportCoords(
    supabase,
    (detailers || []).map((d) => d.home_airport).filter(Boolean) as string[],
  );

  const enriched = (detailers || []).map((d) => {
    const s = statsMap[d.id];
    const homeCoords = d.home_airport ? homeCoordsByCode[d.home_airport.toUpperCase()] : undefined;
    const vAvg = s && s.vTotal > 0 ? parseFloat((s.vSum / s.vTotal).toFixed(1)) : null;
    const gAvg = s && s.gTotal > 0 ? parseFloat((s.gSum / s.gTotal).toFixed(1)) : null;
    const total = (s?.vTotal || 0) + (s?.gTotal || 0);
    const combinedAvg = total > 0 ? parseFloat((((s?.vSum || 0) + (s?.gSum || 0)) / total).toFixed(1)) : null;
    return {
      ...d,
      logo_url: d.theme_logo_url || d.logo_url || null,
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
      theme_logo_url: undefined,
    };
  });

  // Tier ranking: detailers who operate more hours per week first, then by
  // Google rating, then by Google review count. NULLs go last so unpopulated
  // rows never beat populated ones on a tie.
  const cmpDescNullsLast = (a: number | null | undefined, b: number | null | undefined) => {
    const aN = a == null ? null : Number(a);
    const bN = b == null ? null : Number(b);
    if (aN == null && bN == null) return 0;
    if (aN == null) return 1;
    if (bN == null) return -1;
    return bN - aN;
  };
  enriched.sort((a, b) => {
    const byOps = cmpDescNullsLast(a.operating_hours_per_week as number | null, b.operating_hours_per_week as number | null);
    if (byOps !== 0) return byOps;
    const byG = cmpDescNullsLast(a.google_rating as number | null, b.google_rating as number | null);
    if (byG !== 0) return byG;
    const byGC = cmpDescNullsLast(a.google_review_count as number | null, b.google_review_count as number | null);
    if (byGC !== 0) return byGC;
    return (a.company || '').localeCompare(b.company || '');
  });

  return NextResponse.json(
    { detailers: enriched },
    {
      headers: {
        // Directory data changes rarely; let Vercel's CDN serve it warm and
        // revalidate in the background so repeat loads are fast (<200ms).
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
        'Access-Control-Allow-Origin': '*',
      },
    },
  );
}

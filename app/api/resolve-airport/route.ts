import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type Row = {
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
};

// Resolve a single airport code to coordinates + city/region, matching
// icao / gps_code / iata / local_code with the same strict priority the
// directory listing uses. Backs the search "nearest detailer" fallback: when
// no detailer sits at the searched airport, the page still needs the airport's
// own coordinates to compute the nearest one.
export async function GET(request: Request) {
  const code = (new URL(request.url).searchParams.get('code') || '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{2,7}$/.test(code)) {
    return NextResponse.json({ error: 'Invalid code' }, { status: 400 });
  }

  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

  const { data, error } = await supabase
    .from('airports')
    .select('icao, gps_code, iata, local_code, name, lat, lng, type, scheduled_service, city, iso_region')
    .or(`icao.eq.${code},gps_code.eq.${code},iata.eq.${code},local_code.eq.${code}`);

  if (error) {
    console.error('[resolve-airport] query error:', error.message);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }

  const rows = (data || []) as Row[];
  const rank = (a: Row) => {
    if (a.icao?.toUpperCase() === code) return 1;
    if (a.gps_code?.toUpperCase() === code) return 2;
    if (a.iata?.toUpperCase() === code) return 3;
    if (a.local_code?.toUpperCase() === code) return 4;
    return 5;
  };
  const typeRank = (t: string | null) =>
    t === 'large_airport' ? 0 : t === 'medium_airport' ? 1 : t === 'small_airport' ? 2 : 3;

  const best = rows
    .filter((a) => Number.isFinite(Number(a.lat)) && Number.isFinite(Number(a.lng)))
    .sort((a, b) => rank(a) - rank(b) || Number(b.scheduled_service === true) - Number(a.scheduled_service === true) || typeRank(a.type) - typeRank(b.type))[0];

  if (!best) return NextResponse.json({ error: 'Airport not found' }, { status: 404 });

  const region = best.iso_region ? best.iso_region.split('-').pop() || null : null;
  return NextResponse.json(
    {
      code,
      lat: Number(best.lat),
      lng: Number(best.lng),
      name: best.name || null,
      city: best.city || null,
      region,
    },
    { headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800' } },
  );
}

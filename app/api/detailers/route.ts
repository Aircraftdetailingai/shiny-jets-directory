import { NextResponse } from 'next/server';
import { loadDirectoryDetailers } from '@/lib/directory/load';
import { getSupabase } from '@/lib/supabase';

// Dynamic (reads Supabase per origin request) but the response carries an
// explicit s-maxage so Vercel's CDN serves repeat loads warm. No force-no-store
// / revalidate:0 here — those would suppress the edge cache we want.
export const dynamic = 'force-dynamic';

// Directory data source. Queries the same `detailers` table the CRM reads
// from, but here so the globe never depends on the CRM API surface being
// available, gated correctly, or non-truncated. Gate is exact:
//   listed_in_directory = true AND slug IS NOT NULL AND status = 'active'
// The Muse connector at /mcp reads this same loader.
export async function GET() {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  try {
    const detailers = await loadDirectoryDetailers(supabase);
    return NextResponse.json(
      { detailers },
      {
        headers: {
          // Directory data changes rarely; let Vercel's CDN serve it warm and
          // revalidate in the background so repeat loads are fast (<200ms).
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  } catch (err) {
    console.error('[directory/api] detailers fetch error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to fetch detailers' }, { status: 500 });
  }
}

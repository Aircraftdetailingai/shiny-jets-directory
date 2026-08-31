'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import type { GlobeFocus } from '@/components/Globe';
import { Detailer, detailerSlug, detailerPlace, detailerCoords, distanceMiles } from '@/lib/detailer';

const Globe = dynamic(() => import('@/components/Globe'), { ssr: false });

const CRM_URL = process.env.NEXT_PUBLIC_CRM_URL || 'https://crm.shinyjets.com';
const DIRECTORY_API = '/api/detailers';

type SearchInfo = { matches: Detailer[]; message: string | null } | null;

// Match a searched code against a detailer's home_airport, tolerating the
// K-prefix convention (KHII vs HII, YHM vs KYHM).
function airportMatches(homeAirport: string, code: string): boolean {
  const ha = (homeAirport || '').toUpperCase();
  if (!ha) return false;
  return ha === code || ha === `K${code}` || (code.startsWith('K') && ha === code.slice(1));
}

function DetailerRow({ d, onFocus }: { d: Detailer; onFocus?: (d: Detailer) => void }) {
  const slug = detailerSlug(d);
  const place = detailerPlace(d);
  return (
    <div className="px-3 py-2.5 rounded-lg hover:bg-white/[0.04] transition-colors border border-transparent hover:border-white/10">
      <button
        type="button"
        onClick={() => onFocus?.(d)}
        className="block w-full text-left"
        disabled={!onFocus || !detailerCoords(d)}
      >
        <p className="text-white text-sm font-medium truncate">{d.company || d.name}</p>
        <p className="text-white/40 text-xs truncate">
          {d.home_airport ? d.home_airport : 'No home airport'}
          {place ? ` · ${place}` : ''}
        </p>
      </button>
      <div className="flex gap-2 mt-2">
        <a href={`/detailer/${slug}`} className="flex-1 text-center text-[11px] font-medium text-white/80 bg-white/[0.06] border border-white/10 rounded-md py-1.5 hover:bg-white/10 transition-colors">
          View Profile
        </a>
        <a href={`${CRM_URL}/request/${slug}`} target="_blank" rel="noreferrer" className="flex-1 text-center text-[11px] font-medium text-white bg-blue-500 rounded-md py-1.5 hover:bg-blue-600 transition-colors">
          Request Quote
        </a>
      </div>
    </div>
  );
}

export default function DirectoryPage() {
  const [detailers, setDetailers] = useState<Detailer[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [globeReady, setGlobeReady] = useState(false);
  const [search, setSearch] = useState('');
  const [focus, setFocus] = useState<GlobeFocus | null>(null);
  const [searchInfo, setSearchInfo] = useState<SearchInfo>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [showCTA, setShowCTA] = useState(true);

  // Preload the globe chunk so it's ready as soon as data lands.
  useEffect(() => {
    import('@/components/Globe');
    // Default the All-detailers panel open on mobile (map-only is unusable
    // there and hides the no-home-airport detailers).
    if (typeof window !== 'undefined' && window.innerWidth < 768) setPanelOpen(true);
  }, []);

  useEffect(() => {
    fetch(DIRECTORY_API)
      .then((r) => (r.ok ? r.json() : { detailers: [] }))
      .then((d) => {
        const normalized: Detailer[] = (d.detailers || d || []).map((x: any) => ({
          ...x,
          logo_url: x.logo_url || undefined,
          directory_description: x.directory_description || undefined,
          home_airport: x.home_airport || '',
        }));
        setDetailers(normalized);
      })
      .catch(() => {})
      .finally(() => setDataLoading(false));
  }, []);

  const onGlobeReady = useCallback(() => setGlobeReady(true), []);

  const handleSearch = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const code = search.trim().toUpperCase();
      if (code.length < 2) return;

      const matches = detailers.filter((d) => airportMatches(d.home_airport, code));
      if (matches.length > 0) {
        const withCoords = matches.find((m) => detailerCoords(m));
        const c = withCoords ? detailerCoords(withCoords) : null;
        if (c) setFocus({ lat: c[0], lng: c[1], code: (matches[0].home_airport || code).toUpperCase() });
        setSearchInfo({ matches, message: null });
        return;
      }

      // No detailer at this airport — resolve its coords to fly there and name
      // the nearest detailer.
      try {
        const res = await fetch(`/api/resolve-airport?code=${encodeURIComponent(code)}`);
        if (res.ok) {
          const ap = await res.json();
          setFocus({ lat: ap.lat, lng: ap.lng, code });
          let message = `No detailers at ${code}.`;
          const withCoords = detailers.filter((d) => detailerCoords(d));
          if (withCoords.length > 0) {
            let best: Detailer | null = null;
            let bestMi = Infinity;
            for (const d of withCoords) {
              const dc = detailerCoords(d)!;
              const mi = distanceMiles(ap.lat, ap.lng, dc[0], dc[1]);
              if (mi < bestMi) { bestMi = mi; best = d; }
            }
            if (best) message = `No detailers at ${code} — nearest: ${best.company || best.name} at ${best.home_airport} (${Math.round(bestMi)} mi)`;
            setSearchInfo({ matches: best ? [best] : [], message });
          } else {
            setSearchInfo({ matches: [], message });
          }
        } else {
          setSearchInfo({ matches: [], message: `Airport "${code}" not found.` });
        }
      } catch {
        setSearchInfo({ matches: [], message: `Couldn't look up "${code}".` });
      }
    },
    [search, detailers],
  );

  const focusDetailer = useCallback((d: Detailer) => {
    const c = detailerCoords(d);
    if (c) setFocus({ lat: c[0], lng: c[1], code: (d.home_airport || '').toUpperCase() });
  }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = q
      ? detailers.filter(
          (d) =>
            (d.company || '').toLowerCase().includes(q) ||
            (d.name || '').toLowerCase().includes(q) ||
            (d.home_airport || '').toLowerCase().includes(q) ||
            (detailerPlace(d) || '').toLowerCase().includes(q),
        )
      : detailers;
    return list;
  }, [detailers, filter]);

  const loading = dataLoading || !globeReady;

  return (
    <div className="h-screen bg-[#0a0e1a] overflow-hidden">
      {/* Header band */}
      <div className="absolute top-0 left-0 right-0 z-40 bg-[#0a0e1a] border-b border-white/5" style={{ height: '220px' }}>
        <div className="flex items-center justify-between px-6 py-3">
          <a href="https://shinyjets.com" className="flex items-center">
            <img src="/logos/shiny-jets-dark.png" alt="Shiny Jets" className="h-8 object-contain" />
          </a>
          <a href={`${CRM_URL}/signup`} className="px-4 py-2 text-xs font-medium text-white/70 border border-white/10 rounded-lg hover:bg-white/5 transition-colors">
            List Your Business
          </a>
        </div>
        <div className="text-center px-6 pt-3">
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-light text-white tracking-tight mb-2">Find an Aircraft Detailer</h1>
          <p className="text-white/50 text-xs sm:text-sm mb-3 max-w-lg mx-auto">Browse the Shiny Jets network of professional aircraft detailers worldwide</p>
          <form onSubmit={handleSearch} className="max-w-md mx-auto flex gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by airport code (KTEB, KLAS...)"
              className="flex-1 px-4 py-2.5 rounded-lg bg-white/[0.06] border border-white/10 text-white text-sm placeholder-white/30 outline-none focus:border-blue-500/50 transition-colors"
            />
            <button type="submit" className="px-5 py-2.5 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition-colors">Search</button>
          </form>
        </div>
      </div>

      {/* Globe area */}
      <div className="absolute left-0 right-0 bottom-0" style={{ top: '220px' }}>
        {!dataLoading && <Globe detailers={detailers} focus={focus} onReady={onGlobeReady} />}

        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-20 bg-[#0a0e1a]/60">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-white/50 text-sm">Loading detailers…</p>
          </div>
        )}

        {/* Search results panel (beside the globe) */}
        {searchInfo && (
          <div className="absolute top-4 left-4 z-30 w-[300px] max-w-[calc(100%-2rem)]">
            <div className="bg-[#0f1623]/95 backdrop-blur-md border border-white/10 rounded-xl shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10">
                <span className="text-white text-xs font-semibold uppercase tracking-wider">
                  {searchInfo.matches.length > 0 && !searchInfo.message
                    ? `${searchInfo.matches.length} result${searchInfo.matches.length !== 1 ? 's' : ''}`
                    : 'Search'}
                </span>
                <button onClick={() => setSearchInfo(null)} className="text-white/40 hover:text-white text-lg leading-none" aria-label="Close">&times;</button>
              </div>
              {searchInfo.message && (
                <p className="px-4 py-3 text-white/70 text-xs leading-relaxed">{searchInfo.message}</p>
              )}
              <div className="max-h-[46vh] overflow-y-auto p-2">
                {searchInfo.matches.map((d) => (
                  <DetailerRow key={d.id} d={d} onFocus={focusDetailer} />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* All-detailers panel toggle */}
        {!loading && (
          <button
            onClick={() => setPanelOpen((v) => !v)}
            className="absolute top-4 right-4 z-30 px-3 py-2 rounded-lg bg-[#0f1623]/90 backdrop-blur-md border border-white/10 text-white/80 text-xs font-medium hover:bg-white/10 transition-colors"
          >
            {panelOpen ? 'Hide list' : `All detailers (${detailers.length})`}
          </button>
        )}

        {/* All-detailers panel */}
        {panelOpen && (
          <div className="absolute top-16 right-4 bottom-4 z-30 w-[320px] max-w-[calc(100%-2rem)] flex flex-col bg-[#0f1623]/95 backdrop-blur-md border border-white/10 rounded-xl shadow-2xl overflow-hidden">
            <div className="p-3 border-b border-white/10">
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter by name or airport"
                className="w-full px-3 py-2 rounded-lg bg-white/[0.06] border border-white/10 text-white text-xs placeholder-white/30 outline-none focus:border-blue-500/50"
              />
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {filtered.length === 0 ? (
                <p className="text-white/40 text-xs text-center py-6">No matches</p>
              ) : (
                filtered.map((d) => <DetailerRow key={d.id} d={d} onFocus={focusDetailer} />)
              )}
            </div>
          </div>
        )}

        {/* Detailer count */}
        {!loading && (
          <div className="absolute bottom-4 left-6 z-10">
            <p className="text-white/20 text-xs">{detailers.length} detailer{detailers.length !== 1 ? 's' : ''} worldwide</p>
          </div>
        )}

        {/* Aircraft Owner CTA */}
        {!loading && showCTA && (
          <div className="absolute bottom-14 left-6 z-10 max-w-xs">
            <div className="relative">
              <a href={`${CRM_URL}/portal/login?ref=directory`} className="block group bg-gradient-to-br from-blue-500/15 to-blue-600/10 hover:from-blue-500/25 hover:to-blue-600/15 backdrop-blur-md border border-blue-400/30 hover:border-blue-400/50 rounded-xl px-5 py-3 pr-9 text-left transition-all">
                <p className="text-white text-sm font-semibold mb-0.5 flex items-center gap-1.5">
                  <span>Track Your Aircraft</span>
                  <span className="text-blue-300 text-xs bg-blue-500/20 px-1.5 py-0.5 rounded">FREE</span>
                </p>
                <p className="text-white/60 text-xs leading-relaxed mb-1.5">Log services, download history, share with mechanics</p>
                <p className="text-blue-300 text-xs group-hover:text-blue-200 transition-colors">Create Free Aircraft Profile &rarr;</p>
              </a>
              <button type="button" onClick={() => setShowCTA(false)} aria-label="Dismiss" className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-colors text-base leading-none">&times;</button>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="relative z-10 text-center py-3 border-t border-white/5 flex-shrink-0">
        <p className="text-white/20 text-xs">
          <a href="https://shinyjets.com" className="hover:text-white/40 transition-colors">Shiny Jets</a>
          {' '}&middot; The Professional Aircraft Detailing Platform
        </p>
      </footer>
    </div>
  );
}

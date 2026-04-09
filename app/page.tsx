'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';

const Globe = dynamic(() => import('@/components/Globe'), { ssr: false });

const CRM_URL = process.env.NEXT_PUBLIC_CRM_URL || 'https://crm.shinyjets.com';

interface Detailer {
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
}

export default function DirectoryPage() {
  const [detailers, setDetailers] = useState<Detailer[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Detailer | null>(null);
  const [search, setSearch] = useState('');
  const [focusAirport, setFocusAirport] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${CRM_URL}/api/detailers/directory`)
      .then(r => r.ok ? r.json() : { detailers: [] })
      .then(d => setDetailers(d.detailers || d || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = search.trim().toUpperCase();
    if (q.length >= 3) {
      if (/^K?[A-Z]{3,4}$/.test(q)) {
        setFocusAirport(q.startsWith('K') ? q : `K${q}`);
      } else {
        setFocusAirport(q);
      }
    }
  };

  const handlePinClick = (d: Detailer) => {
    setSelected(d);
  };

  const slug = selected?.slug || selected?.company?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || selected?.id;

  return (
    <div className="h-screen bg-[#0a0e1a] flex flex-col overflow-hidden">
      {/* Header */}
      <header className="relative z-20 flex items-center justify-between px-6 py-3 flex-shrink-0">
        <a href="https://shinyjets.com" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold">SJ</div>
          <span className="text-white font-semibold text-lg tracking-tight hidden sm:block">Shiny Jets</span>
        </a>
        <a href={`${CRM_URL}/signup`} className="px-4 py-2 text-xs font-medium text-white/70 border border-white/10 rounded-lg hover:bg-white/5 transition-colors">
          List Your Business
        </a>
      </header>

      {/* Main content area — globe fills most of viewport */}
      <div className="relative flex-1 min-h-0">
        {/* Headline + Search — overlaid on top of globe */}
        <div className="absolute top-0 left-0 right-0 z-10 text-center px-6 pt-4 pb-2 pointer-events-none">
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-light text-white tracking-tight mb-3">
            Find an Aircraft Detailer
          </h1>
          <p className="text-white/40 text-sm sm:text-base mb-6 max-w-lg mx-auto">
            Browse the Shiny Jets network of professional aircraft detailers worldwide
          </p>
          <form onSubmit={handleSearch} className="max-w-md mx-auto flex gap-2 pointer-events-auto">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by airport code (KTEB, KLAS...)"
              className="flex-1 px-4 py-3 rounded-lg bg-white/[0.06] border border-white/10 text-white text-sm placeholder-white/30 outline-none focus:border-blue-500/50 transition-colors backdrop-blur-sm"
            />
            <button type="submit" className="px-5 py-3 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition-colors">
              Search
            </button>
          </form>
        </div>

        {/* Globe — fills entire remaining area, positioned to show bottom 70% */}
        <div className="absolute inset-0" style={{ top: '15%' }}>
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <Globe detailers={detailers} onPinClick={handlePinClick} focusAirport={focusAirport} />
          )}
        </div>

        {/* Detailer count */}
        {!loading && (
          <div className="absolute bottom-4 left-6 z-10">
            <p className="text-white/20 text-xs">{detailers.length} detailer{detailers.length !== 1 ? 's' : ''} worldwide</p>
          </div>
        )}
      </div>

      {/* Slide-in Card */}
      {selected && (
        <>
          <div className="fixed inset-0 bg-black/40 z-30 md:bg-transparent" onClick={() => setSelected(null)} />
          <div className="fixed bottom-0 left-0 right-0 md:bottom-auto md:top-0 md:right-0 md:left-auto md:w-[400px] md:h-full z-40 animate-slide-in">
            <div className="bg-[#0f1623] border-t md:border-l border-white/10 rounded-t-2xl md:rounded-none md:h-full flex flex-col overflow-hidden shadow-2xl">
              {/* Close */}
              <div className="flex items-center justify-between px-5 pt-5 pb-2">
                <span className="text-[10px] uppercase tracking-wider text-white/30">Detailer Profile</span>
                <button onClick={() => setSelected(null)} className="text-white/30 hover:text-white text-lg">&times;</button>
              </div>

              <div className="flex-1 overflow-y-auto px-5 pb-5">
                {/* Logo + Name */}
                <div className="flex items-center gap-4 mb-5">
                  {selected.logo_url ? (
                    <img src={selected.logo_url} alt="" className="w-14 h-14 rounded-xl object-cover border border-white/10" />
                  ) : (
                    <div className="w-14 h-14 rounded-xl bg-blue-500/20 flex items-center justify-center text-blue-400 text-xl font-bold">
                      {selected.company?.charAt(0) || '?'}
                    </div>
                  )}
                  <div>
                    <h2 className="text-white text-lg font-semibold">{selected.company || selected.name}</h2>
                    {selected.avg_rating && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className="text-yellow-400 text-xs">{'*'.repeat(Math.round(selected.avg_rating))}</span>
                        <span className="text-white/40 text-xs">{selected.avg_rating.toFixed(1)} ({selected.review_count})</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Airport */}
                {selected.home_airport && (
                  <div className="mb-4">
                    <p className="text-[10px] uppercase tracking-wider text-white/30 mb-1.5">Home Airport</p>
                    <span className="inline-block px-3 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-lg text-blue-400 text-sm font-medium">
                      {selected.home_airport}
                    </span>
                  </div>
                )}

                {/* Badges */}
                <div className="flex flex-wrap gap-2 mb-5">
                  {selected.has_online_booking && (
                    <span className="px-3 py-1 bg-green-500/10 border border-green-500/20 rounded-full text-green-400 text-xs font-medium">
                      Online Booking
                    </span>
                  )}
                  <span className="px-3 py-1 bg-white/5 border border-white/10 rounded-full text-white/50 text-xs">
                    {selected.plan === 'enterprise' ? 'Enterprise' : selected.plan === 'business' ? 'Business' : 'Pro'}
                  </span>
                </div>

                {/* CTA */}
                <a
                  href={`${CRM_URL}/request/${slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block w-full py-3.5 bg-blue-500 hover:bg-blue-600 text-white text-center text-sm font-semibold rounded-lg transition-colors"
                >
                  Request a Quote
                </a>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Footer */}
      <footer className="relative z-10 text-center py-3 border-t border-white/5 flex-shrink-0">
        <p className="text-white/20 text-xs">
          <a href="https://shinyjets.com" className="hover:text-white/40 transition-colors">Shiny Jets</a>
          {' '}&middot; The Professional Aircraft Detailing Platform
        </p>
      </footer>

      <style jsx global>{`
        @keyframes slide-in {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        @media (min-width: 768px) {
          @keyframes slide-in {
            from { transform: translateX(100%); }
            to { transform: translateX(0); }
          }
        }
        .animate-slide-in {
          animation: slide-in 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}

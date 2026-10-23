import type { Listing } from '@/lib/listings';

// Server-rendered, crawlable list of real listings (no client JS needed).
export default function ListingLinks({ listings }: { listings: Listing[] }) {
  if (listings.length === 0) return null;
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
      {listings.map((l) => (
        <li key={l.slug}>
          <a href={`/detailer/${l.slug}`} className="block px-3 py-2 rounded-lg border border-white/10 hover:bg-white/[0.04] transition-colors">
            <span className="block text-white text-sm font-medium truncate">{l.company}</span>
            {l.airport?.name ? (
              <span className="block text-white/40 text-xs truncate">{l.airport.name} ({l.airport.code})</span>
            ) : null}
          </a>
        </li>
      ))}
    </ul>
  );
}

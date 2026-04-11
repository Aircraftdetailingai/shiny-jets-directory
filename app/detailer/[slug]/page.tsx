import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getAirportInfo } from '@/lib/airport-cities';

const CRM_URL = process.env.NEXT_PUBLIC_CRM_URL || 'https://crm.shinyjets.com';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://directory.shinyjets.com';

interface Detailer {
  id: string;
  company: string;
  name: string;
  logo_url?: string;
  plan: string;
  home_airport?: string;
  country?: string;
  description?: string;
  certifications?: string[];
  verified_finish?: boolean;
  insured?: boolean;
  insurer?: string;
  online_booking?: boolean;
  website_url?: string;
  phone?: string;
  theme_primary?: string;
  services?: { name: string; description?: string }[];
  review_count?: number;
  avg_rating?: number | null;
  slug: string;
}

async function fetchDetailer(slug: string): Promise<Detailer | null> {
  try {
    const res = await fetch(`${CRM_URL}/api/detailers/profile/${slug}`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.detailer || null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const detailer = await fetchDetailer(slug);
  if (!detailer) {
    return { title: 'Detailer Not Found | Shiny Jets Directory' };
  }

  const airport = getAirportInfo(detailer.home_airport);
  const airportLabel = airport ? `${airport.name} (${detailer.home_airport})` : detailer.home_airport || '';
  const locationLabel = airport ? `${airport.city}, ${airport.state}` : '';

  const title = `${detailer.company} — Aircraft Detailing${airport ? ` at ${airport.name}` : ''} | Shiny Jets Directory`;
  const description = `${detailer.company} provides professional aircraft detailing services${airport ? ` at ${airportLabel}, ${locationLabel}` : ''}. ${detailer.online_booking ? 'Book online or request' : 'Request'} a quote.`;

  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/detailer/${slug}` },
    openGraph: {
      title,
      description,
      url: `${SITE_URL}/detailer/${slug}`,
      siteName: 'Shiny Jets Directory',
      type: 'website',
      images: detailer.logo_url ? [{ url: detailer.logo_url }] : undefined,
    },
    twitter: {
      card: 'summary',
      title,
      description,
    },
  };
}

export default async function DetailerProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const detailer = await fetchDetailer(slug);

  if (!detailer) {
    notFound();
  }

  const airport = getAirportInfo(detailer.home_airport);
  const planLabel = detailer.plan === 'enterprise' ? 'Enterprise Partner'
    : detailer.plan === 'business' ? 'Business'
    : detailer.plan === 'pro' ? 'Pro Member'
    : 'Member';

  const profileUrl = `${SITE_URL}/detailer/${slug}`;
  const requestUrl = `${CRM_URL}/request/${slug}`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': profileUrl,
    name: detailer.company,
    description: detailer.description || `${detailer.company} — professional aircraft detailing services${airport ? ` at ${airport.name}, ${airport.city}, ${airport.state}` : ''}.`,
    url: profileUrl,
    image: detailer.logo_url || undefined,
    telephone: detailer.phone || undefined,
    address: airport ? {
      '@type': 'PostalAddress',
      addressLocality: airport.city,
      addressRegion: airport.state,
      addressCountry: detailer.country || 'US',
    } : undefined,
    areaServed: airport ? `${airport.city}, ${airport.state}` : undefined,
    serviceType: 'Aircraft Detailing',
    priceRange: '$$$',
    aggregateRating: detailer.avg_rating && detailer.review_count ? {
      '@type': 'AggregateRating',
      ratingValue: detailer.avg_rating,
      reviewCount: detailer.review_count,
    } : undefined,
    makesOffer: (detailer.services || []).slice(0, 8).map(s => ({
      '@type': 'Offer',
      itemOffered: { '@type': 'Service', name: s.name },
    })),
  };

  const themeColor = detailer.theme_primary || '#0081b8';

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Header */}
      <header className="border-b border-white/10 bg-[#0a0e1a]/90 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2.5">
            <img src="https://shinyjets.com/logo.png" alt="Shiny Jets" className="h-8 object-contain" />
            <span className="text-white font-semibold tracking-tight">Shiny Jets Directory</span>
          </a>
          <a href="/" className="text-xs text-white/60 hover:text-white">&larr; Back to directory</a>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 md:py-12">
        {/* Hero */}
        <section className="flex flex-col md:flex-row items-start gap-6 mb-10">
          <div className="shrink-0">
            {detailer.logo_url ? (
              <img
                src={detailer.logo_url}
                alt={`${detailer.company} logo`}
                className="w-24 h-24 md:w-32 md:h-32 rounded-2xl object-cover border border-white/10 bg-white/5"
              />
            ) : (
              <div
                className="w-24 h-24 md:w-32 md:h-32 rounded-2xl flex items-center justify-center text-4xl font-bold text-white"
                style={{ background: `${themeColor}33`, color: themeColor }}
              >
                {detailer.company?.charAt(0) || '?'}
              </div>
            )}
          </div>

          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl md:text-4xl font-light tracking-tight">{detailer.company}</h1>
              <span className="px-2 py-0.5 text-[10px] uppercase tracking-wider rounded-full border border-white/20 text-white/70">
                {planLabel}
              </span>
            </div>

            {airport && (
              <p className="text-white/60 mb-3">
                <span className="text-white/80 font-medium">{airport.name}</span>
                <span className="text-white/40"> ({detailer.home_airport})</span>
                <span className="text-white/40"> &middot; {airport.city}, {airport.state}</span>
              </p>
            )}

            {detailer.avg_rating && detailer.review_count ? (
              <div className="flex items-center gap-2 mb-4">
                <span className="text-yellow-400 text-sm">{'★'.repeat(Math.round(detailer.avg_rating))}{'☆'.repeat(5 - Math.round(detailer.avg_rating))}</span>
                <span className="text-white/60 text-sm">{detailer.avg_rating.toFixed(1)} ({detailer.review_count} review{detailer.review_count !== 1 ? 's' : ''})</span>
              </div>
            ) : null}

            {/* Badges */}
            <div className="flex flex-wrap gap-2 mb-4">
              {detailer.online_booking && (
                <span className="px-3 py-1 text-xs font-medium rounded-full bg-green-500/10 border border-green-500/30 text-green-400">
                  Online Booking
                </span>
              )}
              {detailer.insured && (
                <span className="px-3 py-1 text-xs font-medium rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400">
                  Insured{detailer.insurer ? ` · ${detailer.insurer}` : ''}
                </span>
              )}
              {detailer.verified_finish && (
                <span className="px-3 py-1 text-xs font-medium rounded-full bg-yellow-500/10 border border-yellow-500/30 text-yellow-400">
                  Verified Finish Certified
                </span>
              )}
            </div>

            <a
              href={requestUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg font-semibold text-white text-sm transition-opacity hover:opacity-90"
              style={{ background: themeColor }}
            >
              Request a Quote &rarr;
            </a>
          </div>
        </section>

        {/* Description */}
        {detailer.description && (
          <section className="mb-10">
            <h2 className="text-xs uppercase tracking-widest text-white/40 mb-3">About</h2>
            <p className="text-white/80 text-base leading-relaxed max-w-3xl">{detailer.description}</p>
          </section>
        )}

        {/* Services */}
        {detailer.services && detailer.services.length > 0 && (
          <section className="mb-10">
            <h2 className="text-xs uppercase tracking-widest text-white/40 mb-3">Services</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {detailer.services.map((s, i) => (
                <div key={i} className="bg-white/[0.03] border border-white/10 rounded-lg p-4">
                  <p className="text-white font-medium text-sm">{s.name}</p>
                  {s.description && <p className="text-white/50 text-xs mt-1">{s.description}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Certifications */}
        {detailer.certifications && detailer.certifications.length > 0 && (
          <section className="mb-10">
            <h2 className="text-xs uppercase tracking-widest text-white/40 mb-3">Certifications</h2>
            <div className="flex flex-wrap gap-2">
              {detailer.certifications.map((c, i) => (
                <span key={i} className="px-3 py-1.5 text-xs font-medium rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400">
                  {c}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* CTA Section */}
        <section className="mt-12 p-8 rounded-2xl border border-white/10 bg-white/[0.02] text-center">
          <h2 className="text-2xl font-light mb-3">Ready to book {detailer.company}?</h2>
          <p className="text-white/60 text-sm mb-6">Get a quote in under 2 minutes &middot; No obligation</p>
          <a
            href={requestUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-8 py-3.5 rounded-lg font-semibold text-white text-sm transition-opacity hover:opacity-90"
            style={{ background: themeColor }}
          >
            Request a Quote &rarr;
          </a>
        </section>
      </main>

      <footer className="border-t border-white/5 mt-16 py-6">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <p className="text-white/30 text-xs">
            <a href="/" className="hover:text-white/60 transition-colors">Shiny Jets Directory</a>
            {' '}&middot; The Professional Aircraft Detailing Network
          </p>
        </div>
      </footer>
    </div>
  );
}

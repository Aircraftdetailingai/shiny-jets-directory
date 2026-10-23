import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ListingLinks from '@/components/ListingLinks';
import { getDirectoryData, SITE_URL, ORG_JSONLD, type CountryPage } from '@/lib/listings';

export const revalidate = 300;
export const dynamicParams = true;

// One page per non-US country, built only from real listings whose resolved
// home airport is in that country. No page exists for a country with 0 listings.
async function findCountry(country: string): Promise<CountryPage | null> {
  const slug = country.toLowerCase();
  const { countryPages } = await getDirectoryData();
  const c = countryPages.find((p) => p.slug === slug);
  return c && c.listings.length > 0 ? c : null;
}

export async function generateStaticParams() {
  const { countryPages } = await getDirectoryData();
  return countryPages.map((c) => ({ country: c.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ country: string }> }): Promise<Metadata> {
  const { country } = await params;
  const c = await findCountry(country);
  if (!c) return { title: 'Not Found | Shiny Jets Directory', robots: { index: false } };
  const url = `${SITE_URL}/country/${c.slug}`;
  const n = c.listings.length;
  const title = `Aircraft Detailers in ${c.countryName} | Shiny Jets Directory`;
  const description = `${n} aircraft detailer${n === 1 ? '' : 's'} listed in the Shiny Jets directory in ${c.countryName}. View each listing and request a quote online.`;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, siteName: 'Shiny Jets Directory', type: 'website' },
  };
}

export default async function CountryLandingPage({ params }: { params: Promise<{ country: string }> }) {
  const { country } = await params;
  const c = await findCountry(country);
  if (!c) notFound();

  const url = `${SITE_URL}/country/${c.slug}`;
  const h1 = `Aircraft Detailers in ${c.countryName}`;
  const listings = c.listings;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      ORG_JSONLD,
      {
        '@type': 'ItemList',
        name: h1,
        url,
        numberOfItems: listings.length,
        itemListElement: listings.map((l, i) => ({
          '@type': 'ListItem', position: i + 1, name: l.company, url: `${SITE_URL}/detailer/${l.slug}`,
        })),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Shiny Jets Directory', item: SITE_URL },
          { '@type': 'ListItem', position: 2, name: c.countryName, item: url },
        ],
      },
    ],
  };

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <header className="border-b border-white/10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2.5">
            <img src="/logos/shiny-jets-dark.png" alt="Shiny Jets" className="h-8 object-contain" />
          </a>
          <a href="/" className="text-xs text-white/60 hover:text-white">&larr; Back to directory</a>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-8 md:py-12">
        <nav aria-label="Breadcrumb" className="text-xs text-white/40 mb-4">
          <a href="/" className="hover:text-white/70">Shiny Jets Directory</a> / <span>{c.countryName}</span>
        </nav>
        <h1 className="text-3xl md:text-4xl font-light tracking-tight mb-3">{h1}</h1>
        <p className="text-white/60 mb-8">
          {listings.length} aircraft detailer{listings.length === 1 ? '' : 's'} listed in the Shiny Jets directory
          {` with a home airport in ${c.countryName}`}. Open a listing to request a quote.
        </p>
        <ListingLinks listings={listings} />
      </main>
    </div>
  );
}

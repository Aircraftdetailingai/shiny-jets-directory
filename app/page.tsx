import type { Metadata } from 'next';
import DirectoryClient from '@/components/DirectoryClient';
import ListingLinks from '@/components/ListingLinks';
import { getDirectoryData, SITE_URL, ORG_JSONLD } from '@/lib/listings';

export const revalidate = 300;

const TITLE = 'Find an Aircraft Detailer by Airport | Shiny Jets Directory';
const DESCRIPTION = 'Browse aircraft detailers listed in the Shiny Jets directory. Search by home airport and request a quote online.';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: { type: 'website', url: SITE_URL, siteName: 'Shiny Jets Directory', title: TITLE, description: DESCRIPTION },
  twitter: { card: 'summary', title: TITLE, description: DESCRIPTION },
};

export default async function HomePage() {
  const { listings, statePages, airportPages } = await getDirectoryData();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      ORG_JSONLD,
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        url: SITE_URL,
        name: 'Shiny Jets Directory',
        description: DESCRIPTION,
        publisher: { '@id': ORG_JSONLD['@id'] },
      },
      {
        '@type': 'ItemList',
        name: 'Aircraft detailers listed in the Shiny Jets directory',
        numberOfItems: listings.length,
        itemListElement: listings.map((l, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: l.company,
          url: `${SITE_URL}/detailer/${l.slug}`,
        })),
      },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <DirectoryClient />
      <section className="bg-[#0a0e1a] text-white border-t border-white/5">
        <div className="max-w-5xl mx-auto px-6 py-10">
          {statePages.length > 0 && (
            <>
              <h2 className="text-lg font-light mb-3">Browse by state</h2>
              <ul className="flex flex-wrap gap-2 mb-6">
                {statePages.map((s) => (
                  <li key={s.slug}><a href={`/aircraft-detailers/${s.slug}`} className="inline-block px-3 py-1.5 text-xs rounded-full border border-white/10 text-white/80 hover:bg-white/5">{s.stateName}</a></li>
                ))}
              </ul>
            </>
          )}
          {airportPages.length > 0 && (
            <>
              <h2 className="text-lg font-light mb-3">Browse by airport</h2>
              <ul className="flex flex-wrap gap-2 mb-8">
                {airportPages.map((a) => (
                  <li key={a.slug}><a href={`/aircraft-detailers/${a.slug}`} className="inline-block px-3 py-1.5 text-xs rounded-full border border-white/10 text-white/80 hover:bg-white/5">{a.airport.code}</a></li>
                ))}
              </ul>
            </>
          )}
          <h2 className="text-lg font-light mb-3">All listed aircraft detailers</h2>
          <ListingLinks listings={listings} />
        </div>
      </section>
    </>
  );
}

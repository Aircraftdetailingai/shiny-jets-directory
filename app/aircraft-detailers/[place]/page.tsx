import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import ListingLinks from '@/components/ListingLinks';
import { getDirectoryData, SITE_URL, ORG_JSONLD, US_STATE_NAMES, stateSlug, countryPath, type AirportPage, type StatePage } from '@/lib/listings';

export const revalidate = 300;
export const dynamicParams = true;

async function resolvePlace(place: string): Promise<
  { kind: 'state'; page: StatePage } | { kind: 'airport'; page: AirportPage; state: StatePage | null } | null
> {
  const slug = place.toLowerCase();
  const { statePages, airportPages, listings } = await getDirectoryData();
  const st = statePages.find((s) => s.slug === slug);
  if (st && st.listings.length > 0) return { kind: 'state', page: st };
  const ap = airportPages.find((a) => a.slug === slug);
  if (ap && ap.listings.length > 0) {
    const sc = ap.airport.stateCode;
    const state = sc ? statePages.find((s) => s.slug === stateSlug(US_STATE_NAMES[sc])) || null : null;
    return { kind: 'airport', page: ap, state };
  }
  // Non-US airports no longer get /aircraft-detailers/<code> pages; send any old
  // links to the country page that now lists them.
  const intl = listings.find((l) => l.airport && !l.airport.isUS && l.airport.code.toLowerCase() === slug);
  const to = countryPath(intl?.airport);
  if (to) permanentRedirect(to);
  return null;
}

function airportLabel(a: AirportPage) {
  return `${a.airport.name} (${a.airport.code})`;
}

export async function generateStaticParams() {
  const { statePages, airportPages } = await getDirectoryData();
  return [...statePages.map((s) => ({ place: s.slug })), ...airportPages.map((a) => ({ place: a.slug }))];
}

export async function generateMetadata({ params }: { params: Promise<{ place: string }> }): Promise<Metadata> {
  const { place } = await params;
  const r = await resolvePlace(place);
  if (!r) return { title: 'Not Found | Shiny Jets Directory', robots: { index: false } };
  const url = `${SITE_URL}/aircraft-detailers/${r.page.slug}`;
  const n = r.page.listings.length;
  const where = r.kind === 'state' ? r.page.stateName : airportLabel(r.page);
  const title = `Aircraft Detailers ${r.kind === 'state' ? 'in' : 'at'} ${where} | Shiny Jets Directory`;
  const description = `${n} aircraft detailer${n === 1 ? '' : 's'} listed in the Shiny Jets directory ${r.kind === 'state' ? 'in' : 'at'} ${where}. View each listing and request a quote online.`;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, siteName: 'Shiny Jets Directory', type: 'website' },
  };
}

export default async function PlacePage({ params }: { params: Promise<{ place: string }> }) {
  const { place } = await params;
  const r = await resolvePlace(place);
  if (!r) notFound();

  const url = `${SITE_URL}/aircraft-detailers/${r.page.slug}`;
  const listings = r.page.listings;
  const h1 = r.kind === 'state'
    ? `Aircraft Detailers in ${r.page.stateName}`
    : `Aircraft Detailers at ${r.page.airport.name} (${r.page.airport.code})`;

  const crumbs: { name: string; item: string }[] = [{ name: 'Shiny Jets Directory', item: SITE_URL }];
  if (r.kind === 'state') crumbs.push({ name: r.page.stateName, item: url });
  else {
    if (r.state) crumbs.push({ name: r.state.stateName, item: `${SITE_URL}/aircraft-detailers/${r.state.slug}` });
    crumbs.push({ name: `${r.page.airport.code}`, item: url });
  }

  // Links to other pages in the same state.
  const siblings: { href: string; label: string }[] = [];
  if (r.kind === 'state') {
    for (const a of r.page.airports) siblings.push({ href: `/aircraft-detailers/${a.slug}`, label: airportLabel(a) });
  } else if (r.state) {
    siblings.push({ href: `/aircraft-detailers/${r.state.slug}`, label: `All of ${r.state.stateName}` });
    for (const a of r.state.airports) if (a.slug !== r.page.slug) siblings.push({ href: `/aircraft-detailers/${a.slug}`, label: airportLabel(a) });
  }

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
        itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.item })),
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
          {crumbs.map((c, i) => (
            <span key={c.item}>
              {i > 0 && ' / '}
              {i < crumbs.length - 1 ? <a href={c.item.replace(SITE_URL, '') || '/'} className="hover:text-white/70">{c.name}</a> : <span>{c.name}</span>}
            </span>
          ))}
        </nav>
        <h1 className="text-3xl md:text-4xl font-light tracking-tight mb-3">{h1}</h1>
        <p className="text-white/60 mb-8">
          {listings.length} aircraft detailer{listings.length === 1 ? '' : 's'} listed in the Shiny Jets directory
          {r.kind === 'state' ? ` with a home airport in ${r.page.stateName}` : ` with ${r.page.airport.code} as their home airport`}.
          Open a listing to request a quote.
        </p>
        <ListingLinks listings={listings} />
        {siblings.length > 0 && (
          <section className="mt-10">
            <h2 className="text-lg font-light mb-3">{r.kind === 'state' ? `Airports in ${r.page.stateName}` : `More in ${r.state?.stateName}`}</h2>
            <ul className="flex flex-wrap gap-2">
              {siblings.map((s) => (
                <li key={s.href}><a href={s.href} className="inline-block px-3 py-1.5 text-xs rounded-full border border-white/10 text-white/80 hover:bg-white/5">{s.label}</a></li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}

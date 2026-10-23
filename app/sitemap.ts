import type { MetadataRoute } from 'next';
import { getDirectoryData, SITE_URL } from '@/lib/listings';

export const revalidate = 300; // Regenerate every 5 minutes

// Built from the same listing set as the pages: only listed, active detailers
// with a real business name; landing pages only when >=1 real listing backs them.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { listings, statePages, airportPages, countryPages } = await getDirectoryData();
  const now = new Date();
  return [
    { url: SITE_URL, lastModified: now, changeFrequency: 'daily', priority: 1.0 },
    ...statePages.map((s) => ({ url: `${SITE_URL}/aircraft-detailers/${s.slug}`, lastModified: now, changeFrequency: 'weekly' as const, priority: 0.7 })),
    ...airportPages.map((a) => ({ url: `${SITE_URL}/aircraft-detailers/${a.slug}`, lastModified: now, changeFrequency: 'weekly' as const, priority: 0.7 })),
    ...countryPages.map((c) => ({ url: `${SITE_URL}/country/${c.slug}`, lastModified: now, changeFrequency: 'weekly' as const, priority: 0.7 })),
    ...listings.map((l) => ({ url: `${SITE_URL}/detailer/${l.slug}`, lastModified: now, changeFrequency: 'weekly' as const, priority: 0.8 })),
  ];
}

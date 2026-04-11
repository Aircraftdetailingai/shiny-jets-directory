import type { MetadataRoute } from 'next';

const CRM_URL = process.env.NEXT_PUBLIC_CRM_URL || 'https://crm.shinyjets.com';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://directory.shinyjets.com';

export const revalidate = 3600; // Regenerate every hour

interface SitemapDetailer {
  slug: string;
  updated_at?: string;
}

async function fetchDetailers(): Promise<SitemapDetailer[]> {
  try {
    const res = await fetch(`${CRM_URL}/api/detailers/sitemap`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.detailers || [];
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const detailers = await fetchDetailers();
  const now = new Date();

  const detailerEntries: MetadataRoute.Sitemap = detailers.map(d => ({
    url: `${SITE_URL}/detailer/${d.slug}`,
    lastModified: d.updated_at ? new Date(d.updated_at) : now,
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  }));

  return [
    {
      url: SITE_URL,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    ...detailerEntries,
  ];
}

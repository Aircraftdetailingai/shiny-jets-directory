import { createSupabaseAirportLookup, resolvePlace } from '../directory/airports';
import { loadDirectoryDetailers } from '../directory/load';
import { getPublicDetailer, parseCrmProfile, type CrmProfile } from '../directory/profile';
import { postCrmIntakeLead, QuoteDeduper, requestQuote as submitQuote } from '../directory/quote';
import { searchDetailers } from '../directory/search';
import type { DirectoryDetailer } from '../directory/types';
import { createRateLimiter } from '../rate-limit';
import { getSupabase } from '../supabase';
import { createMcpHandler } from './server';

const CACHE_MS = 60_000;

let cache: { at: number; rows: DirectoryDetailer[] } | null = null;

const emailLimit = createRateLimiter({ limit: 5, windowMs: 60 * 60 * 1000 });
const ipLimit = createRateLimiter({ limit: 20, windowMs: 60 * 60 * 1000 });
const deduper = new QuoteDeduper(10 * 60 * 1000);

function crmUrl(): string {
  return (process.env.CRM_URL || process.env.NEXT_PUBLIC_CRM_URL || 'https://crm.shinyjets.com').replace(/\/$/, '');
}

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'https://directory.shinyjets.com').replace(/\/$/, '');
}

async function listedDetailers(): Promise<DirectoryDetailer[]> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.rows;
  const supabase = getSupabase();
  if (!supabase) throw new Error('Directory database is not configured');
  const rows = await loadDirectoryDetailers(supabase);
  cache = { at: now, rows };
  return rows;
}

async function fetchCrmProfile(slug: string): Promise<CrmProfile | null> {
  const res = await fetch(`${crmUrl()}/api/detailers/profile/${encodeURIComponent(slug)}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  return parseCrmProfile(await res.json());
}

export function createProductionMcpHandler() {
  const token = (process.env.MUSE_CONNECTOR_TOKEN || '').trim();
  const extraOrigins = (process.env.MUSE_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return createMcpHandler({
    token: token || null,
    quotesEnabled: Boolean(token),
    allowedOrigins: extraOrigins,
    async search(args) {
      const supabase = getSupabase();
      if (!supabase) return { ok: false, error: 'Directory database is not configured.' };
      const rows = await listedDetailers();
      return searchDetailers(args, {
        detailers: rows,
        resolve: (query) => resolvePlace(query, createSupabaseAirportLookup(supabase)),
        siteUrl: siteUrl(),
      });
    },
    async getDetailer(slug) {
      const rows = await listedDetailers();
      return getPublicDetailer(slug, {
        detailers: rows,
        fetchCrmProfile,
        siteUrl: siteUrl(),
      });
    },
    requestQuote(args, ctx) {
      return submitQuote(args, ctx, {
        async findDetailer(slug) {
          const rows = await listedDetailers();
          const row = rows.find((detailer) => (detailer.slug || '').toLowerCase() === slug);
          if (!row?.id || !row.slug) return null;
          const company = (row.company || '').trim() || (row.name || '').trim() || row.slug;
          return { id: row.id, company, slug: row.slug };
        },
        postLead: (body) => postCrmIntakeLead(crmUrl(), body),
        limitEmail: emailLimit,
        limitIp: ipLimit,
        deduper,
      });
    },
  });
}

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ResolvedPlace } from '../lib/directory/airports';
import { SEARCH_RANK_NOTE, searchDetailers } from '../lib/directory/search';
import type { DirectoryDetailer } from '../lib/directory/types';

const las: ResolvedPlace = {
  query: 'KLAS',
  name: 'Harry Reid International',
  code: 'KLAS',
  codes: ['KLAS', 'LAS'],
  city: 'Las Vegas',
  region: 'NV',
  lat: 36.08,
  lng: -115.152,
};

function detailer(partial: Partial<DirectoryDetailer> & { slug: string }): DirectoryDetailer {
  return {
    id: partial.slug,
    name: partial.company || partial.slug,
    company: partial.slug,
    country: 'US',
    home_airport: null,
    airports_served: [],
    plan: 'free',
    has_online_booking: false,
    logo_url: null,
    directory_description: null,
    certifications: [],
    verified_finish: false,
    insurance_verified: false,
    operating_hours_per_week: null,
    google_rating: null,
    google_review_count: 0,
    services: [],
    locations: [],
    review_count: 0,
    avg_rating: null,
    google_avg_rating: null,
    combined_review_count: 0,
    combined_avg_rating: null,
    lat: null,
    lng: null,
    city: null,
    region: null,
    ...partial,
  };
}

function assertNoPriceKeys(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoPriceKeys);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    assert.equal(/price|cost|fee|currency|hourly|amount/i.test(key), false, key);
    if (typeof child === 'string') assert.equal(/(?:\$|USD|EUR|GBP)\s?\d/.test(child), false, child);
    else assertNoPriceKeys(child);
  }
}

const directory: DirectoryDetailer[] = [
  detailer({
    slug: 'free-shine',
    company: 'Free Shine',
    plan: 'free',
    home_airport: 'KLAS',
    lat: 36.08,
    lng: -115.152,
    city: 'Las Vegas',
    region: 'NV',
    combined_avg_rating: 4.9,
    combined_review_count: 20,
    services: ['Maintenance Wash', 'Ceramic Coating'],
    insurance_verified: true,
  }),
  detailer({
    slug: 'pro-shine',
    company: 'Pro Shine',
    plan: 'pro',
    home_airport: 'LAS',
    lat: 36.08,
    lng: -115.152,
    combined_avg_rating: 4.0,
    combined_review_count: 50,
    services: ['Maintenance Wash'],
  }),
  detailer({
    slug: 'enterprise-listed',
    company: 'Enterprise Listed',
    plan: 'enterprise',
    airports_served: ['LAS'],
    combined_avg_rating: 5,
    combined_review_count: 100,
    services: ['Ceramic Coating'],
  }),
  detailer({
    slug: 'nearby-free',
    company: 'Nearby Free',
    plan: 'free',
    home_airport: 'KHND',
    lat: 36.3,
    lng: -115.15,
    services: ['Maintenance Wash'],
    directory_description: 'Packages from $99',
  }),
  detailer({
    slug: 'too-far',
    company: 'Too Far',
    plan: 'enterprise',
    home_airport: 'KTEB',
    lat: 40.85,
    lng: -74.06,
    services: ['Maintenance Wash'],
    directory_description: 'Packages from $99',
  }),
];

test('ranks by airport service, then distance, then rating, and does not boost paid plans', async () => {
  const result = await searchDetailers(
    { location: 'KLAS' },
    { detailers: directory, resolve: async () => las, siteUrl: 'https://directory.shinyjets.com' },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const slugs = (result.data.detailers as Array<{ slug: string; sponsored: boolean; plan: string }>).map((row) => row.slug);
  assert.deepEqual(slugs, ['free-shine', 'pro-shine', 'enterprise-listed', 'nearby-free']);
  assert.equal(slugs.includes('too-far'), false);
  for (const row of result.data.detailers as Array<{ sponsored: boolean }>) {
    assert.equal(row.sponsored, false);
  }
  assert.equal(result.data.rank, SEARCH_RANK_NOTE);
  assertNoPriceKeys(result.data);
});

test('service filter keeps factual matches only', async () => {
  const result = await searchDetailers(
    { location: 'Las Vegas', service: 'ceramic' },
    { detailers: directory, resolve: async () => las, siteUrl: 'https://directory.shinyjets.com' },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const slugs = (result.data.detailers as Array<{ slug: string }>).map((row) => row.slug);
  assert.deepEqual(slugs, ['free-shine', 'enterprise-listed']);
});

test('rejects a missing location and an oversized radius', async () => {
  const missing = await searchDetailers({}, { detailers: [], resolve: async () => null, siteUrl: 'https://directory.shinyjets.com' });
  assert.equal(missing.ok, false);
  const radius = await searchDetailers(
    { location: 'KLAS', radius_miles: 900 },
    { detailers: directory, resolve: async () => las, siteUrl: 'https://directory.shinyjets.com' },
  );
  assert.equal(radius.ok, false);
});

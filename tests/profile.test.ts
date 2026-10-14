import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildDetailerJsonLd } from '../lib/directory/jsonld';
import { parseCrmProfile, projectDetailer } from '../lib/directory/profile';
import { compareDirectoryDetailers } from '../lib/directory/sort';
import type { DirectoryDetailer } from '../lib/directory/types';

test('profile json-ld has no price range', () => {
  const jsonLd = buildDetailerJsonLd({
    company: 'Shiny Jets',
    description: 'Aircraft detailing',
    profileUrl: 'https://directory.shinyjets.com/detailer/shiny-jets',
    airport: { name: 'Chino Airport', city: 'Chino', state: 'CA' },
    services: [{ name: 'Maintenance Wash' }],
    avg_rating: 4.8,
    review_count: 12,
  });
  assert.equal('priceRange' in jsonLd, false);
  assert.equal(JSON.stringify(jsonLd).includes('$$$'), false);
  assert.equal(jsonLd.name, 'Shiny Jets');
  const offers = jsonLd.makesOffer as Array<{ price?: unknown }>;
  assert.equal(offers[0].price, undefined);
});

test('the profile page source no longer publishes priceRange', () => {
  const source = readFileSync(new URL('../app/detailer/[slug]/page.tsx', import.meta.url), 'utf8');
  assert.equal(source.includes('priceRange'), false);
  assert.equal(source.includes('$$$'), false);
  assert.equal(source.includes('for service options and pricing'), false);
});

test('public detailer projection drops CRM price fields', () => {
  const crm = parseCrmProfile({
    detailer: {
      description: 'A wash is $150 today',
      phone: '6195550100',
      website_url: 'https://shinyjets.com',
      priceRange: '$$$',
      hourly_rate: 175,
      insurer: 'Secret Co',
      insured: true,
      services: [
        { name: 'Wash', description: 'From $200' },
        { name: 'Wax', description: 'Paint sealant' },
      ],
    },
  });
  assert.equal(crm?.description, null);
  const detailer = {
    id: '1',
    name: 'Brett Berry',
    company: 'Shiny Jets',
    country: 'US',
    home_airport: 'KCNO',
    airports_served: ['KCNO'],
    plan: 'enterprise',
    has_online_booking: true,
    logo_url: null,
    slug: 'shiny-jets',
    directory_description: null,
    certifications: [],
    verified_finish: false,
    insurance_verified: true,
    operating_hours_per_week: null,
    google_rating: null,
    google_review_count: 0,
    services: ['Wash', 'Wax'],
    locations: [],
    review_count: 0,
    avg_rating: null,
    google_avg_rating: null,
    combined_review_count: 0,
    combined_avg_rating: null,
    lat: 33.97,
    lng: -117.63,
    city: 'Chino',
    region: 'CA',
  } satisfies DirectoryDetailer;
  const projected = projectDetailer(detailer, crm, 'https://directory.shinyjets.com');
  assert.equal(projected.phone, '6195550100');
  assert.equal(projected.sponsored, false);
  assert.equal('priceRange' in projected, false);
  assert.equal('hourly_rate' in projected, false);
  assert.equal('insurer' in projected, false);
  assert.equal(projected.description, null);
  const services = projected.services as Array<{ name: string; description?: string }>;
  assert.equal(services.find((service) => service.name === 'Wash')?.description, undefined);
  assert.equal(services.find((service) => service.name === 'Wax')?.description, 'Paint sealant');
});

test('directory listing sort still puts null operating hours last', () => {
  const rows = [
    { company: 'B', operating_hours_per_week: null, google_rating: 5, google_review_count: 10 },
    { company: 'A', operating_hours_per_week: 20, google_rating: 3, google_review_count: 1 },
    { company: 'C', operating_hours_per_week: 40, google_rating: null, google_review_count: null },
  ];
  rows.sort(compareDirectoryDetailers);
  assert.deepEqual(rows.map((row) => row.company), ['C', 'A', 'B']);
});

// Run: npm test  (pure functions only — no network, no DB writes)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildListings, buildAirportPages, buildStatePages, buildCountryPages, ambiguousListings, airportPlaceLabel } from '../lib/listings';

const ap = (icao: string | null, iata: string | null, local: string | null, iso: string, country: string, name: string, city: string, type = 'medium_airport') =>
  ({ icao, gps_code: icao, iata, local_code: local, name, type, scheduled_service: false, city, iso_region: iso, country });
const airports = [
  ap('KCHA', 'CHA', 'CHA', 'US-TN', 'US', 'Chattanooga Metropolitan', 'Chattanooga'),
  ap('AR-0009', 'CNT', 'CHA', 'AR-H', 'AR', 'Charata Airport', 'Charata', 'small_airport'),
  ap('CYHM', 'YHM', null, 'CA-ON', 'CA', 'John C. Munro Hamilton International Airport', 'Hamilton'),
  ap('HLMS', 'MRA', null, 'LY-MI', 'LY', 'Misrata International Airport', 'Misrata', 'small_airport'),
  ap('AYRJ', null, 'MRA', 'PG-ESW', 'PG', 'Mariama', 'Mariama', 'small_airport'),
  ap('EGGW', 'LTN', null, 'GB-ENG', 'GB', 'London Luton Airport', 'Luton'),
  ap('TJSJ', 'SJU', 'SJU', 'PR-U-A', 'PR', 'Luis Munoz Marin International Airport', 'San Juan', 'large_airport'),
];
const detailers = [
  { slug: 'us-one', company: 'US One', home_airport: 'CHA', country: 'US' },
  { slug: 'ca-one', company: 'CA One', home_airport: 'YHM', country: 'CA' },
  { slug: 'ly-one', company: 'LY One', home_airport: 'MRA', country: 'US' },
  { slug: 'gb-one', company: 'GB One', home_airport: 'EGGW', country: 'GB' },
  { slug: 'pr-one', company: 'PR One', home_airport: 'TJSJ', country: 'US' },
];

test('non-US listings never land on US state or airport pages', () => {
  const ls = buildListings(detailers, airports);
  const aps = buildAirportPages(ls);
  const sps = buildStatePages(ls, aps);
  assert.deepEqual(aps.map((a) => a.slug), ['kcha']);
  assert.deepEqual(sps.map((s) => s.slug), ['tennessee']);
  for (const s of sps) for (const l of s.listings) assert.equal(l.airport?.isUS, true);
});

test('country pages only for countries with listings, names from CLDR', () => {
  const cps = buildCountryPages(buildListings(detailers, airports));
  assert.deepEqual(cps.map((c) => [c.slug, c.countryCode, c.listings.length]), [
    ['canada', 'CA', 1], ['libya', 'LY', 1], ['puerto-rico', 'PR', 1], ['united-kingdom', 'GB', 1],
  ]);
});

test('listing location shows country for non-US', () => {
  const ls = buildListings(detailers, airports);
  assert.equal(airportPlaceLabel(ls.find((l) => l.slug === 'ca-one')!.airport), 'Hamilton, Canada');
  assert.equal(airportPlaceLabel(ls.find((l) => l.slug === 'us-one')!.airport), 'Chattanooga, TN');
});

test('ambiguous codes are flagged, not changed', () => {
  const amb = ambiguousListings(detailers, airports).map((a) => a.slug).sort();
  assert.deepEqual(amb, ['ly-one', 'pr-one', 'us-one']);
});

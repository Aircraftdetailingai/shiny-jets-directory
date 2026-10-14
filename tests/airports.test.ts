import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  pickBestForCode,
  postgrestIlikePattern,
  resolvePlace,
  type AirportLookup,
  type AirportRow,
} from '../lib/directory/airports';

function row(partial: Partial<AirportRow> & Pick<AirportRow, 'name' | 'lat' | 'lng'>): AirportRow {
  return {
    icao: null,
    gps_code: null,
    iata: null,
    local_code: null,
    type: 'small_airport',
    scheduled_service: false,
    city: null,
    iso_region: null,
    ...partial,
  };
}

const teterboro = row({
  icao: 'KTEB',
  iata: 'TEB',
  gps_code: 'KTEB',
  name: 'Teterboro',
  lat: 40.85,
  lng: -74.06,
  type: 'medium_airport',
  city: 'Teterboro',
  iso_region: 'US-NJ',
});

const localTeb = row({
  icao: 'XXXX',
  local_code: 'TEB',
  name: 'Other TEB',
  lat: 1,
  lng: 1,
  city: 'Other',
  iso_region: 'US-TX',
});

test('an IATA code beats an unrelated airport that only shares a local code', () => {
  const best = pickBestForCode([localTeb, teterboro], 'TEB');
  assert.equal(best?.icao, 'KTEB');
});

test('resolves TEB to Teterboro codes without pulling in the unrelated local code', async () => {
  const lookup: AirportLookup = {
    async byCodes() {
      return [localTeb, teterboro];
    },
    async byText() {
      return [];
    },
  };
  const place = await resolvePlace('teb', lookup);
  assert.ok(place);
  assert.equal(place?.code, 'KTEB');
  assert.ok(place?.codes.includes('TEB'));
  assert.ok(place?.codes.includes('KTEB'));
  assert.equal(place?.codes.includes('XXXX'), false);
  assert.equal(place?.city, 'Teterboro');
  assert.equal(place?.region, 'NJ');
});

test('a city query keeps same-city airport codes and prefers the larger airport', async () => {
  const large = row({
    icao: 'KLAS',
    iata: 'LAS',
    name: 'Harry Reid International',
    lat: 36.08,
    lng: -115.15,
    type: 'large_airport',
    scheduled_service: true,
    city: 'Las Vegas',
    iso_region: 'US-NV',
  });
  const small = row({
    icao: 'KVGT',
    name: 'North Las Vegas',
    lat: 36.21,
    lng: -115.19,
    city: 'Las Vegas',
    iso_region: 'US-NV',
  });
  const other = row({
    icao: 'KZZZ',
    name: 'Las Vegas Junction',
    lat: 35,
    lng: -114,
    city: 'Las Vegas Junction',
  });
  const lookup: AirportLookup = {
    async byCodes() {
      return [];
    },
    async byText() {
      return [small, other, large];
    },
  };
  const place = await resolvePlace('Las Vegas', lookup);
  assert.equal(place?.code, 'KLAS');
  assert.ok(place?.codes.includes('KVGT'));
  assert.equal(place?.codes.includes('KZZZ'), false);
});

test('postgrest patterns drop filter syntax', () => {
  assert.equal(postgrestIlikePattern('Las Vegas, NV'), '*Las*Vegas*NV*');
  assert.equal(postgrestIlikePattern('ab'), null);
});

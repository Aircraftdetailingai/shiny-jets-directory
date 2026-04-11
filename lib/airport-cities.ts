// ICAO airport code → city, state for SEO and display purposes
// Add new airports as needed for detailers in the directory.
const AIRPORT_CITIES: Record<string, { city: string; state: string; name: string }> = {
  KCNO: { city: 'Chino', state: 'CA', name: 'Chino Airport' },
  KOSH: { city: 'Oshkosh', state: 'WI', name: 'Wittman Regional' },
  KMYF: { city: 'San Diego', state: 'CA', name: 'Montgomery-Gibbs Executive' },
  KTEB: { city: 'Teterboro', state: 'NJ', name: 'Teterboro Airport' },
  KVNY: { city: 'Van Nuys', state: 'CA', name: 'Van Nuys Airport' },
  KBUR: { city: 'Burbank', state: 'CA', name: 'Hollywood Burbank Airport' },
  KLAX: { city: 'Los Angeles', state: 'CA', name: 'Los Angeles International' },
  KSAN: { city: 'San Diego', state: 'CA', name: 'San Diego International' },
  KLAS: { city: 'Las Vegas', state: 'NV', name: 'Harry Reid International' },
  KPHX: { city: 'Phoenix', state: 'AZ', name: 'Phoenix Sky Harbor' },
  KAPA: { city: 'Centennial', state: 'CO', name: 'Centennial Airport' },
  KSDL: { city: 'Scottsdale', state: 'AZ', name: 'Scottsdale Airport' },
  KFXE: { city: 'Fort Lauderdale', state: 'FL', name: 'Fort Lauderdale Executive' },
  KOPF: { city: 'Opa-locka', state: 'FL', name: 'Miami-Opa Locka Executive' },
  KPBI: { city: 'West Palm Beach', state: 'FL', name: 'Palm Beach International' },
  KBED: { city: 'Bedford', state: 'MA', name: 'Hanscom Field' },
  KHPN: { city: 'White Plains', state: 'NY', name: 'Westchester County' },
  KMMU: { city: 'Morristown', state: 'NJ', name: 'Morristown Municipal' },
  KDAL: { city: 'Dallas', state: 'TX', name: 'Dallas Love Field' },
  KADS: { city: 'Addison', state: 'TX', name: 'Addison Airport' },
  KHOU: { city: 'Houston', state: 'TX', name: 'William P. Hobby' },
  KIWA: { city: 'Mesa', state: 'AZ', name: 'Phoenix-Mesa Gateway' },
  KSJC: { city: 'San Jose', state: 'CA', name: 'San Jose International' },
  KOAK: { city: 'Oakland', state: 'CA', name: 'Oakland International' },
  KSFO: { city: 'San Francisco', state: 'CA', name: 'San Francisco International' },
  KBFI: { city: 'Seattle', state: 'WA', name: 'Boeing Field' },
};

export function getAirportInfo(icao: string | null | undefined) {
  if (!icao) return null;
  const code = icao.toUpperCase().trim();
  return AIRPORT_CITIES[code] || AIRPORT_CITIES[`K${code}`] || null;
}

export default AIRPORT_CITIES;

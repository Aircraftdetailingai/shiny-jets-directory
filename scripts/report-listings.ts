// Read-only report: country grouping + ambiguous airport codes.
// Uses Supabase if env is set, else DIRECTORY_FIXTURE_FILE. Never writes.
import { loadDirectoryRows, buildListings, buildAirportPages, buildStatePages, buildCountryPages, ambiguousListings } from '../lib/listings';

(async () => {
  const { detailers, airports } = await loadDirectoryRows();
  const ls = buildListings(detailers, airports);
  const aps = buildAirportPages(ls);
  const sps = buildStatePages(ls, aps);
  console.log(`listings=${ls.length} usAirportPages=${aps.length} statePages=${sps.length}`);
  for (const c of buildCountryPages(ls)) console.log(`/country/${c.slug} (${c.countryCode}): ${c.listings.map((l) => `${l.company} [${l.airport?.code}]`).join('; ')}`);
  for (const a of ambiguousListings(detailers, airports)) console.log(`AMBIGUOUS ${a.slug} "${a.company}" code=${a.code} -> ${a.resolvedTo}: ${a.reasons.join('; ')}`);
})();

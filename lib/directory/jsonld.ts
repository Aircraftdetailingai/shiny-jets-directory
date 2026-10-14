// schema.org for a detailer profile. Prices are intentionally absent:
// the directory does not publish what a detailer charges.

export interface JsonLdAirport {
  name: string;
  city: string;
  state: string;
}

export interface JsonLdInput {
  company: string;
  description?: string | null;
  logo_url?: string | null;
  phone?: string | null;
  country?: string | null;
  avg_rating?: number | null;
  review_count?: number | null;
  services?: { name: string; description?: string | null }[] | null;
  profileUrl: string;
  airport?: JsonLdAirport | null;
}

export function buildDetailerJsonLd(input: JsonLdInput): Record<string, unknown> {
  const airport = input.airport || null;
  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': input.profileUrl,
    name: input.company,
    description:
      input.description ||
      `${input.company} — professional aircraft detailing services${airport ? ` at ${airport.name}, ${airport.city}, ${airport.state}` : ''}.`,
    url: input.profileUrl,
  };

  if (input.logo_url) jsonLd.image = input.logo_url;
  if (input.phone) jsonLd.telephone = input.phone;
  if (airport) {
    jsonLd.address = {
      '@type': 'PostalAddress',
      addressLocality: airport.city,
      addressRegion: airport.state,
      addressCountry: input.country || 'US',
    };
    jsonLd.areaServed = `${airport.city}, ${airport.state}`;
  }
  jsonLd.serviceType = 'Aircraft Detailing';
  if (input.avg_rating && input.review_count) {
    jsonLd.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: input.avg_rating,
      reviewCount: input.review_count,
    };
  }
  const offers = (input.services || []).slice(0, 8).filter((service) => service.name).map((service) => ({
    '@type': 'Offer',
    itemOffered: { '@type': 'Service', name: service.name },
  }));
  if (offers.length > 0) jsonLd.makesOffer = offers;
  return jsonLd;
}

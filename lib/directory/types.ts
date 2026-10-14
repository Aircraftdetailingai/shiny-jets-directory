// Public directory row, matching the enriched objects returned by /api/detailers.
// Muse tools project a smaller view of this shape and never include prices.

export interface DirectoryLocation {
  id: string;
  name: string | null;
  location_type: string | null;
  airport_icao: string | null;
  address: string | null;
  latitude: number;
  longitude: number;
}

export interface DirectoryDetailer {
  id: string;
  name: string | null;
  company: string | null;
  country: string | null;
  home_airport: string | null;
  airports_served: string[] | null;
  plan: string | null;
  has_online_booking: boolean | null;
  logo_url: string | null;
  slug: string | null;
  directory_description: string | null;
  certifications: string[] | null;
  verified_finish: boolean | null;
  insurance_verified: boolean | null;
  operating_hours_per_week: number | null;
  google_rating: number | null;
  google_review_count: number | null;
  services: string[];
  locations: DirectoryLocation[];
  review_count: number;
  avg_rating: number | null;
  google_avg_rating: number | null;
  combined_review_count: number;
  combined_avg_rating: number | null;
  lat: number | null;
  lng: number | null;
  city: string | null;
  region: string | null;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'wvdwgiouwjvdcsuvwshd.supabase.co' },
      { protocol: 'https', hostname: 'crm.shinyjets.com' },
    ],
  },
  // Set the directory API's cache policy at the routing layer. Setting it only
  // in the route handler didn't stick (the deployed response showed a bare
  // `cache-control: public`); applied here it lands verbatim on the response.
  async headers() {
    return [
      {
        source: '/api/detailers',
        headers: [
          { key: 'Cache-Control', value: 'public, s-maxage=300, stale-while-revalidate=3600' },
        ],
      },
    ];
  },
};

export default nextConfig;

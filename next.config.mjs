/** @type {import('next').NextConfig} */
const CRM = 'https://crm.shinyjets.com';
const nextConfig = {
  async redirects() {
    return [
      { source: '/claim', destination: `${CRM}/portal/login?ref=directory-claim`, permanent: false },
      { source: '/claim/:path*', destination: `${CRM}/portal/login?ref=directory-claim`, permanent: false },
      { source: '/privacy', destination: `${CRM}/privacy`, permanent: false },
      { source: '/terms', destination: `${CRM}/terms`, permanent: false },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'wvdwgiouwjvdcsuvwshd.supabase.co' },
      { protocol: 'https', hostname: 'crm.shinyjets.com' },
    ],
  },
};

export default nextConfig;

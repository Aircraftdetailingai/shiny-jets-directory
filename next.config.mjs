/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'wvdwgiouwjvdcsuvwshd.supabase.co' },
      { protocol: 'https', hostname: 'crm.shinyjets.com' },
    ],
  },
};

export default nextConfig;

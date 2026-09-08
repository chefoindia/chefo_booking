/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // App Router caches page segments client-side after first visit, which during
  // active development shows a page as it was BEFORE the last edit, with no
  // error and no obvious cause. Zero while this product is being iterated on.
  experimental: { staleTimes: { dynamic: 0, static: 0 } },
};
export default nextConfig;

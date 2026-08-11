/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep the heavy browser binaries out of the webpack bundle so Vercel ships
  // them as native node modules inside the serverless function.
  experimental: {
    serverComponentsExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
  },
};

export default nextConfig;

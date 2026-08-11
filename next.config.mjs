/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Keep the heavy browser binaries out of the webpack bundle so Vercel ships
    // them as native node modules inside the serverless function.
    serverComponentsExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
    // @sparticuz/chromium loads its compressed Chromium from bin/ at runtime via
    // a computed fs path, which Next's output file tracer can't detect — so it
    // gets dropped from the deployed function ("bin does not exist"). Force it in.
    outputFileTracingIncludes: {
      '/api/scrape': ['./node_modules/@sparticuz/chromium/bin/**'],
      '/api/csv': ['./node_modules/@sparticuz/chromium/bin/**'],
      '/api/cron': ['./node_modules/@sparticuz/chromium/bin/**'],
      '/api/shopify': ['./node_modules/@sparticuz/chromium/bin/**'],
    },
  },
};

export default nextConfig;

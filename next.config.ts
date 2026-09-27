import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// Cursor opens the monorepo parent (/workwise). Without this, Turbopack
// resolves CSS imports like `tailwindcss` from that parent (no node_modules).
const appRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  serverExternalPackages: ['@react-pdf/renderer'],
  turbopack: {
    root: appRoot,
  },
  async redirects() {
    return [
      // Old product-prefixed dashboard URLs → neutral paths (entitlement picks the UI).
      { source: '/rounds', destination: '/dashboard', permanent: false },
      { source: '/rounds/customers', destination: '/customers', permanent: false },
      {
        source: '/rounds/customers/:path*',
        destination: '/customers/:path*',
        permanent: false,
      },
      { source: '/rounds/calendar', destination: '/calendar', permanent: false },
      { source: '/rounds/services', destination: '/services', permanent: false },
      { source: '/rounds/import', destination: '/import', permanent: false },
      { source: '/rounds/payments', destination: '/payments', permanent: false },
      { source: '/rounds/bank', destination: '/bank', permanent: false },
      { source: '/rounds/messages', destination: '/messages', permanent: false },
      { source: '/rounds/expenses', destination: '/expenses', permanent: false },
    ];
  },
};

export default nextConfig;

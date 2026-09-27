import type { NextConfig } from 'next';

// Enforced now: directives that cannot break the app, because it is never framed, uses no
// plugins, sets no <base> and has no cross-origin forms.
const ENFORCED_CSP = ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"].join('; ');

// Report-only until checked in a deployed browser (see README). The app loads only its own
// scripts, styles and API; 'unsafe-inline' is needed for the inline bootstrap scripts
// Next.js adds to every page (a nonce would require middleware and dynamic rendering).
// Enforce it by renaming the header once the browser console shows no violations.
const REPORT_ONLY_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function securityHeaders() {
  const headers = [
    { key: 'Content-Security-Policy', value: ENFORCED_CSP },
    { key: 'Content-Security-Policy-Report-Only', value: REPORT_ONLY_CSP },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'X-Frame-Options', value: 'DENY' },
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
    },
  ];
  // Production only, so local http://localhost is never pinned to HTTPS. Two years, this
  // host only: includeSubDomains and preload affect other subdomains and are for the
  // domain owner to decide.
  if (process.env.NODE_ENV === 'production') {
    headers.push({ key: 'Strict-Transport-Security', value: 'max-age=63072000' });
  }
  return headers;
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders() },
      // Also covers responses Next.js generates itself, such as 405 for other methods.
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    ];
  },
};

export default nextConfig;

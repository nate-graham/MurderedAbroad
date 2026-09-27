// Security header configuration (Phase 3B). Tests the headers Next.js is configured to
// send; enforcement in a deployed browser must still be verified (see README).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import nextConfig from '@/next.config';

type Header = { key: string; value: string };

async function headersFor(source: string, nodeEnv?: string) {
  const previous = process.env.NODE_ENV;
  if (nodeEnv) Object.assign(process.env, { NODE_ENV: nodeEnv });
  try {
    const rules = (await nextConfig.headers?.()) ?? [];
    const rule = rules.find((candidate) => candidate.source === source);
    assert.ok(rule, `no header rule for ${source}`);
    return new Map((rule.headers as Header[]).map(({ key, value }) => [key.toLowerCase(), value]));
  } finally {
    Object.assign(process.env, { NODE_ENV: previous });
  }
}

describe('security headers for every route', () => {
  test('baseline headers', async () => {
    const headers = await headersFor('/:path*');
    assert.equal(headers.get('x-content-type-options'), 'nosniff');
    assert.equal(headers.get('referrer-policy'), 'no-referrer');
    assert.equal(headers.get('x-frame-options'), 'DENY');
    assert.equal(
      headers.get('permissions-policy'),
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()'
    );
  });

  test('an enforced CSP blocks framing, plugins, base-tag and form hijacking', async () => {
    const csp = (await headersFor('/:path*')).get('content-security-policy') ?? '';
    for (const directive of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"]) {
      assert.ok(csp.includes(directive), directive);
    }
  });

  test('the full CSP is report-only until verified in a deployed browser', async () => {
    const reportOnly = (await headersFor('/:path*')).get('content-security-policy-report-only') ?? '';
    for (const directive of [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
    ]) {
      assert.ok(reportOnly.includes(directive), directive);
    }
    assert.ok(!reportOnly.includes('unsafe-eval'));
    assert.ok(!/https?:\/\//.test(reportOnly), 'no third-party origins');
  });

  test('HSTS is sent in production only', async () => {
    assert.equal((await headersFor('/:path*', 'production')).get('strict-transport-security'), 'max-age=63072000');
    assert.equal((await headersFor('/:path*', 'development')).get('strict-transport-security'), undefined);
  });
});

describe('API responses', () => {
  test('are never cached', async () => {
    assert.equal((await headersFor('/api/:path*')).get('cache-control'), 'no-store');
  });
});

describe('framework disclosure', () => {
  test('the X-Powered-By header is disabled', () => {
    assert.equal(nextConfig.poweredByHeader, false);
  });
});

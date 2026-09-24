import { Hono } from 'hono';

export const robotsTxtRoute = new Hono();

const ROBOTS_TXT = [
  'User-agent: *',
  'Allow: /$',
  'Allow: /.well-known/',
  'Allow: /openapi.json',
  'Allow: /schemas',
  'Allow: /catalog',
  'Allow: /services',
  'Disallow: /v1/',
  'Disallow: /v2/',
  'Disallow: /v3/',
  '',
].join('\n');

robotsTxtRoute.get('/', () => {
  return new Response(ROBOTS_TXT, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
});

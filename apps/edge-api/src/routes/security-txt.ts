import { Hono } from 'hono';

export const securityTxtRoute = new Hono();

const SECURITY_TXT = [
  'Contact: mailto:security@alerts.siteborne.net',
  'Expires: 2027-08-31T23:59:59Z',
  'Canonical: https://utility.siteborne.net/.well-known/security.txt',
  'Policy: https://siteborne.com/security',
  'Preferred-Languages: en',
  '',
].join('\n');

securityTxtRoute.get('/', () => {
  return new Response(SECURITY_TXT, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
});

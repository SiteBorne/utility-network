export type RedirectPolicy = 'follow' | 'follow_first' | 'manual';

export interface RedirectResult {
  finalUrl: string;
  redirectChain: string[];
  status: number;
  headers: Record<string, string>;
}

export function applyRedirectPolicy(
  policy: RedirectPolicy,
  response: Response,
  originalUrl: string,
  maxRedirects: number
): { shouldFollow: boolean; nextUrl?: string; redirectChain: string[] } {
  const redirectChain = [originalUrl];
  const status = response.status;
  const location = response.headers.get('location');

  if (![301, 302, 303, 307, 308].includes(status) || !location) {
    return { shouldFollow: false, redirectChain };
  }

  const nextUrl = new URL(location, originalUrl).toString();
  redirectChain.push(nextUrl);

  switch (policy) {
    case 'follow':
      return { shouldFollow: redirectChain.length <= maxRedirects, nextUrl, redirectChain };
    case 'follow_first':
      return { shouldFollow: redirectChain.length <= 2, nextUrl, redirectChain };
    case 'manual':
      return { shouldFollow: false, nextUrl, redirectChain };
    default:
      return { shouldFollow: false, redirectChain };
  }
}

export function validateRedirectTarget(
  url: string,
  allowedDomains?: string[]
): { valid: boolean; reason?: string } {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, reason: 'Only HTTP/HTTPS redirects allowed' };
    }
    if (allowedDomains && allowedDomains.length > 0) {
      const allowed = allowedDomains.some(
        (d) => parsed.hostname === d || parsed.hostname.endsWith('.' + d)
      );
      if (!allowed) {
        return { valid: false, reason: `Domain ${parsed.hostname} not in allowed list` };
      }
    }
    return { valid: true };
  } catch {
    return { valid: false, reason: 'Invalid redirect URL' };
  }
}

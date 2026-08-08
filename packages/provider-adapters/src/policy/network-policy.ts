export interface NetworkPolicy {
  allowPrivateIps: boolean;
  allowLoopback: boolean;
  allowLinkLocal: boolean;
  allowMulticast: boolean;
  allowReserved: boolean;
  allowedPorts: number[];
  blockedPorts: number[];
  maxRedirects: number;
  allowedSchemes: string[];
}

export const DEFAULT_NETWORK_POLICY: NetworkPolicy = {
  allowPrivateIps: false,
  allowLoopback: false,
  allowLinkLocal: false,
  allowMulticast: false,
  allowReserved: false,
  allowedPorts: [80, 443],
  blockedPorts: [22, 23, 25, 110, 143, 993, 995, 3306, 5432, 6379, 27017],
  maxRedirects: 10,
  allowedSchemes: ['http', 'https'],
};

export function isPrivateIp(ip: string): boolean {
  const privateRanges = [
    /^10\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^127\./,
    /^169\.254\./,
    /^22[4-9]\./,
    /^23[0-9]\./,
    /^24[0-9]\./,
    /^25[0-5]\./,
    /^::1$/,
    /^fe80:/i,
    // fc00::/7 (RFC 4193 unique-local): top 7 bits fixed, i.e. first hex
    // nibble is 'f' and the second is 'c' or 'd' regardless of what follows.
    /^f[cd][0-9a-f]{0,2}:/i,
  ];
  return privateRanges.some((r) => r.test(ip));
}

export function isLoopback(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip.startsWith('127.');
}

export function isLinkLocal(ip: string): boolean {
  return ip.startsWith('169.254.') || /^fe80:/i.test(ip);
}

export function isMulticast(ip: string): boolean {
  return /^22[4-9]\./.test(ip) || /^23[0-9]\./.test(ip) || ip.startsWith('ff00::');
}

export function isReserved(ip: string): boolean {
  return /^0\./.test(ip) || /^24[0-9]\./.test(ip) || /^25[0-5]\./.test(ip);
}

/**
 * Extracts the embedded IPv4 address from an IPv4-mapped IPv6 literal
 * (::ffff:0:0/96), in either its dotted-quad form ("::ffff:192.168.1.1") or
 * the hex-group form the WHATWG URL parser normalizes to
 * ("::ffff:c0a8:101"). Returns null if `ip` is not IPv4-mapped.
 */
export function extractIpv4MappedAddress(ip: string): string | null {
  const lower = ip.toLowerCase();

  const dottedMatch = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dottedMatch) return dottedMatch[1];

  const hexMatch = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMatch) {
    const high = parseInt(hexMatch[1], 16);
    const low = parseInt(hexMatch[2], 16);
    if (Number.isNaN(high) || Number.isNaN(low)) return null;
    const a = (high >> 8) & 0xff;
    const b = high & 0xff;
    const c = (low >> 8) & 0xff;
    const d = low & 0xff;
    return `${a}.${b}.${c}.${d}`;
  }

  return null;
}

export function validateUrl(
  url: URL,
  policy: NetworkPolicy = DEFAULT_NETWORK_POLICY
): { valid: boolean; reason?: string } {
  if (!policy.allowedSchemes.includes(url.protocol.replace(':', ''))) {
    return { valid: false, reason: `Scheme ${url.protocol} not allowed` };
  }

  const port = url.port ? parseInt(url.port, 10) : url.protocol === 'https:' ? 443 : 80;
  if (policy.blockedPorts.includes(port)) {
    return { valid: false, reason: `Port ${port} is blocked` };
  }
  if (policy.allowedPorts.length > 0 && !policy.allowedPorts.includes(port)) {
    return { valid: false, reason: `Port ${port} not in allowed list` };
  }

  const hostname = url.hostname;
  if (hostname === 'localhost' || hostname === 'localhost.localdomain') {
    return { valid: false, reason: 'Hostname localhost not allowed' };
  }

  // WHATWG URL.hostname retains brackets for IPv6 literals (e.g. "[::1]");
  // strip them before matching against the address-family checks below.
  const isBracketedIpv6 = hostname.startsWith('[') && hostname.endsWith(']');
  const literalIp = isBracketedIpv6 ? hostname.slice(1, -1) : hostname;
  const ipv4Match = literalIp.match(/^(\d{1,3}\.){3}\d{1,3}$/);
  const ipv6Match = isBracketedIpv6 || literalIp.includes(':');

  if (ipv4Match) {
    // IPv4-mapped IPv6 (e.g. "::ffff:192.168.1.1") is caught by the ipv6
    // branch below via isPrivateIp/isLoopback's own ::ffff: handling.
    if (!policy.allowLoopback && isLoopback(literalIp)) {
      return { valid: false, reason: 'Loopback IP not allowed' };
    }
    if (!policy.allowPrivateIps && isPrivateIp(literalIp)) {
      return { valid: false, reason: 'Private IP not allowed' };
    }
    if (!policy.allowLinkLocal && isLinkLocal(literalIp)) {
      return { valid: false, reason: 'Link-local IP not allowed' };
    }
    if (!policy.allowMulticast && isMulticast(literalIp)) {
      return { valid: false, reason: 'Multicast IP not allowed' };
    }
    if (!policy.allowReserved && isReserved(literalIp)) {
      return { valid: false, reason: 'Reserved IP not allowed' };
    }
  } else if (ipv6Match) {
    const normalized = literalIp.toLowerCase();
    // IPv4-mapped IPv6 (::ffff:a.b.c.d, or the WHATWG-normalized hex-group
    // form ::ffff:xxxx:xxxx) — recurse into the embedded IPv4 check.
    const mappedIpv4 = extractIpv4MappedAddress(normalized);
    if (mappedIpv4) {
      return validateUrl(new URL(url.toString().replace(hostname, mappedIpv4)), policy);
    }
    if (!policy.allowLoopback && isLoopback(normalized)) {
      return { valid: false, reason: 'Loopback IP not allowed' };
    }
    if (!policy.allowPrivateIps && isPrivateIp(normalized)) {
      return { valid: false, reason: 'Private IP not allowed' };
    }
    if (!policy.allowLinkLocal && isLinkLocal(normalized)) {
      return { valid: false, reason: 'Link-local IP not allowed' };
    }
    if (!policy.allowMulticast && isMulticast(normalized)) {
      return { valid: false, reason: 'Multicast IP not allowed' };
    }
  }

  return { valid: true };
}

export function validateRedirectChain(
  urls: URL[],
  policy: NetworkPolicy = DEFAULT_NETWORK_POLICY
): { valid: boolean; reason?: string } {
  if (urls.length > policy.maxRedirects) {
    return { valid: false, reason: `Redirect chain exceeds maximum of ${policy.maxRedirects}` };
  }

  const seen = new Set<string>();
  for (const url of urls) {
    const key = url.toString();
    if (seen.has(key)) {
      return { valid: false, reason: 'Redirect loop detected' };
    }
    seen.add(key);

    const validation = validateUrl(url, policy);
    if (!validation.valid) {
      return { valid: false, reason: `Redirect target invalid: ${validation.reason}` };
    }
  }

  return { valid: true };
}

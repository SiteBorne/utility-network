import type { InjectedHttpClient } from '../types';
import {
  isPrivateIp,
  isLoopback,
  isLinkLocal,
  isMulticast,
  isReserved,
  extractIpv4MappedAddress,
} from '../policy/network-policy';

export interface ResolvedAddress {
  ip: string;
  family: 4 | 6;
}

export interface SafeDnsResolution {
  safe: boolean;
  selectedAddress?: ResolvedAddress;
  reason?: string;
  allAnswers: ResolvedAddress[];
  prohibitedAnswers: ResolvedAddress[];
}

/**
 * Cloudflare's own DNS-over-HTTPS resolver -- a fixed, trusted,
 * non-user-controlled endpoint. `resolveSafeAddress` always queries this
 * exact hostname, never the buyer-supplied target hostname.
 */
export const TRUSTED_DOH_ENDPOINT = 'https://cloudflare-dns.com/dns-query';

const DOH_TYPE_A = 1;
const DOH_TYPE_AAAA = 28;

/**
 * Reuses the exact same private/loopback/link-local/multicast/reserved
 * policy `network-policy.ts`'s `validateUrl` already applies to literal
 * IPs in a URL -- no gate logic is duplicated. `family` distinguishes
 * IPv4-mapped-IPv6 handling (recurse into the embedded IPv4 check, same
 * as `validateUrl` itself does).
 */
export function isProhibitedResolvedIp(ip: string, family: 4 | 6): boolean {
  if (family === 6) {
    const mapped = extractIpv4MappedAddress(ip.toLowerCase());
    if (mapped) return isProhibitedResolvedIp(mapped, 4);
  }
  return isLoopback(ip) || isPrivateIp(ip) || isLinkLocal(ip) || isMulticast(ip) || isReserved(ip);
}

interface DohAnswer {
  type: number;
  data: string;
}
interface DohResponse {
  Status?: number;
  Answer?: DohAnswer[];
}

async function queryDoh(
  httpClient: InjectedHttpClient,
  hostname: string,
  type: 'A' | 'AAAA'
): Promise<string[]> {
  const url = `${TRUSTED_DOH_ENDPOINT}?name=${encodeURIComponent(hostname)}&type=${type}`;
  const res = await httpClient.fetch(url, { headers: { accept: 'application/dns-json' } });
  if (!res.ok) return [];
  let body: DohResponse;
  try {
    body = (await res.json()) as DohResponse;
  } catch {
    return [];
  }
  const wantType = type === 'A' ? DOH_TYPE_A : DOH_TYPE_AAAA;
  return (body.Answer ?? []).filter((a) => a.type === wantType).map((a) => a.data);
}

/**
 * Resolves `hostname` via the fixed, trusted DoH endpoint above and
 * evaluates every returned address against the same prohibited-address
 * policy `validateUrl` already applies to literal IPs (SUN-1221B's own
 * finding: `validateUrl` only checks the URL string's literal hostname,
 * never a resolved address -- this closes exactly that gap).
 *
 * Fails closed:
 * - zero usable answers -> unsafe (`dns_resolution_returned_no_answers`).
 * - ANY answer (IPv4 or IPv6) prohibited -> the WHOLE resolution is
 *   unsafe (`prohibited_or_mixed_dns_answer`), even if other answers in
 *   the same response are public. A mix of public and private answers is
 *   treated as a rebinding/misconfiguration signal, not something to
 *   route around by silently picking "the good one" -- legitimate public
 *   services do not intentionally return a private address alongside a
 *   public one.
 * - only proceeds when EVERY resolved address is public, selecting the
 *   first as the connection target (see `SafeSocketHttpClient`, which
 *   connects to this exact literal IP -- never re-resolving the
 *   hostname, closing the TOCTOU window this function alone cannot).
 */
export async function resolveSafeAddress(
  httpClient: InjectedHttpClient,
  hostname: string
): Promise<SafeDnsResolution> {
  const [v4, v6] = await Promise.all([
    queryDoh(httpClient, hostname, 'A'),
    queryDoh(httpClient, hostname, 'AAAA'),
  ]);
  const all: ResolvedAddress[] = [
    ...v4.map((ip) => ({ ip, family: 4 as const })),
    ...v6.map((ip) => ({ ip, family: 6 as const })),
  ];

  if (all.length === 0) {
    return {
      safe: false,
      reason: 'dns_resolution_returned_no_answers',
      allAnswers: [],
      prohibitedAnswers: [],
    };
  }

  const prohibited = all.filter((a) => isProhibitedResolvedIp(a.ip, a.family));
  if (prohibited.length > 0) {
    return {
      safe: false,
      reason: 'prohibited_or_mixed_dns_answer',
      allAnswers: all,
      prohibitedAnswers: prohibited,
    };
  }

  return { safe: true, selectedAddress: all[0], allAnswers: all, prohibitedAnswers: [] };
}

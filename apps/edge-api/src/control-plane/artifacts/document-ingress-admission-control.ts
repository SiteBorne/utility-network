/**
 * SUN-1222C0-R1 — distributed admission control for
 * `POST /v2/artifacts/documents`, closing the exact gap SUN-1222C0 found
 * and deliberately left open (`UNBOUNDED_UNPAID_STORAGE_PATHS=1`): an
 * anonymous, unpaid caller could accumulate unbounded R2/D1 storage
 * because no per-source or aggregate admission limit existed on the
 * buyer-facing upload endpoint. Per-object byte bounds
 * (`DOCUMENT_UPLOAD_MAX_BYTES`) and physical reclamation
 * (`artifact-reclamation.ts`) already existed; this module adds the two
 * missing invariant components: a bounded per-source admission rate and a
 * bounded aggregate/global admission rate (§4 B/C).
 *
 * DESIGN CHOICE — why this is D1-backed rather than Cloudflare's native
 * Workers Rate Limiting binding (`[[ratelimits]]`, `env.<BINDING>.limit()`):
 * that binding was evaluated first, per this checkpoint's own "inspect
 * existing architecture, prefer the smallest native mechanism" directive,
 * and rejected for three real, Cloudflare-documented reasons — not a
 * stylistic preference (verified live against
 * developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/,
 * 2026, during this checkpoint):
 *
 *   1. LOCALITY: the binding's own docs state limits are enforced PER
 *      CLOUDFLARE LOCATION (colo), not globally — "if a request comes in
 *      from Sydney... after 100 requests... any further requests... would
 *      be rejected... but this would only apply to requests served in
 *      Sydney." A botnet, or even one abusive source whose requests land
 *      in different colos, would face an INDEPENDENT budget per colo —
 *      directly undermining both axes this checkpoint requires (a
 *      "global" bound that is actually N independent per-colo bounds is
 *      not a global bound; a "per-source" bound with the same property is
 *      weaker than it appears).
 *   2. ACCURACY: the same docs state the binding is "permissive,
 *      eventually consistent, and intentionally designed to not be used
 *      as an accurate accounting system" — meaning even the per-source
 *      axis cannot honestly be proven to "never exceed" under concurrency
 *      with that primitive (§17 of this checkpoint requires exactly that
 *      proof).
 *   3. WINDOW GRANULARITY: `simple.period` "must be either 10 or 60"
 *      seconds — it cannot express a window aligned with this system's
 *      real retention horizon (`ARTIFACT_PHYSICAL_RECLAMATION_AFTER_
 *      SECONDS` = 86,400s) without compounding 1,440 independent 60s
 *      windows into a much larger, looser worst-case bound than a single
 *      24h window gives directly.
 *
 * The `DB` (D1) binding is already a required, always-present production
 * dependency of this exact route (`document-artifact-upload-route.ts`
 * already 404s without it) — reusing it introduces NO new external
 * resource, NO new binding name, and NO new secret. D1 is one logical
 * database (not per-colo), and `admitAndIncrement` is a single `INSERT ...
 * ON CONFLICT DO UPDATE ... WHERE` statement — SQLite's single-writer
 * serialization for the underlying database makes this genuinely atomic
 * under concurrent callers (see
 * `../repositories/d1/document-ingress-admission.ts`'s own doc comment).
 * This satisfies §17 HONESTLY, for both axes, in production — not only at
 * a test-double layer while production itself runs on a best-effort
 * primitive.
 *
 * Trade-off accepted and documented, not hidden: a D1 round-trip carries
 * real per-request latency, unlike the native binding's locally-cached
 * "no meaningful latency" design. Acceptable here because this route
 * already performs a D1 read and a D1 write
 * (`artifactsRepository.getByContentHash` / `.create`) on every ACCEPTED
 * request; this adds one more D1 round-trip specifically to the gate that
 * decides whether that work — and the R2 write beside it — is even
 * allowed to happen, which is the entire point of this checkpoint.
 *
 * NOT solved by this module alone: `ARTIFACT_PHYSICAL_RECLAMATION_AFTER_
 * SECONDS`-based reclamation (`artifact-reclamation.ts`) is not wired to a
 * live Cron Trigger anywhere in this repository (confirmed by trace — no
 * `scheduled` export exists in `index.ts`; SUN-1222C0's own doc comment on
 * `artifact-reclamation.ts` already flagged this as a deliberately
 * deferred follow-up, not a new discovery). This module bounds the RATE at
 * which storage can be accepted (finite, computed below); the TOTAL
 * storage bound over an unbounded time horizon is only finite if
 * reclamation actually executes at least once per retention window. That
 * remaining precondition is out of THIS checkpoint's scope (see the
 * evidence report's §31/§32 for the honest, non-overstated framing of
 * what this specific fix does and does not eliminate).
 */
import type { DocumentIngressAdmissionRepository } from '../repositories/interfaces';

/** 24h — deliberately identical to `ARTIFACT_PHYSICAL_RECLAMATION_AFTER_
 * SECONDS` (`artifact-reclamation.ts`) so the "how many uploads may
 * accumulate before a reclamation pass could plausibly have cleared
 * earlier ones" question has one clean answer, not two windows that drift
 * against each other. */
export const DOCUMENT_INGRESS_ADMISSION_WINDOW_SECONDS = 86_400;

/** Generous for legitimate automated-buyer behavior (retries, re-uploads
 * across a busy integration day) while meaningfully bounding a single
 * abusive source: 50 × `DOCUMENT_UPLOAD_MAX_BYTES` (10,485,760 bytes) =
 * 524,288,000 bytes (500 MiB) worst-case retained per source per 24h
 * window — see the evidence report's §11/§20 math for the full
 * derivation and R2-cost sanity check. */
export const DOCUMENT_INGRESS_PER_SOURCE_LIMIT = 50;

/** Pre-launch commercial volume for `document_evidence_json.v2` is zero
 * real buyers today; 2,000/day gives generous headroom for real growth
 * while still being a hard, finite, budgetable ceiling against a
 * many-source botnet or NAT/source-rotation abuse pattern: 2,000 ×
 * 10,485,760 bytes = 20,971,520,000 bytes (~19.53 GiB) worst-case
 * standing storage if sustained at the cap indefinitely with reclamation
 * running reliably — at R2's ~$0.015/GB-month, roughly $0.29/month even
 * in that worst case (see evidence report §31). */
export const DOCUMENT_INGRESS_GLOBAL_LIMIT = 2_000;

export const DOCUMENT_INGRESS_GLOBAL_SCOPE_KEY = 'global';

/** How many past windows' rows to retain before opportunistic cleanup —
 * one extra window of slack so a request landing exactly at a window
 * boundary never races its own cleanup pass into deleting a row it is
 * about to read. */
const WINDOW_RETENTION_MULTIPLE = 2;

/** Conservative Retry-After for every rejection reason: the full window
 * length. This fixed-window design cannot cheaply expose "exact seconds
 * until YOUR row's window rolls over" without an extra read, and an
 * over-long Retry-After (client waits a bit longer than strictly
 * necessary) is a far safer failure mode than an optimistic one (client
 * retries too early and is rejected again). */
const RETRY_AFTER_SECONDS = DOCUMENT_INGRESS_ADMISSION_WINDOW_SECONDS;

export interface DocumentIngressAdmissionDecision {
  allowed: boolean;
  /** Present on every rejection. */
  retryAfterSeconds?: number;
  /** Internal-only — for logging/evidence. Never serialize this into an
   * HTTP response body (§13: no internal quota keys, raw IP identity, or
   * infrastructure IDs may be exposed to the caller). */
  scope?: 'per_source' | 'global' | 'limiter_unavailable';
}

export interface DocumentIngressAdmissionDeps {
  repository: DocumentIngressAdmissionRepository;
  nowMs: () => number;
}

function windowStartMs(nowMs: number, windowSeconds: number): number {
  const windowMs = windowSeconds * 1000;
  return Math.floor(nowMs / windowMs) * windowMs;
}

type AxisResult = { allowed: true } | { allowed: false; unavailable?: true };

async function checkAxis(
  deps: DocumentIngressAdmissionDeps,
  scope: string,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<AxisResult> {
  const now = deps.nowMs();
  const start = windowStartMs(now, windowSeconds);
  const windowKey = `${scope}:${key}:${start}`;

  const result = await deps.repository.admitAndIncrement(windowKey, scope, start, limit);
  if (!result.ok) {
    // §14: a repository failure (D1 unavailable/throws/malformed) fails
    // closed — never falls back to unlimited acceptance.
    return { allowed: false, unavailable: true };
  }

  // Opportunistic, best-effort cleanup. A failure here must never affect
  // this request's admission decision (already returned above via
  // `result`) — it only affects how promptly this table's own storage
  // shrinks back down, and the next request's cleanup pass catches
  // anything this one misses.
  await deps.repository.deleteWindowsOlderThan(
    start - windowSeconds * 1000 * WINDOW_RETENTION_MULTIPLE
  );

  return { allowed: result.value.admitted };
}

/**
 * The full two-axis (§10) admission check, run in this exact order:
 * per-source first, global second. A source that is already over ITS OWN
 * budget is rejected without ever touching the shared global counter, so
 * one abusive source cannot spend down the budget legitimate, diverse
 * traffic depends on (§12/§13's ordering rationale).
 */
export async function checkDocumentIngressAdmission(
  deps: DocumentIngressAdmissionDeps,
  sourceKey: string
): Promise<DocumentIngressAdmissionDecision> {
  const perSource = await checkAxis(
    deps,
    'source',
    sourceKey,
    DOCUMENT_INGRESS_PER_SOURCE_LIMIT,
    DOCUMENT_INGRESS_ADMISSION_WINDOW_SECONDS
  );
  if (!perSource.allowed) {
    return {
      allowed: false,
      scope: 'unavailable' in perSource ? 'limiter_unavailable' : 'per_source',
      retryAfterSeconds: RETRY_AFTER_SECONDS,
    };
  }

  const global = await checkAxis(
    deps,
    'global',
    DOCUMENT_INGRESS_GLOBAL_SCOPE_KEY,
    DOCUMENT_INGRESS_GLOBAL_LIMIT,
    DOCUMENT_INGRESS_ADMISSION_WINDOW_SECONDS
  );
  if (!global.allowed) {
    return {
      allowed: false,
      scope: 'unavailable' in global ? 'limiter_unavailable' : 'global',
      retryAfterSeconds: RETRY_AFTER_SECONDS,
    };
  }

  return { allowed: true };
}

/**
 * §7 — the ONLY trusted source identity: Cloudflare's own
 * `CF-Connecting-IP`, injected by Cloudflare's edge itself and never
 * overridable by a caller. `X-Forwarded-For`, `Forwarded`, and any other
 * header a caller can set are never consulted here —
 * `SOURCE_KEY_SPOOFABLE_BY_CALLER=NO` by construction (nothing to filter;
 * the function structurally never reads those headers at all), not by
 * denylisting spoofable values after the fact.
 *
 * Returns `null` if `CF-Connecting-IP` is absent or empty. The caller (the
 * route handler) must fail closed in that case exactly like a
 * limiter-unavailable response — this should never happen for a genuine
 * request through Cloudflare's real edge; a local/test harness supplies
 * the header directly (dependency injection at the request layer) rather
 * than this function weakening production trust to accommodate it, per
 * this checkpoint's own §7 instruction.
 */
export function extractDocumentIngressSourceKey(
  getHeader: (name: string) => string | undefined | null
): string | null {
  const raw = getHeader('cf-connecting-ip');
  if (!raw || raw.trim().length === 0) return null;
  return normalizeSourceKey(raw);
}

function normalizeIPv4Literal(value: string): string | null {
  const octets = value.split('.');
  if (octets.length !== 4) return null;
  const normalized: string[] = [];
  for (const octet of octets) {
    if (!/^\d{1,3}$/.test(octet)) return null;
    const n = Number(octet);
    if (n > 255) return null;
    normalized.push(String(n));
  }
  return normalized.join('.');
}

function stripLeadingZeros(group: string): string {
  const stripped = group.replace(/^0+(?=.)/, '');
  return stripped.length > 0 ? stripped : '0';
}

function canonicalizeIPv6(addr: string): string {
  // Strip a zone id (e.g. fe80::1%eth0) -- not part of address identity
  // for quota purposes.
  let working = addr.split('%')[0];

  // IPv4-mapped IPv6 (e.g. ::ffff:1.2.3.4) -- normalize the trailing IPv4
  // literal the same way a bare IPv4 address is normalized above, so
  // `::ffff:1.2.3.4` and `::ffff:001.002.003.004` collapse identically.
  const v4Mapped = working.match(/^([0-9a-f:]*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4Mapped) {
    const v4 = normalizeIPv4Literal(v4Mapped[2]);
    if (v4) working = `${v4Mapped[1]}${v4}`;
  }

  const hasDoubleColon = working.includes('::');
  const [head, tail] = hasDoubleColon ? working.split('::') : [working, undefined];
  const headGroups = head ? head.split(':').filter((g) => g.length > 0) : [];
  const tailGroups = tail !== undefined ? tail.split(':').filter((g) => g.length > 0) : [];

  if (hasDoubleColon) {
    const missing = 8 - (headGroups.length + tailGroups.length);
    const zeros = new Array(Math.max(missing, 0)).fill('0');
    return [...headGroups, ...zeros, ...tailGroups].map(stripLeadingZeros).join(':');
  }
  return [...headGroups, ...tailGroups].map(stripLeadingZeros).join(':');
}

/**
 * Canonicalizes an IPv4 or IPv6 literal so trivially-equivalent
 * representations of the same address (leading zeros, `::` shorthand,
 * IPv4-mapped IPv6, mixed case, a zone id) collapse to the same quota
 * identity (§8) — NOT a full RFC 5952 canonical-text implementation, only
 * a stable, collision-free key.
 */
export function normalizeSourceKey(rawIp: string): string {
  const trimmed = rawIp.trim().toLowerCase();
  if (trimmed.length === 0) return trimmed;
  if (!trimmed.includes(':')) {
    return normalizeIPv4Literal(trimmed) ?? trimmed;
  }
  return canonicalizeIPv6(trimmed);
}

/**
 * SUN-1222C-Q1R5 root-cause reproducer, SUN-1222C-Q1R6 fix regression.
 *
 * Authoritative Cloudflare Workflow step output for the real SUN-1222C-Q1
 * paid attempt (instance `siteborne-wf-a97a35ead180f908257562f41b6087a7ecbd885d2bb505df`,
 * step `invoke-executor-1`) proved `company_evidence_graph.v2` completed
 * cleanly with `result_class: "partial"` and
 * `limitations: ["sec-edgar company_submissions returned permanent_failure
 * for CIK 0000320193"]` -- a real, live SEC EDGAR HTTP response classified
 * terminal-non-retryable by `classifyTerminalHttpStatus` (SUN-1222C2-Q1-R2),
 * most consistent with SEC's own documented behavior of rejecting automated
 * requests that lack a compliant declared `User-Agent`
 * (https://www.sec.gov/os/accessing-edgar-data).
 *
 * `SecSubmissionsAdapter.fetchAndNormalize` (submissions-adapter.ts) DOES
 * attach the SUN-1222C2-Q1-R1 canonical User-Agent
 * (`SEC_EDGAR_DECLARED_USER_AGENT = 'SITEBORNE hello@siteborne.com'`) on
 * every call: `this.httpClient.fetchJson(url, { headers: { 'User-Agent':
 * ... } })`. In production that `httpClient` is a `ModalSafeEgressClient`
 * (`company-evidence-graph-v2-cdp-composition.ts`), NOT a direct `fetch()`.
 * `SUN-1222C-Q1R5` proved, with zero network access, that
 * `ModalSafeEgressClient.fetch()` accepted a `RequestInit.headers` argument
 * but never read it: the JSON body it POSTed to the Modal executor
 * (`WebctxFetchRequest`, `services/webctx-safe-egress/.../schemas.py`) had
 * no field for outgoing request headers at all, and the executor's own
 * `_fetch_one_hop` unconditionally hardcoded its own `user-agent`. The R1
 * User-Agent was constructed correctly at every layer up to
 * `ModalSafeEgressClient` and then silently discarded before the real
 * outbound request to `data.sec.gov`.
 *
 * SUN-1222C-Q1R6 closes this: `ModalSafeEgressClient` now extracts an
 * explicit allowlisted subset of `RequestInit.headers`
 * (`APPROVED_FORWARD_HEADERS` in `modal-safe-egress-client.ts`) and sends it
 * as `WebctxFetchRequest.approved_headers`; `schemas.py` independently
 * re-validates the same allowlist server-side; `executor.py`'s
 * `_fetch_one_hop` applies it, overriding (never appending to) its own
 * default of the same header name, while `_RESERVED_HEADER_KEYS` remains
 * permanently non-overridable. This file now asserts the FIXED contract
 * (previously asserted the gap; see git history for the pre-fix RED
 * proof) plus the security posture that makes forwarding safe.
 */
import { describe, expect, it, vi } from 'vitest';
import { ModalSafeEgressClient } from '../http/modal-safe-egress-client';

const CONFIG = {
  endpointUrl: 'https://fake-workspace--siteborne-webctx-safe-egress-fetch.modal.run',
  proxyKey: 'wk-test-key',
  proxySecret: 'ws-test-secret',
};

function jsonFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

function successBody() {
  return {
    result_class: 'success',
    http_status: 200,
    final_url: 'https://data.sec.gov/submissions/CIK0000320193.json',
    redirect_chain: [],
    headers: { 'content-type': 'application/json' },
    content_base64: btoa('{}'),
    content_type: 'application/json',
    truncated: false,
    elapsed_ms: 42,
  };
}

async function bodyOf(fetchImpl: ReturnType<typeof jsonFetch>): Promise<Record<string, unknown>> {
  const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe('SUN-1222C-Q1R6: ModalSafeEgressClient forwards the allowlisted approved headers', () => {
  it('GREEN: a caller-supplied User-Agent header (SecSubmissionsAdapter shape) reaches the executor request body', async () => {
    const fetchImpl = jsonFetch(200, successBody());
    const client = new ModalSafeEgressClient({ ...CONFIG, fetchImpl });

    // Exactly the call shape `SecSubmissionsAdapter.fetchAndNormalize` makes
    // via `SecureHttpClient.fetchJson` -- see submissions-adapter.ts:325-327.
    await client.fetch('https://data.sec.gov/submissions/CIK0000320193.json', {
      headers: { 'User-Agent': 'SITEBORNE hello@siteborne.com' },
    });

    const sentBody = await bodyOf(fetchImpl);
    expect(sentBody.approved_headers).toEqual({ 'user-agent': 'SITEBORNE hello@siteborne.com' });
  });

  it('GREEN: PublicHttpAdapter-shape conditional-GET headers (If-None-Match / If-Modified-Since) both forward', async () => {
    const fetchImpl = jsonFetch(200, successBody());
    const client = new ModalSafeEgressClient({ ...CONFIG, fetchImpl });

    await client.fetch('https://example.com/resource', {
      headers: { 'If-None-Match': '"abc123"', 'If-Modified-Since': 'Wed, 21 Oct 2015 07:28:00 GMT' },
    });

    const sentBody = await bodyOf(fetchImpl);
    expect(sentBody.approved_headers).toEqual({
      'if-none-match': '"abc123"',
      'if-modified-since': 'Wed, 21 Oct 2015 07:28:00 GMT',
    });
  });

  it('a header not on the allowlist is silently dropped, not forwarded and not erroring', async () => {
    const fetchImpl = jsonFetch(200, successBody());
    const client = new ModalSafeEgressClient({ ...CONFIG, fetchImpl });

    await client.fetch('https://example.com/resource', {
      headers: { 'X-Custom-Debug': 'should-not-forward', 'User-Agent': 'SITEBORNE hello@siteborne.com' },
    });

    const sentBody = await bodyOf(fetchImpl);
    expect(sentBody.approved_headers).toEqual({ 'user-agent': 'SITEBORNE hello@siteborne.com' });
    expect(JSON.stringify(sentBody)).not.toContain('X-Custom-Debug');
    expect(JSON.stringify(sentBody)).not.toContain('should-not-forward');
  });

  it.each(['Authorization', 'Cookie', 'Proxy-Authorization', 'Host', 'Connection', 'X-Forwarded-For', 'Origin'])(
    'dangerous header %s is never forwarded, even when explicitly supplied',
    async (dangerousHeader) => {
      const fetchImpl = jsonFetch(200, successBody());
      const client = new ModalSafeEgressClient({ ...CONFIG, fetchImpl });

      await client.fetch('https://example.com/resource', {
        headers: { [dangerousHeader]: 'attempted-value' },
      });

      const sentBody = await bodyOf(fetchImpl);
      expect(sentBody.approved_headers ?? {}).toEqual({});
      expect(JSON.stringify(sentBody)).not.toContain('attempted-value');
    }
  );

  it('when no approved header is supplied, the body omits approved_headers entirely (pre-fix wire shape preserved)', async () => {
    const fetchImpl = jsonFetch(200, successBody());
    const client = new ModalSafeEgressClient({ ...CONFIG, fetchImpl });

    await client.fetch('https://example.com/resource');

    const sentBody = await bodyOf(fetchImpl);
    expect(sentBody.approved_headers).toBeUndefined();
    expect(Object.keys(sentBody).sort()).toEqual(
      [
        'correlation_id',
        'deadline_ms',
        'max_response_bytes',
        'request_version',
        'retrieval_mode',
        'security_policy_version',
        'single_hop',
        'target_url',
      ].sort()
    );
  });

  it('rejects a CRLF header-injection attempt in an approved header value before ever calling fetch', async () => {
    const fetchImpl = jsonFetch(200, successBody());
    const client = new ModalSafeEgressClient({ ...CONFIG, fetchImpl });

    await expect(
      client.fetch('https://example.com/resource', {
        headers: { 'User-Agent': 'evil\r\nX-Injected: true' },
      })
    ).rejects.toThrow(/WEBCTX_URL_VALIDATION_FAILED/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects an oversized approved header value before ever calling fetch', async () => {
    const fetchImpl = jsonFetch(200, successBody());
    const client = new ModalSafeEgressClient({ ...CONFIG, fetchImpl });

    await expect(
      client.fetch('https://example.com/resource', {
        headers: { 'User-Agent': 'x'.repeat(513) },
      })
    ).rejects.toThrow(/WEBCTX_URL_VALIDATION_FAILED/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

/**
 * SUN-1222C-Q1R5 root-cause reproducer.
 *
 * Authoritative Cloudflare Workflow step output for the real SUN-1222C-Q1
 * paid attempt (instance `siteborne-wf-a97a35ead180f908257562f41b6087a7ecbd885d2bb505df`,
 * step `invoke-executor-1`) proves `company_evidence_graph.v2` completed
 * cleanly with `result_class: "partial"` and
 * `limitations: ["sec-edgar company_submissions returned permanent_failure
 * for CIK 0000320193"]` -- a real, live SEC EDGAR HTTP response classified
 * terminal-non-retryable by `classifyTerminalHttpStatus`
 * (SUN-1222C2-Q1-R2), most consistent with SEC's own documented behavior
 * of rejecting automated requests that lack a compliant declared
 * `User-Agent` (https://www.sec.gov/os/accessing-edgar-data).
 *
 * `SecSubmissionsAdapter.fetchAndNormalize` (submissions-adapter.ts) DOES
 * attach the SUN-1222C2-Q1-R1 canonical User-Agent
 * (`SEC_EDGAR_DECLARED_USER_AGENT = 'SITEBORNE hello@siteborne.com'`) on
 * every call: `this.httpClient.fetchJson(url, { headers: { 'User-Agent':
 * ... } })`. In production that `httpClient` is a `ModalSafeEgressClient`
 * (`company-evidence-graph-v2-cdp-composition.ts`), NOT a direct
 * `fetch()` -- and this reproduces, with zero network access, that
 * `ModalSafeEgressClient.fetch()` accepts a `RequestInit.headers` argument
 * but never reads it: the JSON body it POSTs to the Modal executor
 * (`WebctxFetchRequest`, `services/webctx-safe-egress/.../schemas.py`) has
 * no field for outgoing request headers at all (confirmed by direct
 * source read: `WebctxFetchRequest` lists exactly
 * request_version/correlation_id/target_url/retrieval_mode/deadline_ms/
 * max_response_bytes/security_policy_version/single_hop, and
 * `model_config = ConfigDict(extra="forbid")` would reject an unknown
 * field even if one were added on this side alone).
 *
 * Net effect: the R1 User-Agent is constructed correctly at every layer
 * up to `ModalSafeEgressClient`, and is then silently discarded before
 * the real outbound request to `data.sec.gov` -- SEC never sees it. This
 * is a genuine, deterministic, pre-existing (SUN-1221E5Q6G-era) transport
 * gap, not a SUN-1222C2 regression and not a transient SEC-side fault.
 * Fixing it requires a coordinated change to BOTH sides of this contract
 * (the Python `WebctxFetchRequest` schema and the executor's own outbound
 * fetch call, plus this TypeScript client) and a Modal redeploy -- out of
 * this read-only diagnosis checkpoint's scope; scoped to
 * SUN-1222C-Q1R6-FIX-AND-QUALIFY.
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

describe('SUN-1222C-Q1R5: ModalSafeEgressClient silently drops caller-supplied request headers', () => {
  it('RED: a caller-supplied User-Agent header never appears anywhere in the request Modal actually receives', async () => {
    const fetchImpl = jsonFetch(200, successBody());
    const client = new ModalSafeEgressClient({ ...CONFIG, fetchImpl });

    // Exactly the call shape `SecSubmissionsAdapter.fetchAndNormalize` makes
    // via `SecureHttpClient.fetchJson` -- see submissions-adapter.ts:325-327.
    await client.fetch('https://data.sec.gov/submissions/CIK0000320193.json', {
      headers: { 'User-Agent': 'SITEBORNE hello@siteborne.com' },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];

    // The outer HTTP call TO Modal never carries it as a real header either
    // (it would be nonsensical there -- Modal isn't the target site -- but
    // asserting this exhaustively rules out every place it could have
    // leaked through).
    const outerHeaders = init.headers as Record<string, string>;
    expect(outerHeaders['User-Agent']).toBeUndefined();
    expect(outerHeaders['user-agent']).toBeUndefined();

    // The JSON body is the ONLY channel that could carry it forward to the
    // executor for use against the real target site -- and it doesn't.
    const sentBody = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sentBody.headers).toBeUndefined();
    expect(JSON.stringify(sentBody)).not.toContain('User-Agent');
    expect(JSON.stringify(sentBody)).not.toContain('SITEBORNE');

    // Documents the exact current (buggy) request shape sent to Modal, so
    // a future fix's diff against this reproducer is unambiguous.
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
});

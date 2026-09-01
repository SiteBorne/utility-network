/**
 * SUN-1221E5Q6G — TDD for `ModalSafeEgressClient`. Every test injects a
 * fake `fetchImpl` (never a real network call, never real Modal
 * credentials) so this suite runs fully offline; the real Modal endpoint
 * is only ever reached via the ONE authorized non-economic live
 * verification call this checkpoint's directive gates separately.
 */
import { describe, expect, it, vi } from 'vitest';
import { ModalSafeEgressClient } from '../http/modal-safe-egress-client';
import { classifyGenericAdapterErrorReason } from '../errors';

const CONFIG = {
  endpointUrl: 'https://fake-workspace--siteborne-webctx-safe-egress-fetch.modal.run',
  proxyKey: 'wk-test-key',
  proxySecret: 'ws-test-secret',
};

function jsonFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

function successBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    result_class: 'success',
    http_status: 200,
    final_url: 'https://example.com/',
    redirect_chain: [],
    headers: { 'content-type': 'text/html' },
    content_base64: btoa('hello world'),
    content_type: 'text/html',
    truncated: false,
    elapsed_ms: 42,
    ...overrides,
  };
}

describe('ModalSafeEgressClient — request shape', () => {
  it('sends single_hop=true, GET-only semantics, and the correct auth headers', async () => {
    const fetchImpl = jsonFetch(200, successBody());
    const client = new ModalSafeEgressClient({ ...CONFIG, fetchImpl });

    await client.fetch('https://example.com/');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(CONFIG.endpointUrl);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Modal-Key']).toBe(CONFIG.proxyKey);
    expect(headers['Modal-Secret']).toBe(CONFIG.proxySecret);
    const body = JSON.parse(init.body as string);
    expect(body.single_hop).toBe(true);
    expect(body.retrieval_mode).toBe('direct');
    expect(body.target_url).toBe('https://example.com/');
    expect(typeof body.correlation_id).toBe('string');
    expect(body.correlation_id.length).toBeGreaterThan(0);
  });

  it('rejects a non-GET method before ever calling the executor', async () => {
    const fetchImpl = jsonFetch(200, successBody());
    const client = new ModalSafeEgressClient({ ...CONFIG, fetchImpl });

    await expect(client.fetch('https://example.com/', { method: 'POST' })).rejects.toThrow(
      /WEBCTX_URL_VALIDATION_FAILED/
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('ModalSafeEgressClient — success mapping', () => {
  it('reconstructs a Response with status/headers/body from the executor success payload', async () => {
    const fetchImpl = jsonFetch(200, successBody({ http_status: 200, headers: { 'content-type': 'text/plain' } }));
    const client = new ModalSafeEgressClient({ ...CONFIG, fetchImpl });

    const response = await client.fetch('https://example.com/');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/plain');
    expect(await response.text()).toBe('hello world');
  });

  it('reconstructs a raw 3xx response verbatim (never follows it itself)', async () => {
    const fetchImpl = jsonFetch(
      200,
      successBody({
        http_status: 302,
        headers: { location: 'https://example.com/b' },
        content_base64: '',
      })
    );
    const client = new ModalSafeEgressClient({ ...CONFIG, fetchImpl });

    const response = await client.fetch('https://example.com/a');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://example.com/b');
  });
});

describe('ModalSafeEgressClient — failure mapping preserves target-site WEBCTX_* codes', () => {
  it('maps an executor-classified target failure to the SAME reason code toAdapterResult already recognizes', async () => {
    const fetchImpl = jsonFetch(200, {
      result_class: 'failure',
      reason_code: 'WEBCTX_HTTP_PREMATURE_EOF',
      stage: 'response_read',
      message: 'connection closed before response headers completed',
      elapsed_ms: 6,
    });
    const client = new ModalSafeEgressClient({ ...CONFIG, fetchImpl });

    let thrown: Error | undefined;
    try {
      await client.fetch('https://example.com/');
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown).toBeDefined();
    expect(classifyGenericAdapterErrorReason(thrown!)).toBe('WEBCTX_HTTP_PREMATURE_EOF');
  });

  it('maps WEBCTX_SSRF_BLOCKED through unchanged', async () => {
    const fetchImpl = jsonFetch(200, {
      result_class: 'failure',
      reason_code: 'WEBCTX_SSRF_BLOCKED',
      stage: 'dns_resolution',
      message: 'prohibited_or_mixed_dns_answer',
      elapsed_ms: 3,
    });
    const client = new ModalSafeEgressClient({ ...CONFIG, fetchImpl });

    await expect(client.fetch('https://internal.example/')).rejects.toThrow(/WEBCTX_SSRF_BLOCKED/);
  });
});

describe('ModalSafeEgressClient — executor-transport-layer failures are distinct from target-site failures', () => {
  it('network failure reaching the executor classifies as WEBCTX_EXECUTOR_UNAVAILABLE', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const client = new ModalSafeEgressClient({ ...CONFIG, fetchImpl });

    let thrown: Error | undefined;
    try {
      await client.fetch('https://example.com/');
    } catch (err) {
      thrown = err as Error;
    }
    expect(classifyGenericAdapterErrorReason(thrown!)).toBe('WEBCTX_EXECUTOR_UNAVAILABLE');
  });

  it('401 from the executor classifies as WEBCTX_EXECUTOR_AUTH_FAILED (wrong/missing proxy credentials)', async () => {
    const fetchImpl = vi.fn(async () => new Response('Unauthorized', { status: 401 })) as unknown as typeof fetch;
    const client = new ModalSafeEgressClient({ ...CONFIG, fetchImpl });

    let thrown: Error | undefined;
    try {
      await client.fetch('https://example.com/');
    } catch (err) {
      thrown = err as Error;
    }
    expect(classifyGenericAdapterErrorReason(thrown!)).toBe('WEBCTX_EXECUTOR_AUTH_FAILED');
  });

  it('403 from the executor also classifies as WEBCTX_EXECUTOR_AUTH_FAILED', async () => {
    const fetchImpl = vi.fn(async () => new Response('Forbidden', { status: 403 })) as unknown as typeof fetch;
    const client = new ModalSafeEgressClient({ ...CONFIG, fetchImpl });

    await expect(client.fetch('https://example.com/')).rejects.toThrow(/WEBCTX_EXECUTOR_AUTH_FAILED/);
  });

  it('a 5xx from the executor classifies as WEBCTX_EXECUTOR_UNAVAILABLE, never as a target-site code', async () => {
    const fetchImpl = vi.fn(async () => new Response('Internal Error', { status: 500 })) as unknown as typeof fetch;
    const client = new ModalSafeEgressClient({ ...CONFIG, fetchImpl });

    let thrown: Error | undefined;
    try {
      await client.fetch('https://example.com/');
    } catch (err) {
      thrown = err as Error;
    }
    expect(classifyGenericAdapterErrorReason(thrown!)).toBe('WEBCTX_EXECUTOR_UNAVAILABLE');
  });

  it('a malformed (non-JSON) executor response body classifies as WEBCTX_EXECUTOR_UNAVAILABLE', async () => {
    const fetchImpl = vi.fn(async () => new Response('not json', { status: 200 })) as unknown as typeof fetch;
    const client = new ModalSafeEgressClient({ ...CONFIG, fetchImpl });

    let thrown: Error | undefined;
    try {
      await client.fetch('https://example.com/');
    } catch (err) {
      thrown = err as Error;
    }
    expect(classifyGenericAdapterErrorReason(thrown!)).toBe('WEBCTX_EXECUTOR_UNAVAILABLE');
  });
});

describe('ModalSafeEgressClient — never leaks credentials into thrown errors', () => {
  it('proxy secret never appears in any thrown error message', async () => {
    const fetchImpl = vi.fn(async () => new Response('Unauthorized', { status: 401 })) as unknown as typeof fetch;
    const client = new ModalSafeEgressClient({ ...CONFIG, proxySecret: 'super-secret-value-xyz', fetchImpl });

    let thrown: Error | undefined;
    try {
      await client.fetch('https://example.com/');
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown?.message).not.toContain('super-secret-value-xyz');
  });
});

// SUN-1221E6R-H2B2-R2 — the default `max_response_bytes` this client sends
// must never exceed the authoritative Modal-side bound declared by
// `services/webctx-safe-egress/src/webctx_safe_egress/schemas.py`'s
// `WebctxFetchRequest.max_response_bytes: int = Field(gt=0, le=10_000_000)`.
// This is a real, load-bearing production defect: `10 * 1024 * 1024` ===
// 10,485,760, which is 485,760 bytes ABOVE that Pydantic `le` bound, so
// Modal rejects every single request with an HTTP 400 request-schema
// validation error before ever attempting the target fetch — proven against
// real Modal access logs in SUN-1221E6R-H2B2-D1 (evidence commit `1440b5b`).
const MODAL_AUTHORITATIVE_MAX_RESPONSE_BYTES = 10_000_000;

describe('ModalSafeEgressClient — Modal max_response_bytes contract (SUN-1221E6R-H2B2-R2)', () => {
  it('default request body never exceeds the authoritative Modal schema bound', async () => {
    const fetchImpl = jsonFetch(200, successBody());
    const client = new ModalSafeEgressClient({ ...CONFIG, fetchImpl });

    await client.fetch('https://example.com/');

    const sentBody = JSON.parse((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(sentBody.max_response_bytes).toBeLessThanOrEqual(MODAL_AUTHORITATIVE_MAX_RESPONSE_BYTES);
  });

  it('default request body sends exactly the canonical production value 10_000_000', async () => {
    const fetchImpl = jsonFetch(200, successBody());
    const client = new ModalSafeEgressClient({ ...CONFIG, fetchImpl });

    await client.fetch('https://example.com/');

    const sentBody = JSON.parse((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(sentBody.max_response_bytes).toBe(MODAL_AUTHORITATIVE_MAX_RESPONSE_BYTES);
  });
});

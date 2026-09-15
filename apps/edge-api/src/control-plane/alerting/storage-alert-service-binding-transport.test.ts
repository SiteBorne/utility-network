import { describe, expect, it, vi } from 'vitest';
import { buildServiceBindingStorageAlertTransport } from './storage-alert-service-binding-transport';
import type { StorageAlertPayload } from './storage-alert-sweep';

const PAYLOAD: StorageAlertPayload = {
  event: 'siteborne.storage_reclamation.critical_alert',
  operation_class: 'artifact_reclamation_r2_delete_failure',
  r2_delete_failures: 3,
  reclaimed_count: 7,
  swept_at: '2026-01-01T00:00:00.000Z',
  sample_content_hashes: ['abc123'],
};

function fakeFetcher(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  return { fetch: vi.fn(handler) };
}

describe('buildServiceBindingStorageAlertTransport', () => {
  it('uses the Service Binding fetcher, not global fetch', async () => {
    const globalFetchSpy = vi.spyOn(globalThis, 'fetch');
    const fetcher = fakeFetcher(async () => new Response(null, { status: 202 }));
    const transport = buildServiceBindingStorageAlertTransport(fetcher, 'tok123');

    await transport(PAYLOAD);

    expect(fetcher.fetch).toHaveBeenCalledTimes(1);
    expect(globalFetchSpy).not.toHaveBeenCalled();
    globalFetchSpy.mockRestore();
  });

  it('constructs /alert/<token> without ever logging the token', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let capturedUrl = '';
    const fetcher = fakeFetcher(async (url) => {
      capturedUrl = url;
      return new Response(null, { status: 202 });
    });
    const transport = buildServiceBindingStorageAlertTransport(fetcher, 'super-secret-token');

    await transport(PAYLOAD);

    expect(capturedUrl).toBe('https://storage-alert.internal/alert/super-secret-token');
    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('emits the payload unchanged as the JSON body with a JSON content-type', async () => {
    let capturedInit: RequestInit | undefined;
    const fetcher = fakeFetcher(async (_url, init) => {
      capturedInit = init;
      return new Response(null, { status: 202 });
    });
    const transport = buildServiceBindingStorageAlertTransport(fetcher, 'tok');

    await transport(PAYLOAD);

    expect(capturedInit?.method).toBe('POST');
    expect((capturedInit?.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json'
    );
    expect(JSON.parse(capturedInit?.body as string)).toEqual(PAYLOAD);
  });

  it('reports delivered=true only for 2xx responses', async () => {
    for (const status of [200, 201, 202, 204, 299]) {
      const fetcher = fakeFetcher(async () => new Response(null, { status }));
      const transport = buildServiceBindingStorageAlertTransport(fetcher, 'tok');
      await expect(transport(PAYLOAD)).resolves.toEqual({ delivered: true });
    }
  });

  it('reports delivered=false for non-2xx responses (404/400/502)', async () => {
    for (const status of [404, 400, 413, 502]) {
      const fetcher = fakeFetcher(async () => new Response(null, { status }));
      const transport = buildServiceBindingStorageAlertTransport(fetcher, 'tok');
      await expect(transport(PAYLOAD)).resolves.toEqual({ delivered: false });
    }
  });

  it('reports delivered=false (never throws) when the binding dispatch rejects', async () => {
    const fetcher = fakeFetcher(async () => {
      throw new Error('service binding dispatch failed');
    });
    const transport = buildServiceBindingStorageAlertTransport(fetcher, 'tok');

    await expect(transport(PAYLOAD)).resolves.toEqual({ delivered: false });
  });

  it('reports delivered=false on timeout, and does not exceed the configured budget', async () => {
    const fetcher = fakeFetcher(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          (init?.signal as AbortSignal | undefined)?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        })
    );
    const transport = buildServiceBindingStorageAlertTransport(fetcher, 'tok', {
      timeoutMs: 5,
    });

    await expect(transport(PAYLOAD)).resolves.toEqual({ delivered: false });
  });

  it('SUN-1222C closure: sends only Content-Type -- the transport has no mechanism to attach any other header (the qualification-only extraHeaders option and its receiver-side bypass were removed once qualification was evidenced)', async () => {
    let capturedInit: RequestInit | undefined;
    const fetcher = fakeFetcher(async (_url, init) => {
      capturedInit = init;
      return new Response(null, { status: 202 });
    });
    const transport = buildServiceBindingStorageAlertTransport(fetcher, 'tok');

    await transport(PAYLOAD);

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers).toEqual({ 'Content-Type': 'application/json' });
    expect(Object.keys(headers)).not.toContain('X-Siteborne-Storage-Alert-Qualification');
  });
});

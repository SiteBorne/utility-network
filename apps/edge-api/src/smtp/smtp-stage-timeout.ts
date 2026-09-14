/**
 * SUN-1222C-SMTP-TIMEOUT-INSTRUMENTATION — shared bounded-wait helper used
 * by both `ionos-smtp-transport.ts` (the real, message-sending transport)
 * and `ionos-smtp-diagnostic.ts` (the non-delivery connectivity probe).
 *
 * Motivation: `sendStorageAlertViaIonosSmtp`'s protocol sequence previously
 * had no timeout of its own anywhere in it -- every `await` (connect,
 * response read, `startTls()`) could hang indefinitely. In production this
 * was eventually cut off only by the *caller's* Service Binding
 * `AbortController` (`storage-alert-service-binding-transport.ts`,
 * `DEFAULT_TIMEOUT_MS = 10_000`), which does not give this module any
 * chance to close its own socket cleanly or report which protocol stage was
 * actually stuck -- the callee is simply canceled by the platform once the
 * caller's fetch is aborted. `withTimeout` gives each stage (and, wrapped
 * around the whole sequence, the operation as a whole) its own bounded
 * wait, comfortably inside that outer 10s budget, so a hung remote can
 * never consume more than a known, small amount of time and this module can
 * always close its own socket and return/throw a deterministic result
 * itself rather than being force-canceled from outside.
 */

/** SUN-1222C-SMTP-ROOT-CAUSE: the bounded-cleanup budget shared by both
 * `ionos-smtp-transport.ts` (the real send path) and
 * `ionos-smtp-diagnostic.ts` (the non-delivery probe) for their identical
 * `finally` blocks -- `reader.cancel()` and `currentSocket.close()`, each
 * raced against this budget via `withTimeout`, so a black-holed or
 * half-upgraded TLS connection can never prevent either function from
 * actually `return`ing/`throw`ing its own result. Lives here (rather than
 * in either module) specifically so `ionos-smtp-transport.ts` never has to
 * import from `ionos-smtp-diagnostic.ts` -- that direction already goes
 * the other way (the diagnostic module imports `hasStartTls`/`writeLine`
 * from the transport), and this file has no dependency on either. */
export const CLEANUP_TIMEOUT_MS = 1_000;

/** Thrown when a `withTimeout`-wrapped operation does not settle within its
 * budget. Deliberately carries only the caller-supplied `stage` label --
 * never anything about the awaited operation's own state -- so it can
 * never leak a secret regardless of what was being awaited. */
export class StageTimeoutError extends Error {
  constructor(readonly stage: string) {
    super(`${stage}: timed out`);
    this.name = 'StageTimeoutError';
  }
}

/**
 * Races `promise` against a `timeoutMs` timer. On timeout, rejects with a
 * `StageTimeoutError` naming `stage` -- the original `promise` is left
 * exactly as it was (this function cannot cancel it), so callers that need
 * to release the resource it is waiting on (a socket read, most commonly)
 * must do so themselves once `withTimeout` rejects, typically by closing
 * the socket, which causes any pending read on it to settle on its own.
 */
export async function withTimeout<T>(
  stage: string,
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StageTimeoutError(stage)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

const WORKFLOW_INSTANCE_ID_PREFIX = 'siteborne-wf-';
const WORKFLOW_INSTANCE_ID_HASH_HEX_LENGTH = 48;

/**
 * Derive the stable Cloudflare Workflow instance ID for one payment.
 *
 * Web Crypto is asynchronous, so the frozen SHA-256 algorithm necessarily
 * returns a promise even though the plan's shorthand interface omits it.
 */
export async function deriveWorkflowInstanceId(
  paymentIdentifier: string,
): Promise<string> {
  if (typeof paymentIdentifier !== 'string' || paymentIdentifier.length === 0) {
    throw new TypeError('paymentIdentifier must be a non-empty string');
  }

  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(paymentIdentifier),
  );
  const hashHex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');

  return `${WORKFLOW_INSTANCE_ID_PREFIX}${hashHex.slice(
    0,
    WORKFLOW_INSTANCE_ID_HASH_HEX_LENGTH,
  )}`;
}

import { deriveWorkflowInstanceId } from './instance-id';

function requirePaymentIdentifier(paymentIdentifier: string): void {
  if (typeof paymentIdentifier !== 'string' || paymentIdentifier.length === 0) {
    throw new TypeError('paymentIdentifier must be a non-empty string');
  }
}

export async function workflowInstanceIdempotencyKey(
  paymentIdentifier: string,
): Promise<string> {
  requirePaymentIdentifier(paymentIdentifier);
  return await deriveWorkflowInstanceId(paymentIdentifier);
}

export function executorInvocationIdempotencyKey(
  paymentIdentifier: string,
): string {
  requirePaymentIdentifier(paymentIdentifier);
  return `${paymentIdentifier}:executor`;
}

export function pccIdempotencyKey(paymentIdentifier: string): string {
  requirePaymentIdentifier(paymentIdentifier);
  return `${paymentIdentifier}:pcc`;
}

export function settlementIdempotencyKey(paymentIdentifier: string): string {
  requirePaymentIdentifier(paymentIdentifier);
  return `${paymentIdentifier}:settlement`;
}

export function resultPersistenceIdempotencyKey(
  paymentIdentifier: string,
): string {
  requirePaymentIdentifier(paymentIdentifier);
  return `${paymentIdentifier}:result`;
}

export function receiptPersistenceIdempotencyKey(
  paymentIdentifier: string,
): string {
  requirePaymentIdentifier(paymentIdentifier);
  return `${paymentIdentifier}:receipt`;
}

export function terminalEventIdempotencyKey(paymentIdentifier: string): string {
  requirePaymentIdentifier(paymentIdentifier);
  return `${paymentIdentifier}:terminal`;
}

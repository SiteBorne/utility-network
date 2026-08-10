/**
 * x402 protocol version binding. SITEBORNE targets x402 V2 exclusively —
 * V1 shapes (`x402Version: 1`, flat `PaymentRequirementsV1` with
 * `maxAmountRequired`/`resource: string`) are recognized only well enough
 * to reject them explicitly and truthfully, never silently accepted as V2.
 * See docs/decisions/0041-x402-v2-protocol-boundary.md and
 * fixtures/x402-spec-baseline.json for the recorded upstream baseline this
 * binding is pinned against.
 */
import { x402Version as OFFICIAL_X402_VERSION } from '@x402/core';

/** The only protocol version this package constructs or accepts. Sourced
 * from @x402/core's own exported constant rather than a SITEBORNE-local
 * literal, so a future upstream major bump is visible here rather than
 * silently drifting. */
export const SUPPORTED_X402_VERSION = OFFICIAL_X402_VERSION;

export type SupportedVersionCheck =
  | { supported: true; version: number }
  | { supported: false; version: unknown; reason: 'not_a_number' | 'unsupported_version' };

/** Fails closed: anything other than the exact supported version number is
 * `supported: false`, including V1 (`1`), a future V3, non-numeric input,
 * `NaN`, and `undefined`. Never silently treats an unrecognized version as
 * V2. */
export function checkSupportedVersion(version: unknown): SupportedVersionCheck {
  if (typeof version !== 'number' || !Number.isFinite(version)) {
    return { supported: false, version, reason: 'not_a_number' };
  }
  if (version !== SUPPORTED_X402_VERSION) {
    return { supported: false, version, reason: 'unsupported_version' };
  }
  return { supported: true, version };
}

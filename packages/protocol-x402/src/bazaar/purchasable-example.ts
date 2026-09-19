/**
 * PRODUCTION-ECONOMICS-DISCOVERY-01 -- kept out of `frozen-inputs.ts` on
 * purpose: that module is imported by build-time scripts run under plain `tsx`
 * (e.g. the input-validator drift check), where a named import from the
 * `@siteborne/pricing` CommonJS package cannot see its `export *` re-exports.
 * `frozen-inputs.ts` therefore stays free of any pricing import.
 */
import { buildEconomicOffer } from '@siteborne/pricing';
import type { SiteborneServiceId } from '../types';
import { frozenInputExample } from './frozen-inputs';

/** The advertised example a buyer may actually purchase. The frozen schema's
 * `examples[0]` for `web_context_verified` selects `retrieval_mode: rendered`,
 * a mode that has a governed price but no production implementation; a
 * discovery surface must never show an unavailable mode as the sample call.
 * Where the frozen example selects an unavailable mode, only that selector is
 * replaced by the canonical offer's default (available) mode -- the frozen
 * example is otherwise returned unchanged, and the frozen schema itself is
 * never modified. */
export function purchasableInputExample(serviceId: SiteborneServiceId): unknown {
  const example = frozenInputExample(serviceId);
  const offer = buildEconomicOffer(serviceId);
  const field = offer.modeSelectorField;
  if (!field || example === null || typeof example !== 'object' || Array.isArray(example)) {
    return example;
  }
  const record = example as Record<string, unknown>;
  const selected = offer.modes.find((mode) => mode.mode === record[field]);
  if (selected && !selected.available) return { ...record, [field]: offer.defaultMode };
  return example;
}

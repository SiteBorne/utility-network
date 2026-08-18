// Hand-written type declaration for the generated
// `output-validators.generated.js` -- AJV standalone output is plain JS
// with no bundled `.d.ts`. Kept minimal and stable: the generated file's
// only public contract this repository consumes is
// `outputValidatorsById`. See
// `apps/edge-api/scripts/generate-input-validators.mts`.
import type { ValidateFunction } from 'ajv';

export const outputValidatorsById: Record<string, ValidateFunction>;

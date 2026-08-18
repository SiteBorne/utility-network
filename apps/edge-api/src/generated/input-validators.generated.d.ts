// Hand-written type declaration for the generated
// `input-validators.generated.js` -- AJV standalone output is plain JS
// with no bundled `.d.ts`. Kept minimal and stable: the generated file's
// only public contract this repository consumes is `inputValidatorsById`.
// See `apps/edge-api/scripts/generate-input-validators.mts`.
import type { ValidateFunction } from 'ajv';

export const inputValidatorsById: Record<string, ValidateFunction>;

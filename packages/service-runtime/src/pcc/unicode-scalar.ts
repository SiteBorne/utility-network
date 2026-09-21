/**
 * Unicode-scalar safety for semantic material that reaches hashing/signing.
 *
 * RFC 8785 operates on Unicode scalar values. A JavaScript string can also
 * hold unpaired UTF-16 surrogates, which the repository's Python RFC 8785
 * implementation rejects — so bytes signed from such a string would not be
 * portable across the two governed verifier runtimes. The semantic-finalization
 * boundary rejects them before any hash or signature is computed, rather than
 * rewriting the shared canonicalizer.
 */

export class InvalidUnicodeScalarError extends Error {
  constructor(public readonly path: string) {
    super(`non_unicode_scalar:${path}`);
    this.name = 'InvalidUnicodeScalarError';
  }
}

function assertScalarString(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const trailing = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || trailing < 0xdc00 || trailing > 0xdfff) {
        throw new InvalidUnicodeScalarError(path);
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new InvalidUnicodeScalarError(path);
    }
  }
}

/** Throws InvalidUnicodeScalarError for any string value or object key that is
 * not a sequence of Unicode scalar values (lone high/low surrogate). */
export function assertUnicodeScalarValues(value: unknown, path = '$'): void {
  if (typeof value === 'string') {
    assertScalarString(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertUnicodeScalarValues(child, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      assertScalarString(key, `${path}.<key>`);
      assertUnicodeScalarValues(child, `${path}.${key}`);
    }
  }
}

export class NonFiniteNumberError extends Error {
  constructor(public readonly path: string) {
    super(`non_finite_number:${path}`);
    this.name = 'NonFiniteNumberError';
  }
}

/** JSON serialization silently turns NaN/Infinity into null, which would let the
 * hashed clone differ from the original value; reject them explicitly. */
export function assertFiniteNumbers(value: unknown, path = '$'): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new NonFiniteNumberError(path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertFiniteNumbers(child, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      assertFiniteNumbers(child, `${path}.${key}`);
    }
  }
}

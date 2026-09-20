/**
 * FIRST-PAID-VERIFY-JWT-RUNTIME-VS-BOUND-SECRET-DIAGNOSTIC-01 — same-invocation,
 * local-only JWT controls for the CDP facilitator auth stage.
 *
 * Runs only on a failed verification, and only when the diagnostic canary's
 * explicit non-secret flag is on. Every control is local signing: none performs
 * a `fetch`, none talks to CDP. The module is pure — the SDK primitives are
 * injected — and it never returns, stores or logs a credential value, a length,
 * a prefix/suffix, a digest, a JWT, a signature, an `Error.message`, a `cause`,
 * a stack or a serialized thrown object. Every field is a member of a closed
 * vocabulary; anything else is dropped by `sanitizeJwtDiagnostic`.
 *
 * Stages: (1) ENV_BINDING_RESOLUTION, (2) CREDENTIAL_OUTER_SHAPE,
 * (3) CDP_CLIENT_CONSTRUCTION + (4) SYNTHETIC_JWT_CONTROL,
 * (5) BOUND_CREDENTIAL_DIRECT_JWT_MINT, (6) CREATE_AUTH_HEADERS (the outcome of
 * the real call that already ran), (7) FACILITATOR_HTTP (contact attempted?).
 */
import { classifySecretShape, isQuoted, type SecretShape } from './cdp-credential-shape';
import { classifyCdpJwtFailure, type CdpJwtSubreason } from './cdp-jwt-failure';

export type ThrownValueClass =
  | 'ERROR'
  | 'TYPE_ERROR'
  | 'RANGE_ERROR'
  | 'REFERENCE_ERROR'
  | 'SYNTAX_ERROR'
  | 'DOM_EXCEPTION'
  | 'NON_ERROR_THROW'
  | 'UNKNOWN';

/** What kind of message an unrecognised error carried, WITHOUT echoing it. */
export type ErrorShape =
  | 'NONE'
  | 'NOT_SUPPORTED'
  | 'NOT_A_FUNCTION'
  | 'NOT_DEFINED'
  | 'INVALID_KEY_DATA'
  | 'CRYPTO_OPERATION_FAILED'
  | 'MODULE_RESOLUTION'
  | 'OTHER';

/** Closed allow-list of runtime symbols on the traced JWT path. A "X is not a
 * function" message is mapped to one of these or to `OTHER`; the message text
 * itself is never kept. */
export const JWT_PATH_SYMBOLS = [
  'getRandomValues',
  'Buffer',
  'importPKCS8',
  'importJWK',
  'SignJWT',
  'digest',
  'OTHER',
  'NONE',
] as const;
export type JwtPathSymbol = (typeof JWT_PATH_SYMBOLS)[number];

/** Stage of the traced `generateJwt` path a failing symbol belongs to. */
export type JwtPathStage =
  | 'NONCE_GENERATION'
  | 'KEY_TYPE_DETECTION'
  | 'KEY_IMPORT'
  | 'JWT_SIGNING'
  | 'UNKNOWN'
  | 'NONE';

const SYMBOL_STAGE: Record<JwtPathSymbol, JwtPathStage> = {
  getRandomValues: 'NONCE_GENERATION',
  Buffer: 'KEY_TYPE_DETECTION',
  importPKCS8: 'KEY_IMPORT',
  importJWK: 'KEY_IMPORT',
  SignJWT: 'JWT_SIGNING',
  digest: 'JWT_SIGNING',
  OTHER: 'UNKNOWN',
  NONE: 'NONE',
};

/** Maps "<symbol> is not a function" onto the allow-list. Bundler-renamed
 * identifiers (`getRandomValues2`, `(0 , x.importJWK)`) collapse to the base. */
export function classifyFailingSymbol(message: string): JwtPathSymbol {
  const m = /^\s*(?:\(0\s*,\s*)?([A-Za-z_$][\w$.]*)\)?\s+is not a function/i.exec(message);
  if (!m) return 'OTHER';
  const full = m[1] ?? '';
  // Try the identifier as written first (importPKCS8 ends in a digit), then
  // with a bundler-added numeric suffix removed (getRandomValues2).
  for (const name of [full, full.replace(/\d+$/, '')]) {
    const parts = name.split('.');
    const last = parts[parts.length - 1] ?? '';
    const head = parts[0] ?? '';
    for (const sym of JWT_PATH_SYMBOLS) {
      if (sym === 'OTHER' || sym === 'NONE') continue;
      if (last === sym || head === sym) return sym;
    }
  }
  return 'OTHER';
}

export interface ThrownDescription {
  thrown_value_class: ThrownValueClass;
  failure_class: CdpJwtSubreason;
  error_shape: ErrorShape;
  failing_symbol: JwtPathSymbol;
  failing_stage: JwtPathStage;
}

export type Tri = 'PASS' | 'FAIL';
export type Yn = 'YES' | 'NO';
export type BoundKeyType = 'ED25519' | 'EC' | 'UNKNOWN';
export type BoundFormat = 'VALID' | 'INVALID' | 'UNKNOWN';
export type YnUnknown = 'YES' | 'NO' | 'UNKNOWN';
export type MintTarget = 'VERIFY' | 'SETTLE' | 'SUPPORTED';
export type EnvBinding = 'PRESENT' | 'MISSING' | 'NON_STRING';

export interface JwtDiagnostic {
  env_binding: EnvBinding;
  binding_present: Yn;
  binding_algorithm: BoundKeyType;
  binding_format: BoundFormat;
  binding_quoted: YnUnknown;
  binding_whitespace: YnUnknown;
  binding_crlf: YnUnknown;
  synthetic_jwt_control: Tri;
  synthetic_failure_class: CdpJwtSubreason | 'NONE';
  synthetic_thrown_value_class: ThrownValueClass | 'NONE';
  synthetic_error_shape: ErrorShape;
  synthetic_failing_symbol: JwtPathSymbol;
  synthetic_failing_stage: JwtPathStage;
  bound_direct_jwt_mint: Tri | 'NOT_AVAILABLE';
  bound_direct_failure_class: CdpJwtSubreason | 'NONE' | 'NOT_AVAILABLE';
  bound_direct_thrown_value_class: ThrownValueClass | 'NONE';
  bound_direct_error_shape: ErrorShape;
  bound_direct_failing_symbol: JwtPathSymbol;
  bound_direct_failing_stage: JwtPathStage;
  bound_direct_failing_target: MintTarget | 'NONE';
  create_auth_headers: Tri;
  create_auth_headers_failure_class: CdpJwtSubreason | 'NONE';
  thrown_value_class: ThrownValueClass | 'NONE';
  create_auth_headers_error_shape: ErrorShape;
  create_auth_headers_failing_symbol: JwtPathSymbol;
  create_auth_headers_failing_stage: JwtPathStage;
  failure_stage_parity: 'PASS' | 'FAIL' | 'NOT_APPLICABLE';
  facilitator_contact_attempted: Yn;
}

export interface MintArgs {
  apiKeyId: string;
  apiKeySecret: string;
  requestMethod: 'GET' | 'POST';
  requestHost: string;
  requestPath: string;
}

export interface JwtDiagnosticDeps {
  /** Public SDK JWT helper; `undefined` => BOUND_DIRECT_JWT_MINT=NOT_AVAILABLE. */
  mintJwt?: (args: MintArgs) => Promise<string>;
  /** Builds the SDK's own facilitator client and returns only its
   * `createAuthHeaders(path)`; construction and the call are both local. */
  createSyntheticAuthHeaders: (
    apiKeyId: string,
    apiKeySecret: string,
    path: 'verify' | 'settle' | 'supported'
  ) => Promise<unknown>;
  /** Non-secret, no-permission control key material. */
  syntheticKeyId: string;
  syntheticKeySecret: string;
}

export interface JwtDiagnosticInput {
  apiKeyId: unknown;
  apiKeySecret: unknown;
  /** `undefined` when the real `createAuthHeaders` call succeeded (or was never
   * the failing stage); otherwise the value it threw. */
  authStageFailure?: { thrown: unknown };
}

const FACILITATOR_HOST = 'api.cdp.coinbase.com';
const FACILITATOR_BASE_PATH = '/platform/v2/x402';
const TARGETS: ReadonlyArray<{ name: MintTarget; method: 'GET' | 'POST'; path: string }> = [
  { name: 'VERIFY', method: 'POST', path: `${FACILITATOR_BASE_PATH}/verify` },
  { name: 'SETTLE', method: 'POST', path: `${FACILITATOR_BASE_PATH}/settle` },
  { name: 'SUPPORTED', method: 'GET', path: `${FACILITATOR_BASE_PATH}/supported` },
];

function safeString(read: () => unknown): string {
  try {
    const v = read();
    return typeof v === 'string' ? v : '';
  } catch {
    return '';
  }
}

/** Reduce any thrown value to closed enums. Never returns any part of it. */
export function describeThrown(thrown: unknown): ThrownDescription {
  const isObject = typeof thrown === 'object' && thrown !== null;
  if (!isObject) {
    return {
      thrown_value_class: 'NON_ERROR_THROW',
      failure_class: 'cdp_jwt_unknown_failure',
      error_shape: 'NONE',
      failing_symbol: 'NONE',
      failing_stage: 'NONE',
    };
  }
  const name = safeString(() => (thrown as { name?: unknown }).name);
  const message = safeString(() => (thrown as { message?: unknown }).message);
  let value_class: ThrownValueClass;
  let isError = false;
  try {
    isError = thrown instanceof Error;
  } catch {
    isError = false;
  }
  if (name === 'TypeError') value_class = 'TYPE_ERROR';
  else if (name === 'RangeError') value_class = 'RANGE_ERROR';
  else if (name === 'ReferenceError') value_class = 'REFERENCE_ERROR';
  else if (name === 'SyntaxError') value_class = 'SYNTAX_ERROR';
  else if (
    ['NotSupportedError', 'OperationError', 'DataError', 'InvalidAccessError'].includes(name) ||
    name === 'DOMException'
  ) {
    value_class = 'DOM_EXCEPTION';
  } else if (isError) value_class = 'ERROR';
  else value_class = 'UNKNOWN';

  let error_shape: ErrorShape = 'OTHER';
  if (message.length === 0 && !name) error_shape = 'NONE';
  else if (name === 'NotSupportedError' || /not supported|unsupported/i.test(message)) {
    error_shape = 'NOT_SUPPORTED';
  } else if (/is not a function/i.test(message)) error_shape = 'NOT_A_FUNCTION';
  else if (/is not defined/i.test(message)) error_shape = 'NOT_DEFINED';
  else if (/cannot find module|no such module|failed to load module/i.test(message)) {
    error_shape = 'MODULE_RESOLUTION';
  } else if (/invalid keydata|invalid key|key data|jwk|pkcs8/i.test(message)) {
    error_shape = 'INVALID_KEY_DATA';
  } else if (name === 'OperationError' || /operation failed|crypto/i.test(message)) {
    error_shape = 'CRYPTO_OPERATION_FAILED';
  }
  const failing_symbol: JwtPathSymbol =
    error_shape === 'NOT_A_FUNCTION' ? classifyFailingSymbol(message) : 'NONE';
  return {
    thrown_value_class: value_class,
    failure_class: classifyCdpJwtFailure(thrown),
    error_shape,
    failing_symbol,
    failing_stage: SYMBOL_STAGE[failing_symbol],
  };
}

function keyTypeAndFormat(
  shape: SecretShape,
  isString: boolean
): { type: BoundKeyType; format: BoundFormat } {
  if (!isString) return { type: 'UNKNOWN', format: 'UNKNOWN' };
  if (shape === 'PEM_MULTILINE') return { type: 'EC', format: 'VALID' };
  if (shape === 'BASE64_64_BYTES') return { type: 'ED25519', format: 'VALID' };
  return { type: 'UNKNOWN', format: 'INVALID' };
}

/** Runs every local control. Never throws; never performs network I/O. */
export async function runJwtDiagnostic(
  input: JwtDiagnosticInput,
  deps: JwtDiagnosticDeps
): Promise<JwtDiagnostic> {
  const idOk = typeof input.apiKeyId === 'string';
  const secretOk = typeof input.apiKeySecret === 'string';
  const id = idOk ? (input.apiKeyId as string) : '';
  const secret = secretOk ? (input.apiKeySecret as string) : '';
  const present = id.length > 0 && secret.length > 0;

  const out: JwtDiagnostic = {
    env_binding: !idOk || !secretOk ? 'NON_STRING' : present ? 'PRESENT' : 'MISSING',
    binding_present: present ? 'YES' : 'NO',
    binding_algorithm: 'UNKNOWN',
    binding_format: 'UNKNOWN',
    binding_quoted: 'UNKNOWN',
    binding_whitespace: 'UNKNOWN',
    binding_crlf: 'UNKNOWN',
    synthetic_jwt_control: 'FAIL',
    synthetic_failure_class: 'NONE',
    synthetic_thrown_value_class: 'NONE',
    synthetic_error_shape: 'NONE',
    synthetic_failing_symbol: 'NONE',
    synthetic_failing_stage: 'NONE',
    bound_direct_jwt_mint: 'NOT_AVAILABLE',
    bound_direct_failure_class: 'NOT_AVAILABLE',
    bound_direct_thrown_value_class: 'NONE',
    bound_direct_error_shape: 'NONE',
    bound_direct_failing_symbol: 'NONE',
    bound_direct_failing_stage: 'NONE',
    bound_direct_failing_target: 'NONE',
    create_auth_headers: input.authStageFailure ? 'FAIL' : 'PASS',
    create_auth_headers_failure_class: 'NONE',
    thrown_value_class: 'NONE',
    create_auth_headers_error_shape: 'NONE',
    create_auth_headers_failing_symbol: 'NONE',
    create_auth_headers_failing_stage: 'NONE',
    failure_stage_parity: 'NOT_APPLICABLE',
    facilitator_contact_attempted: input.authStageFailure ? 'NO' : 'YES',
  };

  // (6) the real createAuthHeaders outcome, classified without echoing it.
  if (input.authStageFailure) {
    const d = describeThrown(input.authStageFailure.thrown);
    out.create_auth_headers_failure_class = d.failure_class;
    out.thrown_value_class = d.thrown_value_class;
    out.create_auth_headers_error_shape = d.error_shape;
    out.create_auth_headers_failing_symbol = d.failing_symbol;
    out.create_auth_headers_failing_stage = d.failing_stage;
  }

  // (2) outer shape, enums only.
  try {
    if (idOk && secretOk) {
      const shape = classifySecretShape(secret);
      const kf = keyTypeAndFormat(shape, true);
      out.binding_algorithm = kf.type;
      out.binding_format = kf.format;
      out.binding_quoted = isQuoted(secret) ? 'YES' : 'NO';
      out.binding_whitespace = secret !== secret.trim() ? 'YES' : 'NO';
      out.binding_crlf = secret.includes('\r\n') ? 'YES' : 'NO';
    }
  } catch {
    // stay UNKNOWN
  }

  // (3)+(4) SYNTHETIC_JWT_CONTROL — the SDK's own auth-header primitive with
  // non-secret material, no fetch.
  try {
    await deps.createSyntheticAuthHeaders(deps.syntheticKeyId, deps.syntheticKeySecret, 'verify');
    out.synthetic_jwt_control = 'PASS';
  } catch (error) {
    const d = describeThrown(error);
    out.synthetic_jwt_control = 'FAIL';
    out.synthetic_failure_class = d.failure_class;
    out.synthetic_thrown_value_class = d.thrown_value_class;
    out.synthetic_error_shape = d.error_shape;
    out.synthetic_failing_symbol = d.failing_symbol;
    out.synthetic_failing_stage = d.failing_stage;
  }

  // (5) BOUND_CREDENTIAL_DIRECT_JWT_MINT — public SDK helper only.
  if (deps.mintJwt) {
    out.bound_direct_jwt_mint = 'PASS';
    out.bound_direct_failure_class = 'NONE';
    for (const target of TARGETS) {
      try {
        // The JWT is discarded immediately; only the fact of success is kept.
        await deps.mintJwt({
          apiKeyId: id,
          apiKeySecret: secret,
          requestMethod: target.method,
          requestHost: FACILITATOR_HOST,
          requestPath: target.path,
        });
      } catch (error) {
        const d = describeThrown(error);
        out.bound_direct_jwt_mint = 'FAIL';
        out.bound_direct_failure_class = d.failure_class;
        out.bound_direct_thrown_value_class = d.thrown_value_class;
        out.bound_direct_error_shape = d.error_shape;
        out.bound_direct_failing_symbol = d.failing_symbol;
        out.bound_direct_failing_stage = d.failing_stage;
        out.bound_direct_failing_target = target.name;
        break;
      }
    }
  }
  // Synthetic (public key) and bound (real credential) fail at the same stage
  // and symbol => the fault precedes any key-content handling.
  if (out.synthetic_jwt_control === 'FAIL' && out.bound_direct_jwt_mint === 'FAIL') {
    out.failure_stage_parity =
      out.synthetic_failing_stage === out.bound_direct_failing_stage &&
      out.synthetic_failing_symbol === out.bound_direct_failing_symbol
        ? 'PASS'
        : 'FAIL';
  }
  return out;
}

const ENUM_VALUE = /^[A-Za-z0-9_]{1,64}$/;

/** Belt and braces: only closed-vocabulary-shaped string values ever leave. */
export function sanitizeJwtDiagnostic(diag: JwtDiagnostic): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(diag)) {
    if (typeof value === 'string' && ENUM_VALUE.test(value)) out[key] = value;
  }
  return out;
}

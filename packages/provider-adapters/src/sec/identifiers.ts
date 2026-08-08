import { z } from 'zod';

export const CikSchema = z.string().regex(/^\d{10}$/);
export type Cik = z.infer<typeof CikSchema>;

export const TickerSchema = z.string().regex(/^[A-Z]{1,5}$/);
export type Ticker = z.infer<typeof TickerSchema>;

export const CompanyNameSchema = z.string().min(1).max(200);
export type CompanyName = z.infer<typeof CompanyNameSchema>;

export const DomainSchema = z
  .string()
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i);
export type Domain = z.infer<typeof DomainSchema>;

export const AccessionNumberSchema = z.string().regex(/^\d{10}-\d{2}-\d{6}$/);
export type AccessionNumber = z.infer<typeof AccessionNumberSchema>;

export const FormTypeSchema = z.string().regex(/^[A-Z0-9/]{1,20}$/);
export type FormType = z.infer<typeof FormTypeSchema>;

export function normalizeCik(input: string): Cik {
  const digits = input.replace(/\D/g, '');
  if (digits.length > 10) {
    throw new Error(`CIK too long: ${input}`);
  }
  const padded = digits.padStart(10, '0');
  return CikSchema.parse(padded);
}

export function validateCik(input: string): Cik {
  return CikSchema.parse(input);
}

export function normalizeTicker(input: string): Ticker {
  const cleaned = input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  return TickerSchema.parse(cleaned);
}

export function validateTicker(input: string): Ticker {
  return TickerSchema.parse(input.trim().toUpperCase());
}

export function normalizeCompanyName(input: string): CompanyName {
  return CompanyNameSchema.parse(input.trim().replace(/\s+/g, ' '));
}

export function createCompanyNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
}

export function normalizeDomain(input: string): Domain {
  const cleaned = input
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0];
  return DomainSchema.parse(cleaned);
}

export function normalizeAccessionNumber(input: string): AccessionNumber {
  const cleaned = input.replace(/[^0-9-]/g, '');
  // If no dashes, assume it's a raw 18-digit string and format it
  if (!cleaned.includes('-') && cleaned.length === 18) {
    return AccessionNumberSchema.parse(
      `${cleaned.slice(0, 10)}-${cleaned.slice(10, 12)}-${cleaned.slice(12)}`
    );
  }
  return AccessionNumberSchema.parse(cleaned);
}

export function formatAccessionNumber(raw: string): AccessionNumber {
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 18) {
    throw new Error(`Invalid accession number length: ${digits.length}`);
  }
  return AccessionNumberSchema.parse(
    `${digits.slice(0, 10)}-${digits.slice(10, 12)}-${digits.slice(12)}`
  );
}

export function parseAccessionNumber(accession: AccessionNumber): {
  cik: string;
  year: string;
  sequence: string;
} {
  const [cikPart, yearPart, seqPart] = accession.split('-');
  return {
    cik: cikPart,
    year: yearPart,
    sequence: seqPart,
  };
}

export type IdentifierMatchType =
  | 'exact_cik'
  | 'exact_ticker'
  | 'exact_name'
  | 'ambiguous'
  | 'no_match';

export interface IdentifierResolution {
  matchType: IdentifierMatchType;
  cik?: Cik;
  candidates?: Array<{ cik: Cik; name: string; ticker?: Ticker; score: number }>;
}

export function resolveIdentifier(
  input: { cik?: string; ticker?: string; name?: string },
  knownEntities: Array<{ cik: Cik; name: string; ticker?: Ticker }>
): IdentifierResolution {
  if (input.cik) {
    const cik = normalizeCik(input.cik);
    const entity = knownEntities.find((e) => e.cik === cik);
    if (entity) {
      return { matchType: 'exact_cik', cik: entity.cik };
    }
    return { matchType: 'no_match' };
  }

  if (input.ticker) {
    const ticker = normalizeTicker(input.ticker);
    const matches = knownEntities.filter((e) => e.ticker === ticker);
    if (matches.length === 1) {
      return { matchType: 'exact_ticker', cik: matches[0].cik };
    }
    if (matches.length > 1) {
      return {
        matchType: 'ambiguous',
        candidates: matches.map((m) => ({
          cik: m.cik,
          name: m.name,
          ticker: m.ticker,
          score: 1.0,
        })),
      };
    }
  }

  if (input.name) {
    const nameKey = createCompanyNameKey(input.name);
    const matches = knownEntities.filter((e) => createCompanyNameKey(e.name) === nameKey);
    if (matches.length === 1) {
      return { matchType: 'exact_name', cik: matches[0].cik };
    }
    if (matches.length > 1) {
      return {
        matchType: 'ambiguous',
        candidates: matches.map((m) => ({
          cik: m.cik,
          name: m.name,
          ticker: m.ticker,
          score: 1.0,
        })),
      };
    }
  }

  return { matchType: 'no_match' };
}

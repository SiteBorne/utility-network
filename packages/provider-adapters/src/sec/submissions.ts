import { z } from 'zod';

export const SecSubmissionSchema = z.object({
  accessionNumber: z.string(),
  filingDate: z.string().date(),
  reportDate: z.string().date().optional(),
  acceptanceDateTime: z.string().datetime({ offset: true }).optional(),
  act: z.string().optional(),
  form: z.string(),
  fileNumber: z.string().optional(),
  filmNumber: z.string().optional(),
  items: z.string().optional(),
  size: z.number().int().optional(),
  isXBRL: z.number().int().optional(),
  isInlineXBRL: z.number().int().optional(),
  primaryDocument: z.string().optional(),
  primaryDocDescription: z.string().optional(),
});
export type SecSubmission = z.infer<typeof SecSubmissionSchema>;

export const SecEntitySchema = z.object({
  cik: z.string(),
  entityName: z.string(),
  tickers: z.array(z.string()).optional(),
  exchanges: z.array(z.string()).optional(),
  ein: z.string().optional(),
  description: z.string().optional(),
  website: z.string().optional(),
  investorWebsite: z.string().optional(),
  category: z.string().optional(),
  fiscalYearEnd: z.string().optional(),
  stateOfIncorporation: z.string().optional(),
  stateOfIncorporationDescription: z.string().optional(),
  addresses: z
    .object({
      mailing: z
        .object({
          street1: z.string().optional(),
          street2: z.string().optional(),
          city: z.string().optional(),
          stateOrCountry: z.string().optional(),
          zipCode: z.string().optional(),
        })
        .optional(),
      business: z
        .object({
          street1: z.string().optional(),
          street2: z.string().optional(),
          city: z.string().optional(),
          stateOrCountry: z.string().optional(),
          zipCode: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  phone: z.string().optional(),
  flags: z.string().optional(),
  formerNames: z
    .array(
      z.object({
        name: z.string(),
        date: z.string().date(),
      })
    )
    .optional(),
});
export type SecEntity = z.infer<typeof SecEntitySchema>;

export const SecSubmissionsResponseSchema = z.object({
  cik: z.string(),
  entityName: z.string(),
  tickers: z.array(z.string()).optional(),
  exchanges: z.array(z.string()).optional(),
  ein: z.string().optional(),
  description: z.string().optional(),
  website: z.string().optional(),
  investorWebsite: z.string().optional(),
  category: z.string().optional(),
  fiscalYearEnd: z.string().optional(),
  stateOfIncorporation: z.string().optional(),
  stateOfIncorporationDescription: z.string().optional(),
  addresses: z
    .object({
      mailing: z
        .object({
          street1: z.string().optional(),
          street2: z.string().optional(),
          city: z.string().optional(),
          stateOrCountry: z.string().optional(),
          zipCode: z.string().optional(),
        })
        .optional(),
      business: z
        .object({
          street1: z.string().optional(),
          street2: z.string().optional(),
          city: z.string().optional(),
          stateOrCountry: z.string().optional(),
          zipCode: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  phone: z.string().optional(),
  flags: z.string().optional(),
  formerNames: z
    .array(
      z.object({
        name: z.string(),
        date: z.string().date(),
      })
    )
    .optional(),
  filings: z
    .object({
      recent: z
        .object({
          accessionNumber: z.array(z.string()),
          filingDate: z.array(z.string()),
          reportDate: z.array(z.string()).optional(),
          acceptanceDateTime: z.array(z.string()).optional(),
          act: z.array(z.string()).optional(),
          form: z.array(z.string()),
          fileNumber: z.array(z.string()).optional(),
          filmNumber: z.array(z.string()).optional(),
          items: z.array(z.string()).optional(),
          size: z.array(z.number().int()).optional(),
          isXBRL: z.array(z.number().int()).optional(),
          isInlineXBRL: z.array(z.number().int()).optional(),
          primaryDocument: z.array(z.string()).optional(),
          primaryDocDescription: z.array(z.string()).optional(),
        })
        .optional(),
      files: z
        .array(
          z.object({
            name: z.string(),
            filingFrom: z.string().date(),
            filingTo: z.string().date(),
          })
        )
        .optional(),
    })
    .optional(),
});
export type SecSubmissionsResponse = z.infer<typeof SecSubmissionsResponseSchema>;

export function normalizeEntity(raw: SecSubmissionsResponse): SecEntity {
  return {
    cik: raw.cik,
    entityName: raw.entityName,
    tickers: raw.tickers,
    exchanges: raw.exchanges,
    ein: raw.ein,
    description: raw.description,
    website: raw.website,
    investorWebsite: raw.investorWebsite,
    category: raw.category,
    fiscalYearEnd: raw.fiscalYearEnd,
    stateOfIncorporation: raw.stateOfIncorporation,
    stateOfIncorporationDescription: raw.stateOfIncorporationDescription,
    addresses: raw.addresses,
    phone: raw.phone,
    flags: raw.flags,
    formerNames: raw.formerNames,
  };
}

export function normalizeFilings(raw: SecSubmissionsResponse): SecSubmission[] {
  if (!raw.filings?.recent?.accessionNumber) return [];

  const count = raw.filings.recent.accessionNumber.length;
  const filings: SecSubmission[] = [];

  for (let i = 0; i < count; i++) {
    filings.push({
      accessionNumber: raw.filings.recent.accessionNumber[i],
      filingDate: raw.filings.recent.filingDate[i],
      reportDate: raw.filings.recent.reportDate?.[i],
      acceptanceDateTime: raw.filings.recent.acceptanceDateTime?.[i],
      act: raw.filings.recent.act?.[i],
      form: raw.filings.recent.form[i],
      fileNumber: raw.filings.recent.fileNumber?.[i],
      filmNumber: raw.filings.recent.filmNumber?.[i],
      items: raw.filings.recent.items?.[i],
      size: raw.filings.recent.size?.[i],
      isXBRL: raw.filings.recent.isXBRL?.[i],
      isInlineXBRL: raw.filings.recent.isInlineXBRL?.[i],
      primaryDocument: raw.filings.recent.primaryDocument?.[i],
      primaryDocDescription: raw.filings.recent.primaryDocDescription?.[i],
    });
  }

  return filings;
}

export function filterFilings(
  filings: SecSubmission[],
  options: {
    forms?: string[];
    sinceDate?: string;
    untilDate?: string;
    maxCount?: number;
  } = {}
): SecSubmission[] {
  let filtered = [...filings];

  if (options.forms && options.forms.length > 0) {
    filtered = filtered.filter((f) => options.forms!.includes(f.form));
  }

  if (options.sinceDate) {
    filtered = filtered.filter((f) => f.filingDate >= options.sinceDate!);
  }

  if (options.untilDate) {
    filtered = filtered.filter((f) => f.filingDate <= options.untilDate!);
  }

  if (options.maxCount && filtered.length > options.maxCount) {
    filtered = filtered.slice(0, options.maxCount);
  }

  return filtered;
}

/**
 * SUN-1222C2-Q1-R1: `cik.padStart(10, '0')` only left-pads a string
 * *shorter* than 10 characters -- a `cik` already >= 10 characters (e.g. a
 * path-traversal payload) passed through completely unvalidated into this
 * URL template, and the WHATWG `URL` parser's dot-segment normalization
 * could then escape the intended `/submissions/CIK*.json` endpoint family
 * entirely (proven in sec-edgar-cik-request-validation.test.ts). The
 * production x402 request path already rejects any non-10-digit `cik` at
 * the AJV contract-schema layer
 * (`schemas/services/company-evidence-input.schema.json`:
 * `identifiers.cik` pattern `^[0-9]{10}$`) before it ever reaches here --
 * this is defense-in-depth for this function itself, which has no such
 * caller-independent guarantee.
 */
export function buildSubmissionsUrl(cik: string): string {
  if (!/^[0-9]{1,10}$/.test(cik)) {
    throw new Error(`Invalid CIK format: expected 1-10 ASCII digits, got ${JSON.stringify(cik)}`);
  }
  const normalized = cik.padStart(10, '0');
  return `https://data.sec.gov/submissions/CIK${normalized}.json`;
}

export function buildFilingDetailUrl(cik: string, accessionNumber: string): string {
  const normalizedCik = cik.padStart(10, '0');
  const cleanAccession = accessionNumber.replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/${normalizedCik}/${cleanAccession}/${accessionNumber}-index.html`;
}

export function buildPrimaryDocumentUrl(
  cik: string,
  accessionNumber: string,
  primaryDocument: string
): string {
  const normalizedCik = cik.padStart(10, '0');
  const cleanAccession = accessionNumber.replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/${normalizedCik}/${cleanAccession}/${primaryDocument}`;
}

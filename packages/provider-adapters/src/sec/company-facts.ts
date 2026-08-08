import { z } from 'zod';

export const SecFactSchema = z.object({
  val: z.number(),
  accn: z.string(),
  fy: z.number().int(),
  fp: z.string(),
  form: z.string(),
  filed: z.string().date(),
  frame: z.string().optional(),
  start: z.string().date().optional(),
  end: z.string().date().optional(),
  instant: z.string().date().optional(),
});
export type SecFact = z.infer<typeof SecFactSchema>;

export const SecFactsUnitSchema = z.object({
  label: z.string().optional(),
  description: z.string().optional(),
  units: z.record(z.array(SecFactSchema)),
});
export type SecFactsUnit = z.infer<typeof SecFactsUnitSchema>;

export const SecFactsConceptSchema = z.object({
  label: z.string().optional(),
  description: z.string().optional(),
  units: z.record(z.array(SecFactSchema)),
});
export type SecFactsConcept = z.infer<typeof SecFactsConceptSchema>;

export const SecFactsTaxonomySchema = z.object({
  label: z.string().optional(),
  description: z.string().optional(),
  concepts: z.record(SecFactsConceptSchema),
});
export type SecFactsTaxonomy = z.infer<typeof SecFactsTaxonomySchema>;

export const SecCompanyFactsResponseSchema = z.object({
  cik: z.string(),
  entityName: z.string(),
  facts: z
    .object({
      'us-gaap': SecFactsTaxonomySchema.optional(),
      'ifrs-full': SecFactsTaxonomySchema.optional(),
      srt: SecFactsTaxonomySchema.optional(),
      dei: SecFactsTaxonomySchema.optional(),
      invest: SecFactsTaxonomySchema.optional(),
      country: SecFactsTaxonomySchema.optional(),
      currency: SecFactsTaxonomySchema.optional(),
    })
    .optional(),
});
export type SecCompanyFactsResponse = z.infer<typeof SecCompanyFactsResponseSchema>;

export interface NormalizedFact {
  taxonomy: string;
  concept: string;
  label: string | undefined;
  description: string | undefined;
  unit: string;
  value: string;
  valueRaw: number;
  fiscalYear: number;
  fiscalPeriod: string;
  form: string;
  filedDate: string;
  frame: string | undefined;
  startDate: string | undefined;
  endDate: string | undefined;
  instantDate: string | undefined;
  accessionNumber: string;
  sourceLocator: string;
  isAmended: boolean;
  supersedesAccession?: string;
}

export function normalizeCompanyFacts(
  raw: SecCompanyFactsResponse,
  options: {
    taxonomies?: string[];
    concepts?: string[];
    forms?: string[];
    startDate?: string;
    endDate?: string;
    maxFacts?: number;
  } = {}
): NormalizedFact[] {
  const facts: NormalizedFact[] = [];
  const taxonomies =
    options.taxonomies && options.taxonomies.length > 0
      ? options.taxonomies
      : ['us-gaap', 'ifrs-full', 'srt', 'dei', 'invest', 'country', 'currency'];
  const concepts = options.concepts;
  const forms = options.forms;
  const startDate = options.startDate;
  const endDate = options.endDate;
  const maxFacts = options.maxFacts || 10000;

  if (!raw.facts) return facts;

  for (const taxonomy of taxonomies) {
    const taxData = raw.facts[taxonomy as keyof typeof raw.facts];
    if (!taxData?.concepts) continue;

    for (const [conceptName, concept] of Object.entries(taxData.concepts)) {
      if (concepts && concepts.length > 0 && !concepts.includes(conceptName)) continue;

      for (const [unit, unitFacts] of Object.entries(concept.units)) {
        for (const fact of unitFacts) {
          if (forms && forms.length > 0 && !forms.includes(fact.form)) continue;
          if (startDate && fact.filed < startDate) continue;
          if (endDate && fact.filed > endDate) continue;

          facts.push({
            taxonomy,
            concept: conceptName,
            label: concept.label,
            description: concept.description,
            unit,
            value: String(fact.val),
            valueRaw: fact.val,
            fiscalYear: fact.fy,
            fiscalPeriod: fact.fp,
            form: fact.form,
            filedDate: fact.filed,
            frame: fact.frame,
            startDate: fact.start,
            endDate: fact.end,
            instantDate: fact.instant,
            accessionNumber: fact.accn,
            sourceLocator: `/facts/${taxonomy}/${conceptName}/units/${unit}/${unitFacts.indexOf(fact)}`,
            isAmended: fact.form.endsWith('/A') || fact.form.endsWith('-A'),
            supersedesAccession: undefined,
          });

          if (facts.length >= maxFacts) return facts;
        }
      }
    }
  }

  return facts;
}

export function detectAmendedFilings(facts: NormalizedFact[]): NormalizedFact[] {
  const byKey = new Map<string, NormalizedFact[]>();

  for (const fact of facts) {
    const key = `${fact.taxonomy}|${fact.concept}|${fact.unit}|${fact.fiscalYear}|${fact.fiscalPeriod}|${fact.frame || ''}|${fact.startDate || ''}|${fact.endDate || ''}|${fact.instantDate || ''}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(fact);
  }

  for (const [, group] of byKey.entries()) {
    if (group.length <= 1) continue;

    const sorted = group.sort((a, b) => a.filedDate.localeCompare(b.filedDate));
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].isAmended) {
        sorted[i].supersedesAccession = sorted[i - 1].accessionNumber;
      }
    }
  }

  return facts;
}

export function groupByConcept(facts: NormalizedFact[]): Map<string, NormalizedFact[]> {
  const groups = new Map<string, NormalizedFact[]>();
  for (const fact of facts) {
    const key = `${fact.taxonomy}|${fact.concept}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(fact);
  }
  return groups;
}

export function buildCompanyFactsUrl(cik: string): string {
  const normalized = cik.padStart(10, '0');
  return `https://data.sec.gov/api/xbrl/companyfacts/CIK${normalized}.json`;
}

export function factToDecimalString(val: number): string {
  return val.toString();
}

export function parseDecimalString(str: string): number {
  return parseFloat(str);
}

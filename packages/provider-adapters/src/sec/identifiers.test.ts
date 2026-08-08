import { describe, it, expect } from 'vitest';
import {
  normalizeCik,
  validateCik,
  normalizeTicker,
  createCompanyNameKey,
  normalizeDomain,
  normalizeAccessionNumber,
  formatAccessionNumber,
  parseAccessionNumber,
  resolveIdentifier,
} from './identifiers';

describe('SEC Identifiers', () => {
  describe('normalizeCik', () => {
    it('should pad CIK with leading zeros', () => {
      expect(normalizeCik('320193')).toBe('0000320193');
      expect(normalizeCik('0000320193')).toBe('0000320193');
    });

    it('should reject CIK that is too long', () => {
      expect(() => normalizeCik('12345678901')).toThrow('CIK too long');
    });

    it('should strip non-digits', () => {
      expect(normalizeCik('00-003-20193')).toBe('0000320193');
    });
  });

  describe('validateCik', () => {
    it('should accept valid CIK', () => {
      expect(validateCik('0000320193')).toBe('0000320193');
    });

    it('should reject invalid CIK', () => {
      expect(() => validateCik('320193')).toThrow();
      expect(() => validateCik('abc')).toThrow();
    });
  });

  describe('normalizeTicker', () => {
    it('should normalize ticker to uppercase', () => {
      expect(normalizeTicker('aapl')).toBe('AAPL');
      expect(normalizeTicker('  brk.a  ')).toBe('BRKA');
    });

    it('should reject invalid ticker', () => {
      expect(() => normalizeTicker('TOOLONG')).toThrow();
    });
  });

  describe('createCompanyNameKey', () => {
    it('should create normalized key', () => {
      expect(createCompanyNameKey('Apple Inc.')).toBe('apple-inc');
      expect(createCompanyNameKey('  Microsoft   Corporation  ')).toBe('microsoft-corporation');
      expect(createCompanyNameKey('Berkshire Hathaway Inc.')).toBe('berkshire-hathaway-inc');
    });
  });

  describe('normalizeDomain', () => {
    it('should normalize domain', () => {
      expect(normalizeDomain('https://www.example.com/path')).toBe('example.com');
      expect(normalizeDomain('http://sub.domain.org')).toBe('sub.domain.org');
    });
  });

  describe('Accession Number', () => {
    it('should normalize accession number', () => {
      expect(normalizeAccessionNumber('0000320193-24-000010')).toBe('0000320193-24-000010');
      expect(normalizeAccessionNumber('000032019324000010')).toBe('0000320193-24-000010');
    });

    it('should format accession number', () => {
      expect(formatAccessionNumber('000032019324000010')).toBe('0000320193-24-000010');
    });

    it('should parse accession number', () => {
      const parsed = parseAccessionNumber('0000320193-24-000010');
      expect(parsed.cik).toBe('0000320193');
      expect(parsed.year).toBe('24');
      expect(parsed.sequence).toBe('000010');
    });
  });

  describe('resolveIdentifier', () => {
    const knownEntities = [
      { cik: '0000320193', name: 'Apple Inc.', ticker: 'AAPL' },
      { cik: '0000789019', name: 'Microsoft Corporation', ticker: 'MSFT' },
    ];

    it('should resolve by CIK', () => {
      const result = resolveIdentifier({ cik: '320193' }, knownEntities);
      expect(result.matchType).toBe('exact_cik');
      expect(result.cik).toBe('0000320193');
    });

    it('should resolve by ticker', () => {
      const result = resolveIdentifier({ ticker: 'AAPL' }, knownEntities);
      expect(result.matchType).toBe('exact_ticker');
      expect(result.cik).toBe('0000320193');
    });

    it('should resolve by name', () => {
      const result = resolveIdentifier({ name: 'Apple Inc.' }, knownEntities);
      expect(result.matchType).toBe('exact_name');
      expect(result.cik).toBe('0000320193');
    });

    it('should return no_match for unknown', () => {
      const result = resolveIdentifier({ cik: '9999999999' }, knownEntities);
      expect(result.matchType).toBe('no_match');
    });

    it('should return ambiguous for duplicate ticker', () => {
      const entitiesWithDup = [
        ...knownEntities,
        { cik: '0000111111', name: 'Another Corp', ticker: 'AAPL' },
      ];
      const result = resolveIdentifier({ ticker: 'AAPL' }, entitiesWithDup);
      expect(result.matchType).toBe('ambiguous');
      expect(result.candidates?.length).toBe(2);
    });
  });
});

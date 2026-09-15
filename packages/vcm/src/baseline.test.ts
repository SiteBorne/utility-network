import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VCM_BASELINE } from './baseline';

const MASTER_DOC_PATH = fileURLToPath(
  new URL('../../../docs/reports/METADATA-VCM-MASTER-canonical-reference.md', import.meta.url)
);
const SCOPE_END_MARKER = 'only consolidates the already-approved design record into one reference.';

describe('VCM_BASELINE', () => {
  it('points at the frozen master reference document', () => {
    expect(VCM_BASELINE.document).toBe('docs/reports/METADATA-VCM-MASTER-canonical-reference.md');
  });

  it("exactly matches the digest recorded in the document's own Freeze Record", () => {
    const raw = readFileSync(MASTER_DOC_PATH, 'utf-8');
    const markerEnd = raw.indexOf(SCOPE_END_MARKER);
    expect(
      markerEnd,
      'Freeze Record scope-end marker sentence not found in document'
    ).toBeGreaterThan(0);
    // Scope is "through the end of the line", which includes that line's
    // trailing newline -- confirmed against the Freeze Record's own
    // recorded DOCUMENT_BYTE_LENGTH (133032): the sentence itself is only
    // 133031 bytes in.
    const scoped = raw.slice(0, markerEnd + SCOPE_END_MARKER.length + 1);
    const recomputed = `sha256:${createHash('sha256').update(scoped, 'utf-8').digest('hex')}`;
    expect(recomputed).toBe(VCM_BASELINE.digest);
  });

  it('the document declares the same digest value in its own Freeze Record text', () => {
    const raw = readFileSync(MASTER_DOC_PATH, 'utf-8');
    expect(raw).toContain(`DOCUMENT_DIGEST           = ${VCM_BASELINE.digest}`);
  });
});

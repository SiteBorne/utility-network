import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getAjv, getOutputSchemaId } from '@siteborne/verification';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { verifySelfVerifyingPcc, type SelfVerifyingPcc } from '../pcc/vnext-proof';
import { FIXED_TIME, FOUR_V3_SERVICES, runScenario } from './four-service-scenarios';

const EXAMPLES = fileURLToPath(
  new URL('../../../../contracts/releases/3.0.0/examples/', import.meta.url)
);

async function assertExample(
  filename: string,
  serviceId: (typeof FOUR_V3_SERVICES)[number],
  options: { verifyExpectedValue?: number; verifyCandidateValue?: number } = {}
): Promise<void> {
  const { result, keyRegistry } = await runScenario(serviceId, options);
  const wire = result.finalized?.wireBody as unknown as SelfVerifyingPcc;
  const path = `${EXAMPLES}${filename}`;
  if (process.env.UPDATE_VNEXT_RELEASE_EXAMPLES === '1') {
    writeFileSync(path, `${JSON.stringify(wire, null, 2)}\n`);
  }

  const saved = JSON.parse(readFileSync(path, 'utf8')) as SelfVerifyingPcc;
  expect(saved).toEqual(wire);
  const validator = getAjv().getSchema(getOutputSchemaId(serviceId)!);
  expect(validator?.(saved), JSON.stringify(validator?.errors)).toBe(true);
  await expect(verifySelfVerifyingPcc(saved, keyRegistry)).resolves.toEqual({
    valid: true,
    errors: [],
  });
}

describe('Service Contract 3.0.0 governed full-PCC examples', () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_TIME);
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it.each(FOUR_V3_SERVICES)('%s fixture is deterministic and self-verifying', async (serviceId) => {
    await assertExample(`${serviceId}.pcc.json`, serviceId);
  });

  it('keeps a deterministic signed verify non-pass fixture', async () => {
    await assertExample('verify_agent_output.v3.nonpass.pcc.json', 'verify_agent_output.v3', {
      verifyExpectedValue: 42,
      verifyCandidateValue: 7,
    });
  });
});

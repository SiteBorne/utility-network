/**
 * SUN-1200 checkpoint F remediation — proves the committed generated
 * standalone-validator module (`src/generated/input-validators.generated.js`)
 * is byte-identical to what `generate-input-validators.ts` would produce
 * right now from the current frozen input schemas. A stale generated
 * file (someone hand-edited it, or the frozen schemas changed without
 * regenerating) fails this check and therefore `pnpm check`.
 */
import { readFileSync, existsSync } from 'node:fs';
import { GENERATED_OUTPUT_PATH, generateModuleSource } from './generate-input-validators.mts';

function main(): void {
  if (!existsSync(GENERATED_OUTPUT_PATH)) {
    console.error(
      `Missing generated file: ${GENERATED_OUTPUT_PATH}. Run \`pnpm generate:input-validators\`.`
    );
    process.exit(1);
  }
  const committed = readFileSync(GENERATED_OUTPUT_PATH, 'utf-8');
  const fresh = generateModuleSource();
  if (committed !== fresh) {
    console.error(
      'input-validators.generated.js is stale -- it does not match what ' +
        'generate-input-validators.ts produces from the current frozen input ' +
        'schemas. Run `pnpm generate:input-validators` and commit the result.'
    );
    process.exit(1);
  }
  console.log('input-validators.generated.js is up to date.');
}

main();

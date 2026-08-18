/**
 * SUN-1200 checkpoint F remediation — proves both committed generated
 * standalone-validator modules
 * (`src/generated/{input,output}-validators.generated.js`) are
 * byte-identical to what `generate-input-validators.mts` would produce
 * right now from the current canonical schemas. A stale generated file
 * (someone hand-edited it, or a canonical schema changed without
 * regenerating) fails this check and therefore `pnpm check`.
 */
import { readFileSync, existsSync } from 'node:fs';
import {
  GENERATED_OUTPUT_PATH,
  GENERATED_OUTPUT_VALIDATORS_PATH,
  generateModuleSource,
  generateOutputModuleSource,
} from './generate-input-validators.mts';

function checkOne(path: string, fresh: string, label: string): boolean {
  if (!existsSync(path)) {
    console.error(`Missing generated file: ${path}. Run \`pnpm generate:input-validators\`.`);
    return false;
  }
  const committed = readFileSync(path, 'utf-8');
  if (committed !== fresh) {
    console.error(
      `${label} is stale -- it does not match what generate-input-validators.mts ` +
        'produces from the current canonical schemas. Run `pnpm generate:input-validators` ' +
        'and commit the result.'
    );
    return false;
  }
  console.log(`${label} is up to date.`);
  return true;
}

function main(): void {
  const inputOk = checkOne(
    GENERATED_OUTPUT_PATH,
    generateModuleSource(),
    'input-validators.generated.js'
  );
  const outputOk = checkOne(
    GENERATED_OUTPUT_VALIDATORS_PATH,
    generateOutputModuleSource(),
    'output-validators.generated.js'
  );
  if (!inputOk || !outputOk) {
    process.exit(1);
  }
}

main();

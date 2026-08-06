import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import { createHash } from 'crypto';
import { parse as parseYaml } from 'yaml';
import { JSONSchema } from 'json-schema-library';

interface BaselineEntry {
  path: string;
  sha256: string;
}

interface ReleaseDescriptor {
  release: {
    name: string;
    version: string;
    status: string;
    frozen_at: string;
    source_commit: string;
  };
  pcc_dependency: {
    schema_release: string;
    document_version: string;
    schema_sha256: string;
  };
  services: Array<{
    service_id: string;
    contract_version: string;
    input_schema: string;
    input_schema_sha256: string;
    output_schema: string;
    output_schema_sha256: string;
  }>;
  common_schemas: Array<{ path: string; sha256: string }>;
  artifacts: {
    typescript_models_manifest: string;
    python_models_manifest: string;
    openapi_manifest: string;
    service_metadata_manifest: string;
  };
  compatibility: {
    policy_version: string;
    baseline_path: string;
    strict_mode: boolean;
  };
}

interface CompatibilityReport {
  baseline_version: string;
  candidate_version: string;
  compatible: boolean;
  required_version_bump: 'none' | 'patch' | 'minor' | 'major';
  changes: ChangeReport[];
  policy_version: string;
  verdict: 'pass' | 'fail';
  comparison_timestamp: string;
  pcc_dependency: {
    schema_release: string;
    schema_sha256: string;
  };
  files_compared: number;
  tool_versions: {
    node: string;
    pnpm: string;
  };
}

interface ChangeReport {
  affected_file: string;
  affected_schema_path: string;
  json_pointer: string;
  old_value: unknown;
  new_value: unknown;
  classified_change_type: string;
  compatibility_direction:
    | 'producer-backward-compatible'
    | 'consumer-backward-compatible'
    | 'bidirectionally-compatible'
    | 'source-compatible-only'
    | 'wire-compatible-only'
    | 'incompatible';
  required_version_bump: 'none' | 'patch' | 'minor' | 'major';
  policy_rule: string;
  severity: 'info' | 'warning' | 'error';
  human_review_required: boolean;
}

function sha256File(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

function loadReleaseDescriptor(path: string): ReleaseDescriptor {
  const content = readFileSync(path, 'utf-8');
  return parseYaml(content) as ReleaseDescriptor;
}

function loadBaselineManifest(baselinePath: string): Map<string, string> {
  const sumsPath = join(baselinePath, 'SHA256SUMS');
  if (!existsSync(sumsPath)) {
    throw new Error(`Baseline SHA256SUMS not found at ${sumsPath}`);
  }
  const content = readFileSync(sumsPath, 'utf-8');
  const map = new Map<string, string>();
  for (const line of content.trim().split('\n')) {
    const [hash, filepath] = line.split(/\s+/);
    if (hash && filepath) {
      map.set(filepath.replace(/^\.\//, ''), hash);
    }
  }
  return map;
}

function getAllFiles(dir: string, baseDir: string): string[] {
  const files: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(baseDir, fullPath);
    if (entry.isDirectory()) {
      files.push(...getAllFiles(fullPath, baseDir));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith('.json') || entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))
    ) {
      files.push(relPath);
    }
  }
  return files.sort();
}

function compareSchemas(oldSchema: object, newSchema: object, path: string = ''): ChangeReport[] {
  const changes: ChangeReport[] = [];

  const oldKeys = new Set(Object.keys(oldSchema));
  const newKeys = new Set(Object.keys(newSchema));

  for (const key of oldKeys) {
    const fullPath = path ? `${path}.${key}` : key;
    const jsonPointer = '/' + fullPath.split('.').map(encodeURIComponent).join('/');

    if (!newKeys.has(key)) {
      changes.push({
        affected_file: '',
        affected_schema_path: fullPath,
        json_pointer: jsonPointer,
        old_value: (oldSchema as Record<string, unknown>)[key],
        new_value: undefined,
        classified_change_type: 'property_removed',
        compatibility_direction: 'incompatible',
        required_version_bump: 'major',
        policy_rule: 'property_removed requires major version bump',
        severity: 'error',
        human_review_required: true,
      });
    } else {
      const oldVal = (oldSchema as Record<string, unknown>)[key];
      const newVal = (newSchema as Record<string, unknown>)[key];

      if (
        typeof oldVal === 'object' &&
        oldVal !== null &&
        typeof newVal === 'object' &&
        newVal !== null
      ) {
        changes.push(...compareSchemas(oldVal, newVal, fullPath));
      } else if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        let changeType = 'property_type_changed';
        if (key === 'enum' && Array.isArray(oldVal) && Array.isArray(newVal)) {
          const oldEnum = oldVal as string[];
          const newEnum = newVal as string[];
          const added = newEnum.filter((v) => !oldEnum.includes(v));
          const removed = oldEnum.filter((v) => !newEnum.includes(v));
          if (added.length > 0 && removed.length === 0) changeType = 'enum_value_added';
          else if (removed.length > 0 && added.length === 0) changeType = 'enum_value_removed';
          else if (added.length > 0 && removed.length > 0) changeType = 'enum_value_changed';
        } else if (key === 'required' && Array.isArray(oldVal) && Array.isArray(newVal)) {
          const oldReq = oldVal as string[];
          const newReq = newVal as string[];
          const added = newReq.filter((v) => !oldReq.includes(v));
          const removed = oldReq.filter((v) => !newReq.includes(v));
          if (added.length > 0 && removed.length === 0) changeType = 'required_property_added';
          else if (removed.length > 0 && added.length === 0)
            changeType = 'required_property_removed';
          else changeType = 'required_list_changed';
        } else if (key === 'additionalProperties') {
          changeType = 'additional_properties_changed';
        } else if (key === 'minimum') {
          changeType = Number(newVal) > Number(oldVal) ? 'minimum_increased' : 'minimum_decreased';
        } else if (key === 'maximum') {
          changeType = Number(newVal) > Number(oldVal) ? 'maximum_increased' : 'maximum_decreased';
        } else if (key === 'pattern') {
          changeType = 'pattern_changed';
        } else if (key === 'format') {
          changeType = 'format_changed';
        } else if (key === 'default') {
          changeType = 'default_changed';
        } else if (key === '$ref') {
          changeType = 'reference_target_changed';
        } else if (key === 'type') {
          changeType = 'property_type_changed';
        }

        const isMajor = [
          'property_removed',
          'required_property_added',
          'property_renamed',
          'property_type_changed',
          'enum_value_added',
          'enum_value_removed',
          'minimum_increased',
          'maximum_decreased',
          'pattern_changed',
          'format_changed',
          'additional_properties_changed',
          'required_list_changed',
          'one_of_changed',
          'any_of_changed',
          'all_of_changed',
          'reference_target_changed',
          'identifier_changed',
          'service_version_changed',
          'pcc_dependency_changed',
          'semantic_validator_changed',
          'openapi_operation_changed',
          'error_contract_changed',
          'pricing_semantics_changed',
          'signature_binding_changed',
        ].includes(changeType);

        changes.push({
          affected_file: '',
          affected_schema_path: fullPath,
          json_pointer: jsonPointer,
          old_value: oldVal,
          new_value: newVal,
          classified_change_type: changeType,
          compatibility_direction: isMajor ? 'incompatible' : 'bidirectionally-compatible',
          required_version_bump: isMajor ? 'major' : 'minor',
          policy_rule: `${changeType} classified as ${isMajor ? 'major' : 'minor_candidate'}`,
          severity: isMajor ? 'error' : 'warning',
          human_review_required: true,
        });
      }
    }
  }

  for (const key of newKeys) {
    if (!oldKeys.has(key)) {
      const fullPath = path ? `${path}.${key}` : key;
      const jsonPointer = '/' + fullPath.split('.').map(encodeURIComponent).join('/');
      changes.push({
        affected_file: '',
        affected_schema_path: fullPath,
        json_pointer: jsonPointer,
        old_value: undefined,
        new_value: (newSchema as Record<string, unknown>)[key],
        classified_change_type: 'optional_property_added',
        compatibility_direction: 'bidirectionally-compatible',
        required_version_bump: 'minor',
        policy_rule:
          'optional_property_added requires minor version bump under strict-consumer evaluation',
        severity: 'warning',
        human_review_required: true,
      });
    }
  }

  return changes;
}

async function baselineVerify(baselinePath: string): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  const manifest = loadBaselineManifest(baselinePath);

  for (const [relPath, expectedHash] of manifest) {
    const fullPath = join(baselinePath, relPath);
    if (!existsSync(fullPath)) {
      errors.push(`Missing baseline file: ${relPath}`);
      continue;
    }
    const actualHash = sha256File(fullPath);
    if (actualHash !== expectedHash) {
      errors.push(`Hash mismatch for ${relPath}: expected ${expectedHash}, got ${actualHash}`);
    }
  }

  const allFiles = getAllFiles(baselinePath, baselinePath);
  for (const file of allFiles) {
    if (!manifest.has(file) && !file.endsWith('SHA256SUMS')) {
      errors.push(`Extra file in baseline not in manifest: ${file}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

async function releaseVerify(
  releasePath: string,
  baselinePath: string
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  const release = loadReleaseDescriptor(releasePath);
  const repoRoot = resolve(baselinePath, '..', '..', '..');

  if (release.release.version !== '1.0.0') {
    errors.push(`Release version mismatch: expected 1.0.0, got ${release.release.version}`);
  }

  if (release.pcc_dependency.schema_release !== '1.0.1') {
    errors.push(
      `PCC schema release mismatch: expected 1.0.1, got ${release.pcc_dependency.schema_release}`
    );
  }

  if (
    release.pcc_dependency.schema_sha256 !==
    'f664208e387b161ab7897d8544d9c7d987501eba5764e2dde0ea69586e33dbb5'
  ) {
    errors.push(`PCC schema SHA256 mismatch`);
  }

  for (const service of release.services) {
    const inputPath = join(repoRoot, service.input_schema);
    const outputPath = join(repoRoot, service.output_schema);
    if (!existsSync(inputPath)) {
      errors.push(`Service ${service.service_id} input schema not found: ${inputPath}`);
    } else {
      const hash = sha256File(inputPath);
      if (hash !== service.input_schema_sha256) {
        errors.push(`Service ${service.service_id} input schema hash mismatch`);
      }
    }
    if (!existsSync(outputPath)) {
      errors.push(`Service ${service.service_id} output schema not found: ${outputPath}`);
    } else {
      const hash = sha256File(outputPath);
      if (hash !== service.output_schema_sha256) {
        errors.push(`Service ${service.service_id} output schema hash mismatch`);
      }
    }
  }

  for (const common of release.common_schemas) {
    const commonPath = join(repoRoot, common.path);
    if (!existsSync(commonPath)) {
      errors.push(`Common schema not found: ${commonPath}`);
    } else {
      const hash = sha256File(commonPath);
      if (hash !== common.sha256) {
        errors.push(`Common schema ${common.path} hash mismatch`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

async function compatCheck(
  currentSchemasDir: string,
  baselinePath: string,
  releaseDescriptorPath: string
): Promise<CompatibilityReport> {
  const release = loadReleaseDescriptor(releaseDescriptorPath);
  const baselineManifest = loadBaselineManifest(baselinePath);
  const repoRoot = resolve(baselinePath, '..', '..', '..');

  const changes: ChangeReport[] = [];
  let filesCompared = 0;

  for (const [relPath, expectedHash] of baselineManifest) {
    if (relPath === 'SHA256SUMS' || relPath === 'COMPATIBILITY_REPORT.json') continue;

    let currentPath: string;
    if (relPath.startsWith('schemas/')) {
      currentPath = join(repoRoot, relPath);
    } else if (relPath.startsWith('openapi/')) {
      currentPath = join(repoRoot, 'packages', 'contracts', 'generated', relPath);
    } else if (relPath.startsWith('metadata/')) {
      currentPath = join(repoRoot, 'registry', 'services', relPath.replace('metadata/', ''));
    } else if (relPath.startsWith('manifests/')) {
      currentPath = join(repoRoot, 'schemas', relPath.replace('manifests/', ''));
    } else if (relPath === 'CONTRACT_RELEASE.yaml') {
      currentPath = join(repoRoot, 'contracts', 'CONTRACT_RELEASE.yaml');
    } else {
      currentPath = join(repoRoot, relPath);
    }

    if (!existsSync(currentPath)) {
      changes.push({
        affected_file: relPath,
        affected_schema_path: relPath,
        json_pointer: '',
        old_value: 'exists',
        new_value: 'missing',
        classified_change_type: 'property_removed',
        compatibility_direction: 'incompatible',
        required_version_bump: 'major',
        policy_rule: 'Baseline file missing in current contracts',
        severity: 'error',
        human_review_required: true,
      });
      continue;
    }

    const currentHash = sha256File(currentPath);
    if (currentHash !== expectedHash) {
      filesCompared++;
      const oldContent = JSON.parse(readFileSync(join(baselinePath, relPath), 'utf-8'));
      const newContent = JSON.parse(readFileSync(currentPath, 'utf-8'));

      const schemaChanges = compareSchemas(oldContent, newContent);
      for (const change of schemaChanges) {
        change.affected_file = relPath;
      }
      changes.push(...schemaChanges);
    } else {
      filesCompared++;
    }
  }

  const hasMajor = changes.some((c) => c.required_version_bump === 'major');
  const hasMinor = changes.some((c) => c.required_version_bump === 'minor');
  const hasPatch = changes.some((c) => c.required_version_bump === 'patch');

  let requiredBump: 'none' | 'patch' | 'minor' | 'major' = 'none';
  if (hasMajor) requiredBump = 'major';
  else if (hasMinor) requiredBump = 'minor';
  else if (hasPatch) requiredBump = 'patch';

  const compatible = changes.length === 0;

  return {
    baseline_version: release.release.version,
    candidate_version: release.release.version,
    compatible,
    required_version_bump: requiredBump,
    changes,
    policy_version: release.compatibility.policy_version,
    verdict: compatible ? 'pass' : 'fail',
    comparison_timestamp: new Date().toISOString(),
    pcc_dependency: {
      schema_release: release.pcc_dependency.schema_release,
      schema_sha256: release.pcc_dependency.schema_sha256,
    },
    files_compared: filesCompared,
    tool_versions: {
      node: process.version,
      pnpm: '9.x',
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  const repoRoot = resolve(process.cwd(), '..', '..');
  const baselinePath = join(repoRoot, 'contracts', 'releases', '1.0.0');
  const releaseDescriptorPath = join(repoRoot, 'contracts', 'CONTRACT_RELEASE.yaml');

  switch (command) {
    case 'baseline:verify': {
      console.log('Verifying frozen baseline...');
      const result = await baselineVerify(baselinePath);
      if (result.valid) {
        console.log('✓ Baseline verification passed');
        process.exit(0);
      } else {
        console.error('✗ Baseline verification failed:');
        for (const err of result.errors) {
          console.error(`  - ${err}`);
        }
        process.exit(1);
      }
    }

    case 'release:verify': {
      console.log('Verifying release descriptor...');
      const result = await releaseVerify(releaseDescriptorPath, baselinePath);
      if (result.valid) {
        console.log('✓ Release verification passed');
        process.exit(0);
      } else {
        console.error('✗ Release verification failed:');
        for (const err of result.errors) {
          console.error(`  - ${err}`);
        }
        process.exit(1);
      }
    }

    case 'compat': {
      console.log('Comparing current contracts to baseline...');
      const report = await compatCheck(
        join(repoRoot, 'schemas'),
        baselinePath,
        releaseDescriptorPath
      );
      console.log(JSON.stringify(report, null, 2));
      process.exit(report.verdict === 'pass' ? 0 : 1);
    }

    case 'compat:check': {
      console.log('Running strict compatibility check...');
      const report = await compatCheck(
        join(repoRoot, 'schemas'),
        baselinePath,
        releaseDescriptorPath
      );
      if (report.verdict === 'pass') {
        console.log('✓ Compatibility check passed');
        process.exit(0);
      } else {
        console.error('✗ Compatibility check failed:');
        console.error(JSON.stringify(report, null, 2));
        process.exit(1);
      }
    }

    default:
      console.error('Usage: tsx compat.ts [baseline:verify|release:verify|compat|compat:check]');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});

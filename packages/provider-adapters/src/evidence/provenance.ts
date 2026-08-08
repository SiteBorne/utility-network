import type { ProvenanceStep } from '../types';

export interface ProvenanceRoute {
  steps: ProvenanceStep[];
  rootSourceUri: string;
  rootContentHash: string;
}

export function createProvenanceRoute(
  rootSourceUri: string,
  rootContentHash: string
): ProvenanceRoute {
  return {
    steps: [],
    rootSourceUri,
    rootContentHash,
  };
}

export function addProvenanceStep(
  route: ProvenanceRoute,
  step: string,
  adapterVersion: string,
  inputHash?: string,
  outputHash?: string
): ProvenanceRoute {
  return {
    ...route,
    steps: [
      ...route.steps,
      {
        step,
        adapter_version: adapterVersion,
        timestamp: new Date().toISOString(),
        input_hash: inputHash,
        output_hash: outputHash,
      },
    ],
  };
}

export function mergeProvenanceRoutes(routes: ProvenanceRoute[]): ProvenanceRoute {
  if (routes.length === 0) {
    throw new Error('Cannot merge empty routes');
  }
  if (routes.length === 1) return routes[0];

  const allSteps = routes.flatMap((r) => r.steps);
  return {
    steps: allSteps,
    rootSourceUri: routes[0].rootSourceUri,
    rootContentHash: routes[0].rootContentHash,
  };
}

export function validateProvenanceRoute(route: ProvenanceRoute): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!route.rootSourceUri) {
    errors.push('Missing root source URI');
  }
  if (!route.rootContentHash) {
    errors.push('Missing root content hash');
  }
  if (route.steps.length === 0) {
    errors.push('No provenance steps recorded');
  }

  for (let i = 0; i < route.steps.length; i++) {
    const step = route.steps[i];
    if (!step.step) {
      errors.push(`Step ${i}: missing step description`);
    }
    if (!step.adapter_version) {
      errors.push(`Step ${i}: missing adapter version`);
    }
    if (!step.timestamp) {
      errors.push(`Step ${i}: missing timestamp`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function getTransformationHistory(route: ProvenanceRoute): ProvenanceStep[] {
  return route.steps;
}

export function getAdapterVersions(route: ProvenanceRoute): string[] {
  return [...new Set(route.steps.map((s) => s.adapter_version))];
}

export function hasStep(route: ProvenanceRoute, stepName: string): boolean {
  return route.steps.some((s) => s.step === stepName);
}

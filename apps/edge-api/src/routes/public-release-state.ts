import { resolveEffectiveProductionStatusByServiceId } from '../control-plane/config/production-payment';
import { resolveAgentCardSigningIdentity } from '../control-plane/config/agent-card-signing';
import type { Env } from '../control-plane/config/env';

export interface PublicReleaseState {
  status: 'ready' | 'not_ready';
  phase: 'production' | 'unconfigured';
  productionServicesEnabled: boolean;
  blockers: string[];
  reason: string;
}

/**
 * Derives public-runtime readiness from dependencies required by the
 * intentionally paid-disabled initial release. Paid-service activation is a
 * separate fact and never gates this readiness result.
 */
export async function derivePublicReleaseState(env: Env | undefined): Promise<PublicReleaseState> {
  const hasDb = Boolean(env?.DB);
  const productionServicesEnabled = Object.values(
    resolveEffectiveProductionStatusByServiceId(env, hasDb)
  ).some(Boolean);

  if (env?.ENVIRONMENT !== 'production') {
    return {
      status: 'not_ready',
      phase: 'unconfigured',
      productionServicesEnabled,
      blockers: ['production_environment_not_configured'],
      reason: 'Public runtime is not ready: production environment is not configured.',
    };
  }

  const blockers: string[] = [];
  if (!hasDb) blockers.push('database_binding_missing');

  const hasSigningKey = Boolean(env.AGENT_CARD_SIGNING_PRIVATE_KEY);
  const hasSigningKeyId = Boolean(env.AGENT_CARD_SIGNING_KEY_ID);
  if (!hasSigningKey && !hasSigningKeyId) {
    blockers.push('agent_card_signing_identity_missing');
  } else {
    try {
      const signingIdentity = await resolveAgentCardSigningIdentity(env);
      if (!signingIdentity) blockers.push('agent_card_signing_identity_missing');
    } catch {
      blockers.push('agent_card_signing_identity_invalid');
    }
  }

  if (blockers.length > 0) {
    return {
      status: 'not_ready',
      phase: 'production',
      productionServicesEnabled,
      blockers,
      reason: `Public runtime is not ready: ${blockers.join(', ')}.`,
    };
  }

  return {
    status: 'ready',
    phase: 'production',
    productionServicesEnabled,
    blockers: [],
    reason: productionServicesEnabled
      ? 'Public production runtime ready; paid services active.'
      : 'Public production runtime ready; paid services disabled by policy.',
  };
}

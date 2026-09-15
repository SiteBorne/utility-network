/**
 * RuntimeStateOverlay (Master Reference Part II §XI). Not a second
 * canonical model: `OverlayDomain ⊆ StaticPossibilitySpace`. Every type
 * here is structurally incapable of widening a static fact -- there is no
 * field anywhere in this module that could set `protocolExposed: true`,
 * invent a service/interaction/surface, raise a governed price ceiling, or
 * assert a security mechanism absent from the static model. The resolver in
 * effective-view.ts enforces the remaining cross-object narrowing rules
 * that the type system alone cannot (e.g. "overlay price must not exceed
 * governedMaxPrice").
 */
import type { EvmAddress, IsoTimestamp, UsdAmount } from './primitives';
import type { CanonicalServiceIdValue } from './service-id';
import type { SecurityMechanismKind } from './types';
import type { SettlementNetworkFamily } from './types';
import type { DeploymentVersion } from './versions';
import type { EvidenceRef } from './evidence';
import { UNKNOWN, type MeasuredOrUnmeasured, type Unknown_ } from './sentinels';
import { NOT_CONFIGURED, type NotConfigured } from './sentinels';

export interface RouteRuntimeState {
  readonly serviceId: CanonicalServiceIdValue;
  readonly interactionOperationId: string;
  /** ANDed against static `protocolExposed` by the resolver -- can only
   * narrow an already-exposed interaction down to disabled, never the
   * reverse. */
  readonly runtimeEnabled: boolean;
  readonly economicAdmissionEnabled: boolean;
}

export interface EconomicRuntimeState {
  readonly serviceId: CanonicalServiceIdValue;
  readonly effectiveRuntimePrice:
    | { readonly amount: UsdAmount; readonly currency: 'USD' }
    | Unknown_;
  readonly payTo: EvmAddress | NotConfigured;
  readonly activeNetwork: SettlementNetworkFamily | Unknown_;
  readonly activeAsset:
    | { readonly symbol: string; readonly contractAddress: EvmAddress }
    | Unknown_;
}

export interface SecurityRuntimeState {
  readonly mechanismKind: SecurityMechanismKind;
  readonly measuredLevel: MeasuredOrUnmeasured<'ACTIVE' | 'VERIFIED'>;
  readonly measuredAt: IsoTimestamp;
  readonly evidenceRef?: EvidenceRef;
}

export interface QualificationRuntimeState {
  readonly serviceId: CanonicalServiceIdValue;
  readonly currentPromotionState: string; // LifecycleState, kept as string here to avoid a
  // circular dependency; validators.ts checks membership.
  readonly qualifiedForProduction: boolean;
}

export interface RuntimeStateOverlay {
  readonly observedAt: IsoTimestamp;
  readonly deploymentVersion: DeploymentVersion;
  readonly routes: readonly RouteRuntimeState[];
  readonly economics: readonly EconomicRuntimeState[];
  readonly security: readonly SecurityRuntimeState[];
  readonly qualification: readonly QualificationRuntimeState[];
}

/** An empty overlay narrows everything to disabled/unknown -- the safe,
 * always-valid starting point (e.g. for a static-only build artifact with
 * no live measurement yet). */
export function emptyOverlay(observedAt: IsoTimestamp): RuntimeStateOverlay {
  return {
    observedAt,
    deploymentVersion: UNKNOWN,
    routes: [],
    economics: [],
    security: [],
    qualification: [],
  };
}

export { UNKNOWN, NOT_CONFIGURED };

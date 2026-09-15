/**
 * A faithful type for today's registry/services/*.json shape (Master
 * Reference Part II §XVI). Treated purely as input data -- including known
 * frozen release fields (`protocols.*` is "planned" everywhere, confirmed
 * by direct inspection of all 8 files on 2026-09-18) -- never corrected or
 * reinterpreted during import.
 */
import type { ReleaseProtocolExposureValue } from '../types';

export interface LegacyPriceAmount {
  amount: string;
  currency: string;
}

export interface LegacyProtocolsBlock {
  x402: ReleaseProtocolExposureValue;
  mcp: ReleaseProtocolExposureValue;
  a2a: ReleaseProtocolExposureValue;
  nevermined: ReleaseProtocolExposureValue;
  agentverse: ReleaseProtocolExposureValue;
  coinbase_bazaar: ReleaseProtocolExposureValue;
  mcp_registry: ReleaseProtocolExposureValue;
}

export interface LegacyRegistryServiceFile {
  service_id: string;
  service_version: string;
  title: string;
  description: string;
  capabilities: string[];
  input_schema_uri: string;
  input_schema_hash: string;
  output_schema_uri: string;
  output_schema_hash: string;
  pcc_version: string;
  pricing_schemes: string[];
  base_price: LegacyPriceAmount;
  maximum_price: LegacyPriceAmount;
  execution_mode: string;
  maximum_input_bytes: number;
  expected_latency_class: string;
  authorization_classification: string;
  promotion_state: string;
  production_enabled: boolean;
  declared_limitations: string[];
  protocols: LegacyProtocolsBlock;
  updated_at: string;
}

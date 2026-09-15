/**
 * A faithful type for today's registry/services/*.json shape (Master
 * Reference Part II §XVI). Treated purely as input data -- including known
 * stale fields (`protocols.*` is "planned" everywhere, confirmed by direct
 * inspection of all 8 files on 2026-09-18) -- never corrected during
 * import.
 */

export interface LegacyPriceAmount {
  amount: string;
  currency: string;
}

export interface LegacyProtocolsBlock {
  x402: string;
  mcp: string;
  a2a: string;
  nevermined: string;
  agentverse: string;
  coinbase_bazaar: string;
  mcp_registry: string;
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

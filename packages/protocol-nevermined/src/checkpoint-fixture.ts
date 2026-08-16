/**
 * SUN-0900B checkpoint 1 — the frozen, authoritative external registration
 * for the controlled sandbox self-test. Public sandbox identifiers only:
 * a Nevermined agentId/planId are not secret (they're returned by the
 * registration API and readable by anyone with the builder key, same as
 * any other resource ID). No credential, delegation, or access token
 * belongs here or is ever recorded here.
 *
 * The live harness (`apps/edge-api/tests/live/nevermined-live-exact.test.ts`)
 * must reconcile against these IDs via `reconcileNeverminedRegistration`
 * (registry-reconciliation.ts) before ever considering a fresh
 * `registerAgentAndPlan` call — this checkpoint's registration must never
 * be repeated.
 *
 * Economics below were independently read back from the persisted plan
 * (`payments.plans.getPlan(planId)`) after registration, not merely
 * assumed from the registration request: `registry.price.amounts` summed
 * to `9000` exactly, `registry.price.receivers[0]` matched
 * `sellerReceiver` exactly, and `registry.price.tokenAddress` matched
 * `asset` exactly. The remainder (`90` atomic) went to a distinct
 * Nevermined platform-fee address, not to SITEBORNE — kept separate from
 * `grossBuyerAmountAtomic`/`sellerReceiver` here on purpose; this fixture
 * never conflates platform fee with seller net proceeds.
 */

export interface Sun0900BCheckpoint1Registration {
  service_id: 'web_context_verified.v1';
  environment: 'sandbox';
  network: 'eip155:84532';
  scheme: 'nvm:erc4337';
  agent_id: string;
  plan_id: string;
  agent_name: string;
  plan_name: string;
  /** Total atomic USDC (6 decimals) the buyer pays — the canonical
   * SITEBORNE gross amount, independently confirmed against the
   * persisted plan, not merely the registration request. */
  gross_buyer_amount_atomic: string;
  /** SITEBORNE's own net-proceeds receiver — distinct from any
   * Nevermined platform-fee receiver also present on the persisted
   * plan. */
  seller_receiver: string;
  asset_token_address: string;
  is_trial_plan: false;
  billing_model: 'pay-as-you-go';
  registered_at: string;
}

export const SUN_0900B_CHECKPOINT_1_REGISTRATION: Sun0900BCheckpoint1Registration = {
  service_id: 'web_context_verified.v1',
  environment: 'sandbox',
  network: 'eip155:84532',
  scheme: 'nvm:erc4337',
  agent_id: '37714377069519076502259354421538507339628407587207707299869594618861814144272',
  plan_id: '94523930722525068656272128894334430057768353189467518442660086462546695282012',
  agent_name: 'Verified Web Context',
  plan_name: 'Verified Web Context — PAYG plan',
  gross_buyer_amount_atomic: '9000',
  seller_receiver: '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1',
  asset_token_address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  is_trial_plan: false,
  billing_model: 'pay-as-you-go',
  registered_at: '2026-08-12T07:23:45.750Z',
};

/**
 * SUN-0900B checkpoint 2J — frozen public registration for
 * `company_evidence_graph.v1`. The identifiers and economics below were
 * accepted only after a reconcile-first, builder-only registration and a full
 * authoritative agent/plan GET read-back passed
 * `validateNeverminedFixedPaygPlan`.
 */
export interface Sun0900BCompanyRegistration {
  service_id: 'company_evidence_graph.v1';
  environment: 'sandbox';
  network: 'eip155:84532';
  scheme: 'nvm:erc4337';
  agent_id: string;
  plan_id: string;
  agent_name: string;
  plan_name: string;
  gross_buyer_amount_atomic: '39000';
  seller_receiver: string;
  asset_token_address: string;
  is_trial_plan: false;
  billing_model: 'pay-as-you-go';
}

export const SUN_0900B_COMPANY_REGISTRATION: Sun0900BCompanyRegistration = {
  service_id: 'company_evidence_graph.v1',
  environment: 'sandbox',
  network: 'eip155:84532',
  scheme: 'nvm:erc4337',
  agent_id: '63058244394774357835944659628164807563769006924765007721830897155339294179447',
  plan_id: '61176543225966665382887590264143689398477975837289843272089835781341158489584',
  agent_name: 'Company Evidence Graph',
  plan_name: 'Company Evidence Graph — PAYG plan',
  gross_buyer_amount_atomic: '39000',
  seller_receiver: '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1',
  asset_token_address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  is_trial_plan: false,
  billing_model: 'pay-as-you-go',
};

/**
 * SUN-0900B checkpoint 2K — frozen public registration for
 * `verify_agent_output.v1`. Accepted after one builder-only,
 * reconcile-first registration and authoritative fixed-PAYG GET validation.
 */
export interface Sun0900BVerifyRegistration {
  service_id: 'verify_agent_output.v1';
  environment: 'sandbox';
  network: 'eip155:84532';
  scheme: 'nvm:erc4337';
  agent_id: string;
  plan_id: string;
  agent_name: string;
  plan_name: string;
  gross_buyer_amount_atomic: '19000';
  seller_receiver: string;
  asset_token_address: string;
  is_trial_plan: false;
  billing_model: 'pay-as-you-go';
}

export const SUN_0900B_VERIFY_REGISTRATION: Sun0900BVerifyRegistration = {
  service_id: 'verify_agent_output.v1',
  environment: 'sandbox',
  network: 'eip155:84532',
  scheme: 'nvm:erc4337',
  agent_id: '75096875289866166059253207097165867959384005104090226106621988801798698661167',
  plan_id: '106105151389083481380363516765690985250481102170794631056207896452064676707220',
  agent_name: 'Agent Output Verification',
  plan_name: 'Agent Output Verification — PAYG plan',
  gross_buyer_amount_atomic: '19000',
  seller_receiver: '0x7f44a2dd237938F18632d4CcA40f4c690295E6E1',
  asset_token_address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  is_trial_plan: false,
  billing_model: 'pay-as-you-go',
};

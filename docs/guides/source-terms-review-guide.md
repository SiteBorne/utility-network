# SITEBORNE Utility Network - Source-Terms Review Guide

## Overview

This guide documents the process for reviewing and managing source terms (TERMS)
for the SITEBORNE Utility Network. Terms are used to control access to data
sources and must be reviewed before activation.

## Terms Status Categories

1. **pending_review**: Terms have been submitted for review but not yet approved
2. **pending_approval**: Terms are pending final approval from TermsGuard
3. **active**: Terms are active and can be used for data access
4. **inactive**: Terms are inactive but may be reactivated
5. **deprecated**: Terms are no longer recommended for use
6. **retired**: Terms are permanently retired and should not be used

## Terms Review Process

1. **Submission**: Terms are submitted via the TERMS_MANIFEST.yaml file
2. **Initial Review**: Terms are checked for completeness and validity
3. **Security Review**: Terms are evaluated for security implications
4. **Review Cycle**: Terms are reviewed on a regular schedule
5. **Approval**: Terms are approved or rejected based on review findings
6. **Activation**: Approved terms can be activated for use by adapters

## Terms Manifest Format

The terms manifest is a YAML file with the following structure:

```yaml
provider_id: string
source_class: string
base_uris: array of strings
capabilities: array of strings
commercial_application_allowed: boolean
automated_access_allowed: boolean
transformed_output_allowed: boolean
raw_access_resale_allowed: boolean
sensitive_data_allowed: boolean
account_sharing_allowed: boolean
quota_multiplication_allowed: boolean
credentials_required: boolean
terms_uri: string
terms_hash: string or null
terms_review_status: 'pending_review' | 'pending_approval' | 'active' | 'inactive' | 'deprecated' | 'retired'
reviewed_at: timestamp or null
reviewed_by: string or null
rate_policy: object with rate limiting parameters
promotion_state: 'fixture_tested' | 'live_verified' | 'policy_blocked'
```

## Review Process

1. **Submission**: A new terms manifest is created and submitted for review
2. **Initial Validation**: The terms are validated for structural correctness
3. **Security Review**: Terms are evaluated for potential security risks
4. **Review Cycle**: Terms are reviewed on a regular schedule (e.g., quarterly)
5. **Decision**: Terms are either approved, rejected, or sent back for revision
6. **Activation**: Approved terms can be activated for use by adapters

## Terms and Provider Classification

Each provider is classified based on its terms status:

- **fixture_verified**: Adapter has verified fixtures and terms are
  pending_review
- **locally_live_verified**: Adapter has verified fixtures and terms are active
- **live_unverified**: Adapter is live but terms are pending_review
- **policy_blocked**: Terms are blocked by policy
- **degraded**: Adapter has partial functionality or verification
- **unavailable**: Adapter is unavailable for use

## Terms and Activation Policy

- **pending_review**: No provider is production_verified until terms are
  reviewed
- **policy_blocked**: Providers with policy_blocked terms cannot be used for
  live access
- **live_unverified**: Providers may be used in testing but not in production
  until terms are approved
- **policy_blocked or live_unverified**: These are the expected states for
  SUN-0300 until terms are reviewed

## Audit and Tracking

All term changes must be recorded in audit events with:

- Provider ID
- Capability
- Timestamp
- Changes summary
- Classification
- Review status

## Review Checklist

- [ ] Terms manifest is valid YAML
- [ ] All required fields are present
- [ ] Terms hash is correctly calculated
- [ ] Terms review status is valid
- [ ] Terms review status transitions are logical
- [ ] No sensitive data is included in terms
- [ ] Terms reference valid provider IDs
- [ ] Rate policy is compatible with provider capabilities

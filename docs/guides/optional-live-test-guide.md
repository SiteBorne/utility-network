# SITEBORNE Utility Network - Optional Live-Test Guide

## Overview
Optional live-test gates are disabled by default and require TermsGuard approval to run. They are designed to verify live adapter functionality with minimal risk.

## Guidelines

1. **Default State**: All live gates are disabled/skipped by default
2. **Approval Required**: TermsGuard must explicitly approve each live gate
3. **No Credentials**: Tests must use noncustomer public identifiers
4. **Bounded Timeouts**: All live tests must have configured timeouts
5. **Request Limits**: Request limits must be explicitly configured
6. **No Mutation**: Tests must not mutate or download payload
7. **No Commits**: Downloaded payload must not be committed to repository
8. **Source Drift**: Source drift must be classified and reported
9. **Result Classification**: Results must be classified as skip/pass/fail separately

## Live Gate Definitions

### RUN_LIVE_SEC
- **Default**: Skipped
- **Requirement**: TermsGuard approval
- **Scope**: SEC submissions adapter
- **Identifiers**: Noncustomer public identifiers (e.g., test CIKs)
- **Behavior**: Classify source drift, report skip/pass/fail
- **Expected Result**: Skip (due to pending_review terms)

### RUN_LIVE_OPENALEX
- **Default**: Skipped
- **Requirement**: TermsGuard approval
- **Scope**: OpenAlex adapter
- **Identifiers**: Bounded public identifiers
- **Timeout**: Small configured timeout
- **Request Limit**: Small documented request limit
- **Expected Result**: Skip (policy_blocked or skipped)

### RUN_LIVE_CROSSREF
- **Default**: Skipped
- **Requirement**: TermsGuard approval
- **Scope**: Crossref adapter
- **Identifiers**: Bounded public identifiers
- **Expected Result**: Skip (policy_blocked or skipped)

### RUN_LIVE_GITHUB_PUBLIC
- **Default**: Skipped
- **Requirement**: TermsGuard approval
- **Scope**: GitHub Public adapter
- **Identifiers**: Noncustomer public GitHub identifiers
- **Request Limit**: Bounded (e.g., 10 requests)
- **Expected Result**: Skip (expected to be policy_blocked or skipped)

### RUN_LIVE_FEDERAL_REGISTER
- **Default**: Skipped
- **Requirement**: TermsGuard approval
- **Scope**: Federal Register adapter
- **Identifiers**: Small documented requests
- **Expected Result**: Skip (policy_blocked or skipped)

### RUN_LIVE_PUBLIC_HTTP
- **Default**: Skipped
- **Requirement**: TermsGuard approval
- **Scope**: Public HTTP adapter
- **Identifiers**: Noncustomer public URLs
- **Request Limit**: Small documented limit (e.g., 5 requests)
- **Expected Result**: Skip (expected to be policy_blocked or skipped)

## Implementation Requirements

1. **Disabled by Default**: All gates must default to skipped
2. **TermsGuard Requirement**: Each gate must require TermsGuard approval to run
3. **No Credentials**: Tests must use no credentials
4. **Bounded Timeouts**: All tests must use bounded timeouts
5. **Request Limits**: Must use bounded request limits
6. **No Mutation**: Tests must not mutate data or download payloads
7. **Classification**: Source drift must be classified and reported
8. **Separate Reporting**: Skip/pass/fail must be reported separately

## Implementation Notes

- Live gates should be implemented as separate test suites
- Tests should use fake/isolated environments
- No real credentials or secrets should be used
- Tests should not download actual payloads
- Results should be classified separately from pass/fail
# Security Policy

## Supported Versions

Only the latest production release and the current main branch receive security
updates.

## Reporting a Vulnerability

Report security issues to **security@siteborne.net** or via GitHub Security
Advisories.

Do not disclose vulnerabilities publicly until they have been addressed.

## Security Principles

- **No secrets in code**: All credentials injected at runtime via
  environment/secrets managers
- **Wallet separation**: Seller, testing, provider-expense, treasury, and profit
  wallets are distinct
- **Public data only**: Initial launch processes only public or buyer-authorized
  data
- **Deterministic verification**: No model can override a deterministic
  verification failure
- **Cost guards**: Every execution path has bounded maximum cost
- **Idempotency**: Duplicate requests never create duplicate paid executions

## Threat Model

See [docs/threat-model/](docs/threat-model/) for the complete threat model (to
be developed).

## Disclosure Timeline

- Critical: 7 days
- High: 14 days
- Medium: 30 days
- Low: 90 days

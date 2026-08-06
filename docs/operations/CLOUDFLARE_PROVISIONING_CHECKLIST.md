# Cloudflare Production Provisioning Checklist

## Overview

This checklist covers the steps required to provision Cloudflare resources for
production deployment of the SITEBORNE Utility Network control plane. This is a
blocked_external task and should not be executed during SUN-0200.

## Prerequisites

- Cloudflare account with Workers, D1, R2, Queues, KV, AI, and Browser access
- Domain `siteborne.net` configured in Cloudflare
- Access to Cloudflare dashboard or `wrangler` CLI

## Checklist

### 1. Cloudflare Account Configuration

- [ ] Verify Cloudflare account ID
- [ ] Confirm Workers Paid plan (for D1, R2, Queues, AI, Browser)
- [ ] Verify account has access to all required products
- [ ] Set up billing and spending alerts

### 2. Worker Deployment

- [ ] Create Worker script: `siteborne-utility-edge`
- [ ] Configure compatibility date: `2026-08-05`
- [ ] Enable Node.js compatibility flag
- [ ] Set environment: `production`
- [ ] Configure log level: `info`

### 3. D1 Database

- [ ] Create database: `siteborne-utility`
- [ ] Record database ID
- [ ] Apply migration: `migrations/0001_control_plane_foundation.sql`
- [ ] Verify all tables created
- [ ] Verify constraints and indexes
- [ ] Seed initial service metadata (4 services)

### 4. R2 Bucket

- [ ] Create bucket: `siteborne-artifacts`
- [ ] Configure CORS if needed
- [ ] Set bucket lifecycle rules for retention classes
- [ ] Verify Worker binding works

### 5. Queues

- [ ] Create queue: `siteborne-jobs` (producer/consumer)
- [ ] Create queue: `siteborne-events` (audit events)
- [ ] Configure consumer Worker for `siteborne-jobs`
- [ ] Configure dead letter queue
- [ ] Set retry limits and backoff

### 6. KV Namespace

- [ ] Create namespace: `siteborne-catalog`
- [ ] Record namespace ID
- [ ] Populate with service catalog data

### 7. AI Binding

- [ ] Enable Workers AI
- [ ] Verify model availability for verification services

### 8. Browser Binding

- [ ] Enable Browser Rendering
- [ ] Verify availability for web_context_verified

### 9. Binding Configuration

Update `wrangler.toml` with production values:

```toml
[[d1_databases]]
binding = "DB"
database_name = "siteborne-utility"
database_id = "<PRODUCTION_DATABASE_ID>"

[[r2_buckets]]
binding = "ARTIFACTS"
bucket_name = "siteborne-artifacts"

[[kv_namespaces]]
binding = "CATALOG"
id = "<PRODUCTION_KV_ID>"

[[queues]]
binding = "JOBS"
queue_name = "siteborne-jobs"

[[queues]]
binding = "EVENTS"
queue_name = "siteborne-events"

[ai]
binding = "AI"

[browser]
binding = "BROWSER"
```

### 10. Secrets (via Cloudflare Dashboard or wrangler)

- [ ] `SELLER_WALLET_ADDRESS` - Base wallet address
- [ ] `CDP_API_KEY_NAME` - Coinbase CDP API key name
- [ ] `CDP_API_KEY_PRIVATE_KEY` - CDP private key
- [ ] `CDP_WALLET_SECRET` - CDP wallet secret
- [ ] `NEVERMINED_API_KEY` - Nevermined API key
- [ ] `VOYAGE_API_KEY` - Voyage AI API key
- [ ] `MODAL_TOKEN_ID` - Modal token ID
- [ ] `MODAL_TOKEN_SECRET` - Modal token secret
- [ ] `SENTRY_DSN` - Sentry DSN (optional)

### 11. Preview Environment

- [ ] Create preview environment (e.g., `preview.siteborne.net`)
- [ ] Deploy preview Worker
- [ ] Configure preview D1/R2/Queues
- [ ] Test all endpoints in preview

### 12. Production Environment

- [ ] Deploy production Worker
- [ ] Configure custom domain: `utility.siteborne.net`
- [ ] Set up DNS records
- [ ] Enable strict TLS
- [ ] Configure WAF rules if needed

### 13. Migration Application

- [ ] Apply D1 migration to production
- [ ] Verify schema matches local
- [ ] Run constraint verification queries

### 14. Binding Verification

- [ ] Test D1 read/write
- [ ] Test R2 put/get/delete
- [ ] Test Queue send/receive
- [ ] Test KV get/put
- [ ] Test AI model inference
- [ ] Test Browser rendering

### 15. DNS Routing

- [ ] Configure `utility.siteborne.net` → Worker
- [ ] Configure `api.siteborne.net` → Worker (if separate)
- [ ] Verify DNSSEC
- [ ] Test HTTPS endpoints

### 16. Rollback Plan

- [ ] Document rollback procedure
- [ ] Identify backup D1 snapshot
- [ ] Test rollback in preview
- [ ] Define rollback triggers

### 17. Monitoring Setup

- [ ] Configure Workers metrics
- [ ] Set up alerts for:
  - Queue depth > threshold
  - D1 errors > threshold
  - R2 errors > threshold
  - Worker CPU time > threshold
- [ ] Configure Sentry (if using)

### 18. Security Review

- [ ] Verify no secrets in code
- [ ] Verify WAF rules
- [ ] Verify TLS configuration
- [ ] Verify CORS headers
- [ ] Verify security headers

## Sign-off

- [ ] Engineering lead approval
- [ ] Security review approval
- [ ] Operations team approval
- [ ] Deployment scheduled

## Post-Deployment

- [ ] Smoke test all endpoints
- [ ] Verify contract discovery routes
- [ ] Verify health/readiness
- [ ] Monitor for 24 hours
- [ ] Document any issues

## Notes

- All production secrets must be stored in Cloudflare Secrets, not wrangler.toml
- D1 database ID and KV namespace ID are generated on creation
- Queue names must match Worker bindings exactly
- Preview environment should mirror production as closely as possible
- This checklist is for the blocked_external task "Cloudflare production
  provisioning and binding verification"

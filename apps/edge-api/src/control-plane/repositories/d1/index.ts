import type {
  JobsRepository,
  JobAttemptsRepository,
  StateEventsRepository,
  IdempotencyRepository,
  ArtifactsRepository,
  QueueDispatchRepository,
  QuotaRepository,
  AuditRepository,
  SecurityRepository,
  ServicesRepository,
  ServiceVersionsRepository,
} from './interfaces';
import type { D1Bindings, Clock } from './shared';
import { createInMemoryRepositories } from '../in-memory';

export { D1ServicesRepository, D1ServiceVersionsRepository } from './services';

export { D1JobsRepository, D1JobAttemptsRepository, D1StateEventsRepository } from './jobs';

export { D1IdempotencyRepository } from './idempotency';

// SUN-0700A checkpoint 2 closure — the authoritative D1-backed
// PaymentAttemptRepository (payment-identifier/replay persistence). Not
// yet wired into any HTTP route (that remains a later checkpoint) — see
// apps/edge-api/tests/d1-payment-attempts.test.ts for its proof and
// docs/decisions/0045-d1-payment-attempt-persistence.md for why this is a
// dedicated table rather than an adapter over idempotency_records/
// payment_quotes.
export { D1PaymentAttemptRepository } from './payment-attempts';

export { D1ArtifactsRepository } from './artifacts';
export { D1QueueDispatchRepository } from './artifacts';

export { D1QuotaRepository } from './quota-audit-security';
export { D1AuditRepository } from './quota-audit-security';
export { D1SecurityRepository } from './quota-audit-security';

export interface Repositories {
  jobs: JobsRepository;
  jobAttempts: JobAttemptsRepository;
  stateEvents: StateEventsRepository;
  idempotency: IdempotencyRepository;
  artifacts: ArtifactsRepository;
  queueDispatch: QueueDispatchRepository;
  quota: QuotaRepository;
  audit: AuditRepository;
  security: SecurityRepository;
  services: ServicesRepository;
  serviceVersions: ServiceVersionsRepository;
}

export type RepositoryMode = 'test-in-memory' | 'test-local-d1' | 'production';

export interface RepositoryFactoryOptions {
  mode: RepositoryMode;
  bindings?: D1Bindings;
  clock?: Clock;
}

export function createRepositories(options: RepositoryFactoryOptions): Repositories {
  const { mode, bindings } = options;

  if (mode === 'test-in-memory') {
    return createInMemoryRepositories();
  }

  if (mode === 'test-local-d1' || mode === 'production') {
    if (!bindings?.DB) {
      if (mode === 'production') {
        throw new Error('Production mode requires D1 database binding');
      }
      // For test-local-d1, fall back to in-memory if no binding
      console.warn('No D1 binding provided for test-local-d1 mode, using in-memory repositories');
      return createInMemoryRepositories();
    }

    const db = bindings.DB;

    return {
      jobs: new (await import('./jobs')).D1JobsRepository(db),
      jobAttempts: new (await import('./jobs')).D1JobAttemptsRepository(db),
      stateEvents: new (await import('./jobs')).D1StateEventsRepository(db),
      idempotency: new (await import('./idempotency')).D1IdempotencyRepository(db),
      artifacts: new (await import('./artifacts')).D1ArtifactsRepository(db),
      queueDispatch: new (await import('./artifacts')).D1QueueDispatchRepository(db),
      quota: new (await import('./quota-audit-security')).D1QuotaRepository(db),
      audit: new (await import('./quota-audit-security')).D1AuditRepository(db),
      security: new (await import('./quota-audit-security')).D1SecurityRepository(db),
      services: new (await import('./services')).D1ServicesRepository(db),
      serviceVersions: new (await import('./services')).D1ServiceVersionsRepository(db),
    };
  }

  throw new Error(`Unknown repository mode: ${mode}`);
}

// Synchronous version for production use
export function createRepositoriesSync(options: RepositoryFactoryOptions): Repositories {
  const { mode, bindings } = options;

  if (mode === 'test-in-memory') {
    return createInMemoryRepositories();
  }

  if (mode === 'test-local-d1' || mode === 'production') {
    if (!bindings?.DB) {
      if (mode === 'production') {
        throw new Error('Production mode requires D1 database binding');
      }
      console.warn('No D1 binding provided for test-local-d1 mode, using in-memory repositories');
      return createInMemoryRepositories();
    }

    const db = bindings.DB;

    // Dynamic imports for D1 repositories
    // These are loaded synchronously since the modules are already imported above
    const jobs = await import('./jobs');
    const idempotency = await import('./idempotency');
    const artifacts = await import('./artifacts');
    const quotaAuditSecurity = await import('./quota-audit-security');
    const services = await import('./services');

    return {
      jobs: new jobs.D1JobsRepository(db),
      jobAttempts: new jobs.D1JobAttemptsRepository(db),
      stateEvents: new jobs.D1StateEventsRepository(db),
      idempotency: new idempotency.D1IdempotencyRepository(db),
      artifacts: new artifacts.D1ArtifactsRepository(db),
      queueDispatch: new artifacts.D1QueueDispatchRepository(db),
      quota: new quotaAuditSecurity.D1QuotaRepository(db),
      audit: new quotaAuditSecurity.D1AuditRepository(db),
      security: new quotaAuditSecurity.D1SecurityRepository(db),
      services: new services.D1ServicesRepository(db),
      serviceVersions: new services.D1ServiceVersionsRepository(db),
    };
  }

  throw new Error(`Unknown repository mode: ${mode}`);
}

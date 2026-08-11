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
} from '../interfaces';
import type { D1Bindings, Clock } from './shared';
import { createInMemoryRepositories } from '../in-memory';
import { D1JobsRepository, D1JobAttemptsRepository, D1StateEventsRepository } from './jobs';
import { D1IdempotencyRepository } from './idempotency';
import { D1ArtifactsRepository, D1QueueDispatchRepository } from './artifacts';
import { D1QuotaRepository, D1AuditRepository, D1SecurityRepository } from './quota-audit-security';
import { D1ServicesRepository, D1ServiceVersionsRepository } from './services';

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
      jobs: new D1JobsRepository(db),
      jobAttempts: new D1JobAttemptsRepository(db),
      stateEvents: new D1StateEventsRepository(db),
      idempotency: new D1IdempotencyRepository(db),
      artifacts: new D1ArtifactsRepository(db),
      queueDispatch: new D1QueueDispatchRepository(db),
      quota: new D1QuotaRepository(db),
      audit: new D1AuditRepository(db),
      security: new D1SecurityRepository(db),
      services: new D1ServicesRepository(db),
      serviceVersions: new D1ServiceVersionsRepository(db),
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

    return {
      jobs: new D1JobsRepository(db),
      jobAttempts: new D1JobAttemptsRepository(db),
      stateEvents: new D1StateEventsRepository(db),
      idempotency: new D1IdempotencyRepository(db),
      artifacts: new D1ArtifactsRepository(db),
      queueDispatch: new D1QueueDispatchRepository(db),
      quota: new D1QuotaRepository(db),
      audit: new D1AuditRepository(db),
      security: new D1SecurityRepository(db),
      services: new D1ServicesRepository(db),
      serviceVersions: new D1ServiceVersionsRepository(db),
    };
  }

  throw new Error(`Unknown repository mode: ${mode}`);
}

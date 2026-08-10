import type { D1Database } from '@cloudflare/workers-types';
import { randomUUID } from 'crypto';

export interface MigrationVerificationResult {
  success: boolean;
  migrationApplied: boolean;
  tablesExist: string[];
  indexesExist: string[];
  foreignKeysActive: boolean;
  constraintsVerified: boolean;
  transactionBehaviorVerified: boolean;
  errors: string[];
  details: string;
}

export async function verifyMigrations(db: D1Database): Promise<MigrationVerificationResult> {
  const errors: string[] = [];
  const tablesExist: string[] = [];
  const indexesExist: string[] = [];

  try {
    // Check applied migrations
    const migrationStmt = db.prepare(`
      SELECT * FROM drizzle_migrations ORDER BY created_at
    `);
    const migrationResult = await migrationStmt.all();

    let migrationApplied = false;
    if (migrationResult.success && migrationResult.results.length > 0) {
      migrationApplied = true;
    }

    // Check all required tables exist
    const requiredTables = [
      'services',
      'service_versions',
      'jobs',
      'job_attempts',
      'job_state_events',
      'idempotency_records',
      'payment_quotes',
      'quota_reservations',
      'job_artifacts',
      'queue_dispatches',
      'audit_events',
      'security_events',
      'payment_attempts',
      'x402_quotes',
      'x402_service_results',
    ];

    for (const table of requiredTables) {
      const stmt = db.prepare(`SELECT 1 FROM ${table} LIMIT 1`);
      const result = await stmt.all();
      if (result.success) {
        tablesExist.push(table);
      } else {
        errors.push(`Table ${table} does not exist or is not accessible`);
      }
    }

    // Check indexes
    const indexStmt = db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
    `);
    const indexResult = await indexStmt.all();
    if (indexResult.success) {
      for (const row of indexResult.results) {
        indexesExist.push((row as Record<string, unknown>).name as string);
      }
    }

    // Check foreign key enforcement
    const fkStmt = db.prepare(`PRAGMA foreign_keys`);
    const fkResult = await fkStmt.all();
    const foreignKeysActive = fkResult.success && fkResult.results[0] === 1;

    // Verify constraints through actual inserts
    const constraintsVerified = await verifyConstraints(db);

    // Verify transaction behavior
    const transactionBehaviorVerified = await verifyTransactionBehavior(db);

    return {
      success: errors.length === 0 && constraintsVerified && transactionBehaviorVerified,
      migrationApplied,
      tablesExist,
      indexesExist,
      foreignKeysActive,
      constraintsVerified,
      transactionBehaviorVerified,
      errors,
      details: errors.length === 0 ? 'All migration verification checks passed' : errors.join('; '),
    };
  } catch (e) {
    return {
      success: false,
      migrationApplied: false,
      tablesExist,
      indexesExist,
      foreignKeysActive: false,
      constraintsVerified: false,
      transactionBehaviorVerified: false,
      errors: [e instanceof Error ? e.message : 'Unknown error'],
      details: 'Migration verification failed with exception',
    };
  }
}

async function verifyConstraints(db: D1Database): Promise<boolean> {
  try {
    // Test duplicate idempotency key constraint
    const stmt1 = db.prepare(`
      INSERT INTO idempotency_records (
        id, idempotency_key, service_id, service_version, input_hash, input_schema_hash,
        created_at, expires_at, original_job_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const id1 = randomUUID();
    const id2 = randomUUID();
    const jobId = randomUUID();
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 3600000).toISOString();

    await stmt1
      .bind(id1, 'test-key', 'svc', '1.0.0', 'hash1', 'schema1', now, expires, jobId)
      .run();
    const result2 = await stmt1
      .bind(id2, 'test-key', 'svc', '1.0.0', 'hash1', 'schema1', now, expires, jobId)
      .run();

    if (result2.success) {
      console.warn('Duplicate idempotency key constraint not enforced');
      return false;
    }

    // Test duplicate (job_id, attempt_number) constraint
    const attemptStmt = db.prepare(`
      INSERT INTO job_attempts (id, job_id, attempt_number, state)
      VALUES (?, ?, ?, ?)
    `);

    await attemptStmt.bind(randomUUID(), jobId, 1, 'RECEIVED').run();
    const attemptResult2 = await attemptStmt.bind(randomUUID(), jobId, 1, 'RECEIVED').run();

    if (attemptResult2.success) {
      console.warn('Duplicate attempt constraint not enforced');
      return false;
    }

    // Test invalid job state constraint
    const jobStmt = db.prepare(`
      INSERT INTO jobs (
        id, request_id, service_id, service_version, input_hash, input_schema_hash,
        output_schema_hash, idempotency_key, contract_release, pcc_dependency,
        current_state, created_at, updated_at, expires_at, attempt_count,
        max_authorized_cost, production_enabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const invalidStateResult = await jobStmt
      .bind(
        randomUUID(),
        randomUUID(),
        'svc',
        '1.0.0',
        'hash1',
        'schema1',
        'outhash1',
        'key-invalid',
        '1.0.0',
        '1.0.1',
        'INVALID_STATE',
        now,
        now,
        expires,
        0,
        null,
        0
      )
      .run();

    if (invalidStateResult.success) {
      console.warn('Invalid job state constraint not enforced');
      return false;
    }

    // Test invalid attempt number constraint
    const invalidAttemptResult = await attemptStmt.bind(randomUUID(), jobId, -1, 'RECEIVED').run();

    if (invalidAttemptResult.success) {
      console.warn('Invalid attempt number constraint not enforced');
      return false;
    }

    // Test foreign key constraint (orphan state event)
    const eventStmt = db.prepare(`
      INSERT INTO job_state_events (id, job_id, attempt_number, from_state, to_state, reason, actor, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const orphanEventResult = await eventStmt
      .bind(
        randomUUID(),
        'non-existent-job',
        1,
        'RECEIVED',
        'RECEIVED',
        'VALIDATION_PASSED',
        'SYSTEM',
        now
      )
      .run();

    if (orphanEventResult.success) {
      console.warn('Foreign key constraint on state events not enforced');
      return false;
    }

    // Test orphan artifact record (job_id FK with SET NULL)
    const artifactStmt = db.prepare(`
      INSERT INTO job_artifacts (id, content_hash, media_type, byte_length, created_at, job_id, artifact_type)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const artifactResult = await artifactStmt
      .bind(randomUUID(), 'hash1', 'text/plain', 100, now, 'non-existent-job', 'input')
      .run();

    if (!artifactResult.success) {
      console.warn('Artifact FK with SET NULL failed unexpectedly');
      return false;
    }

    return true;
  } catch (e) {
    console.error('Constraint verification error:', e);
    return false;
  }
}

async function verifyTransactionBehavior(db: D1Database): Promise<boolean> {
  try {
    // Test multi-row acquisition succeeds atomically
    const statements = [
      db
        .prepare(
          `
        INSERT INTO idempotency_records (
          id, idempotency_key, service_id, service_version, input_hash, input_schema_hash,
          created_at, expires_at, original_job_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
        )
        .bind(
          randomUUID(),
          'txn-test-1',
          'svc',
          '1.0.0',
          'hash1',
          'schema1',
          new Date().toISOString(),
          new Date(Date.now() + 3600000).toISOString(),
          randomUUID()
        ),

      db
        .prepare(
          `
        INSERT INTO jobs (
          id, request_id, service_id, service_version, input_hash, input_schema_hash,
          output_schema_hash, idempotency_key, contract_release, pcc_dependency,
          current_state, created_at, updated_at, expires_at, attempt_count,
          max_authorized_cost, production_enabled
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
        )
        .bind(
          randomUUID(),
          randomUUID(),
          'svc',
          '1.0.0',
          'hash1',
          'schema1',
          'outhash1',
          'txn-test-1',
          '1.0.0',
          '1.0.1',
          'RECEIVED',
          new Date().toISOString(),
          new Date().toISOString(),
          new Date(Date.now() + 3600000).toISOString(),
          0,
          null,
          0
        ),

      db
        .prepare(
          `
        INSERT INTO job_attempts (id, job_id, attempt_number, state)
        VALUES (?, ?, ?, ?)
      `
        )
        .bind(randomUUID(), 'txn-job-1', 1, 'RECEIVED'),
    ];

    const batchResult = await db.batch(statements);
    const allSucceeded = batchResult.every((r) => r.success);

    if (!allSucceeded) {
      console.warn('Multi-row transaction failed unexpectedly');
      return false;
    }

    // Test deliberate failure rolls back entire batch
    const failStatements = [
      db
        .prepare(
          `
        INSERT INTO idempotency_records (
          id, idempotency_key, service_id, service_version, input_hash, input_schema_hash,
          created_at, expires_at, original_job_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
        )
        .bind(
          randomUUID(),
          'txn-test-2',
          'svc',
          '1.0.0',
          'hash1',
          'schema1',
          new Date().toISOString(),
          new Date(Date.now() + 3600000).toISOString(),
          randomUUID()
        ),

      // This will fail - invalid job state
      db
        .prepare(
          `
        INSERT INTO jobs (
          id, request_id, service_id, service_version, input_hash, input_schema_hash,
          output_schema_hash, idempotency_key, contract_release, pcc_dependency,
          current_state, created_at, updated_at, expires_at, attempt_count,
          max_authorized_cost, production_enabled
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
        )
        .bind(
          randomUUID(),
          randomUUID(),
          'svc',
          '1.0.0',
          'hash1',
          'schema1',
          'outhash1',
          'txn-test-2',
          '1.0.0',
          '1.0.1',
          'INVALID_STATE',
          new Date().toISOString(),
          new Date().toISOString(),
          new Date(Date.now() + 3600000).toISOString(),
          0,
          null,
          0
        ),
    ];

    const failResult = await db.batch(failStatements);
    const hasFailure = failResult.some((r) => !r.success);

    if (!hasFailure) {
      console.warn('Expected transaction failure did not occur');
      return false;
    }

    // Verify no partial rows remain (the idempotency record should not exist)
    const checkStmt = db.prepare(`SELECT * FROM idempotency_records WHERE idempotency_key = ?`);
    const checkResult = await checkStmt.bind('txn-test-2').all();

    if (checkResult.success && checkResult.results.length > 0) {
      console.warn('Partial rows remain after failed transaction');
      return false;
    }

    return true;
  } catch (e) {
    console.error('Transaction behavior verification error:', e);
    return false;
  }
}

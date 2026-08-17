/**
 * SUN-1000 checkpoint 1N-A — self-tests for the chaos gate's own
 * evaluation logic (`evaluateChaosReport`). Proves the harness itself
 * fails closed on the failure modes it exists to catch, rather than
 * only exercising the happy path against values it generated itself.
 */
import { describe, expect, it } from 'vitest';
import { evaluateChaosReport, REQUIRED_CHAOS_SCENARIOS, type VitestJsonReport } from './run-chaos';

function reportWith(entries: Array<{ fullName: string; status: string }>): VitestJsonReport {
  return {
    testResults: [{ assertionResults: entries }],
    numTotalTests: entries.length,
    numPassedTests: entries.filter((e) => e.status === 'passed').length,
    numFailedTests: entries.filter((e) => e.status !== 'passed').length,
    success: entries.every((e) => e.status === 'passed'),
  };
}

function allPassing(): Array<{ fullName: string; status: string }> {
  return REQUIRED_CHAOS_SCENARIOS.map((name) => ({
    fullName: `SUN-1000 checkpoint 1N-A — v2 deterministic chaos > ${name}`,
    status: 'passed',
  }));
}

describe('run-chaos evaluateChaosReport', () => {
  it('passes (empty problems) when every required scenario ran and passed', () => {
    const problems = evaluateChaosReport(reportWith(allPassing()), REQUIRED_CHAOS_SCENARIOS);
    expect(problems).toEqual([]);
  });

  it('fails closed when a required scenario is entirely missing from the report', () => {
    const entries = allPassing().filter((e) => !e.fullName.includes('CROSS_MAJOR_COLLISION'));
    const problems = evaluateChaosReport(reportWith(entries), REQUIRED_CHAOS_SCENARIOS);
    expect(problems.some((p) => p.includes('missing required chaos scenario'))).toBe(true);
    expect(problems.some((p) => p.includes('CROSS_MAJOR_COLLISION'))).toBe(true);
  });

  it('fails closed when a required scenario ran but did not pass', () => {
    const entries = allPassing().map((e) =>
      e.fullName.includes('SETTLEMENT_REJECTED') ? { ...e, status: 'failed' } : e
    );
    const problems = evaluateChaosReport(reportWith(entries), REQUIRED_CHAOS_SCENARIOS);
    expect(problems.some((p) => p.includes('did not pass'))).toBe(true);
    expect(problems.some((p) => p.includes('SETTLEMENT_REJECTED'))).toBe(true);
  });

  it('fails closed when a required scenario is only skipped, not passed', () => {
    const entries = allPassing().map((e) =>
      e.fullName.includes('VERIFY_TIMEOUT') ? { ...e, status: 'skipped' } : e
    );
    const problems = evaluateChaosReport(reportWith(entries), REQUIRED_CHAOS_SCENARIOS);
    expect(problems.some((p) => p.includes('status=skipped'))).toBe(true);
  });

  it('an empty report fails closed with one problem per required scenario', () => {
    const problems = evaluateChaosReport(reportWith([]), REQUIRED_CHAOS_SCENARIOS);
    expect(problems).toHaveLength(REQUIRED_CHAOS_SCENARIOS.length);
  });

  it('extra, non-required passing tests in the report do not mask a missing required one', () => {
    const entries = [
      ...allPassing().filter((e) => !e.fullName.includes('NO_SECRET_LEAK')),
      { fullName: 'some unrelated extra test', status: 'passed' },
    ];
    const problems = evaluateChaosReport(reportWith(entries), REQUIRED_CHAOS_SCENARIOS);
    expect(problems.some((p) => p.includes('NO_SECRET_LEAK'))).toBe(true);
  });
});

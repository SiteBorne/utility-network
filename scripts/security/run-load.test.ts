/**
 * SUN-1000 checkpoint 1N-B — self-tests for the load gate's own
 * evaluation logic (`evaluateLoadReport`). Mirrors run-chaos.test.ts's
 * proven pattern exactly: proves the harness itself fails closed on the
 * failure modes it exists to catch, rather than only exercising the
 * happy path against values it generated itself.
 */
import { describe, expect, it } from 'vitest';
import { evaluateLoadReport, REQUIRED_LOAD_SCENARIOS, type VitestJsonReport } from './run-load';

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
  return REQUIRED_LOAD_SCENARIOS.map((name) => ({
    fullName: `SUN-1000 checkpoint 1N-B — v2 load/capacity gate > ${name}`,
    status: 'passed',
  }));
}

describe('run-load evaluateLoadReport', () => {
  it('passes (empty problems) when every required scenario ran and passed', () => {
    const problems = evaluateLoadReport(reportWith(allPassing()), REQUIRED_LOAD_SCENARIOS);
    expect(problems).toEqual([]);
  });

  it('fails closed when a required scenario is entirely missing from the report', () => {
    const entries = allPassing().filter((e) => !e.fullName.includes('BURST'));
    const problems = evaluateLoadReport(reportWith(entries), REQUIRED_LOAD_SCENARIOS);
    expect(problems.some((p) => p.includes('missing required load scenario'))).toBe(true);
    expect(problems.some((p) => p.includes('BURST'))).toBe(true);
  });

  it('fails closed when a required scenario ran but did not pass', () => {
    const entries = allPassing().map((e) =>
      e.fullName.includes('STEADY_CONCURRENCY') ? { ...e, status: 'failed' } : e
    );
    const problems = evaluateLoadReport(reportWith(entries), REQUIRED_LOAD_SCENARIOS);
    expect(problems.some((p) => p.includes('did not pass'))).toBe(true);
    expect(problems.some((p) => p.includes('STEADY_CONCURRENCY'))).toBe(true);
  });

  it('fails closed when a required scenario is only skipped, not passed', () => {
    const entries = allPassing().map((e) =>
      e.fullName.includes('RESOURCE_STABILITY') ? { ...e, status: 'skipped' } : e
    );
    const problems = evaluateLoadReport(reportWith(entries), REQUIRED_LOAD_SCENARIOS);
    expect(problems.some((p) => p.includes('status=skipped'))).toBe(true);
  });

  it('an empty report fails closed with one problem per required scenario', () => {
    const problems = evaluateLoadReport(reportWith([]), REQUIRED_LOAD_SCENARIOS);
    expect(problems).toHaveLength(REQUIRED_LOAD_SCENARIOS.length);
  });

  it('extra, non-required passing tests in the report do not mask a missing required one', () => {
    const entries = [
      ...allPassing().filter((e) => !e.fullName.includes('DUPLICATE_ID_CONTENTION')),
      { fullName: 'some unrelated extra test', status: 'passed' },
    ];
    const problems = evaluateLoadReport(reportWith(entries), REQUIRED_LOAD_SCENARIOS);
    expect(problems.some((p) => p.includes('DUPLICATE_ID_CONTENTION'))).toBe(true);
  });
});

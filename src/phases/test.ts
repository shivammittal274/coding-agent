import { runTests, hasBaselineChecks } from '../utils/test-runner.js';
import type { TestBaseline } from '../utils/test-runner.js';
import { log } from '../utils/logger.js';
import type { ProjectInfo, PhaseResult, TestResult } from '../types.js';

export async function test(
  projectInfo: ProjectInfo,
  worktreePath: string,
  baseline: TestBaseline,
): Promise<{ result: PhaseResult; testResult: TestResult }> {
  const start = Date.now();

  if (!hasBaselineChecks(baseline)) {
    log.phase('test', 'No checks to enforce (all failed on baseline or none defined), skipping');
    const testResult: TestResult = {
      passed: true,
      exitCode: 0,
      output: 'No checks to enforce (all failed on baseline or none defined)',
    };
    return {
      result: {
        phase: 'test',
        success: true,
        costUsd: 0,
        durationMs: Date.now() - start,
      },
      testResult,
    };
  }

  const enforced: string[] = [];
  if (baseline.runLint) enforced.push('lint');
  if (baseline.runTypecheck) enforced.push('typecheck');
  if (baseline.runUnit) enforced.push('unit');
  log.phase('test', `Running enforced checks: ${enforced.join(', ')}`);

  const testResult = await runTests(projectInfo, worktreePath, baseline);

  if (testResult.passed) {
    log.success('All enforced checks passed');
  } else {
    log.warn(`Tests failed (${testResult.failureCategory ?? 'unknown'})`);
  }

  const result: PhaseResult = {
    phase: 'test',
    success: testResult.passed,
    costUsd: 0,
    durationMs: Date.now() - start,
  };

  return { result, testResult };
}

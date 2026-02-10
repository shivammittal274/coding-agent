import { execSync } from 'node:child_process';
import type { ProjectInfo, TestResult } from '../types.js';
import { log } from './logger.js';

/**
 * Truncate output to the last N lines.
 */
function truncateOutput(output: string, maxLines = 200): string {
  const lines = output.split('\n');
  if (lines.length <= maxLines) return output;
  return lines.slice(-maxLines).join('\n');
}

/**
 * Which checks to run — derived from baseline analysis.
 */
export interface TestBaseline {
  runLint: boolean;
  runTypecheck: boolean;
  runUnit: boolean;
}

/**
 * Run a single command and return a TestResult on failure, or null on success.
 */
function runCommand(
  command: string,
  cwd: string,
  failureCategory: TestResult['failureCategory'],
): TestResult | null {
  try {
    execSync(command, { cwd, stdio: 'pipe', timeout: 120_000 });
    return null; // success
  } catch (err: any) {
    const stdout = (err.stdout ?? '').toString();
    const stderr = (err.stderr ?? '').toString();
    const combined = (stdout + '\n' + stderr).trim();
    return {
      passed: false,
      exitCode: typeof err.status === 'number' ? err.status : 1,
      output: truncateOutput(combined),
      failureCategory,
    };
  }
}

/**
 * Run each test command on the clean baseline worktree to discover
 * which checks already pass. Only those will be enforced after the agent works.
 */
export function runBaselineTests(projectInfo: ProjectInfo, cwd: string): TestBaseline {
  const baseline: TestBaseline = {
    runLint: false,
    runTypecheck: false,
    runUnit: false,
  };

  if (projectInfo.lintCommand) {
    const result = runCommand(projectInfo.lintCommand, cwd, 'lint');
    baseline.runLint = result === null;
    log.phase('baseline', `Lint: ${baseline.runLint ? 'PASS — will enforce' : 'FAIL — will skip'}`);
  }

  if (projectInfo.typecheckCommand) {
    const result = runCommand(projectInfo.typecheckCommand, cwd, 'typecheck');
    baseline.runTypecheck = result === null;
    log.phase('baseline', `Typecheck: ${baseline.runTypecheck ? 'PASS — will enforce' : 'FAIL — will skip'}`);
  }

  if (projectInfo.testCommand) {
    const result = runCommand(projectInfo.testCommand, cwd, 'unit');
    baseline.runUnit = result === null;
    log.phase('baseline', `Unit tests: ${baseline.runUnit ? 'PASS — will enforce' : 'FAIL — will skip'}`);
  }

  return baseline;
}

/**
 * Run only the checks that passed on baseline, in order (lint → typecheck → unit).
 * Stops at the first failure.
 */
export function runTests(
  projectInfo: ProjectInfo,
  cwd: string,
  baseline: TestBaseline,
): Promise<TestResult> {
  return new Promise((resolve) => {
    // Lint
    if (baseline.runLint && projectInfo.lintCommand) {
      const result = runCommand(projectInfo.lintCommand, cwd, 'lint');
      if (result) {
        resolve(result);
        return;
      }
    }

    // Typecheck
    if (baseline.runTypecheck && projectInfo.typecheckCommand) {
      const result = runCommand(projectInfo.typecheckCommand, cwd, 'typecheck');
      if (result) {
        resolve(result);
        return;
      }
    }

    // Unit tests
    if (baseline.runUnit && projectInfo.testCommand) {
      const result = runCommand(projectInfo.testCommand, cwd, 'unit');
      if (result) {
        resolve(result);
        return;
      }
    }

    // All enforced checks passed (or none to run)
    resolve({ passed: true, exitCode: 0, output: 'All enforced checks passed' });
  });
}

/**
 * Returns true if any test/lint/typecheck command is defined.
 */
export function hasTests(projectInfo: ProjectInfo): boolean {
  return !!(projectInfo.testCommand || projectInfo.lintCommand || projectInfo.typecheckCommand);
}

/**
 * Returns true if baseline has at least one check to run.
 */
export function hasBaselineChecks(baseline: TestBaseline): boolean {
  return baseline.runLint || baseline.runTypecheck || baseline.runUnit;
}

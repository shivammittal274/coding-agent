import type {
  TaskInput,
  ProjectInfo,
  AgentConfig,
  PhaseResult,
  OrchestratorState,
  OrchestratorContext,
  ControllerResult,
  PlanReviewVerdict,
  CodeReviewVerdict,
  TestResult,
} from './types.js';
import { log } from './utils/logger.js';
import { getAccumulatedCost } from './utils/sdk.js';
import { removeWorktree } from './utils/git.js';
import { runBaselineTests, hasTests } from './utils/test-runner.js';
import type { TestBaseline } from './utils/test-runner.js';

// Phase imports
import { intake } from './phases/intake.js';
import { setup } from './phases/setup.js';
import { plan } from './phases/plan.js';
import { planReview } from './phases/plan-review.js';
import { execute, executeFixFromReview } from './phases/execute.js';
import { codeReview } from './phases/code-review.js';
import { test } from './phases/test.js';
import { testFix } from './phases/test-fix.js';
import { commitPhase } from './phases/commit.js';

export async function orchestrate(
  taskInput: TaskInput,
  config: AgentConfig,
): Promise<ControllerResult> {
  const startTime = Date.now();
  const phases: PhaseResult[] = [];

  let state: OrchestratorState = 'intake';
  let projectInfo!: ProjectInfo;
  let worktreePath = '';
  let branchName = '';
  let planSessionId = '';
  let planContent = '';
  let diff = '';
  let lastTestResult: TestResult | undefined;
  let codeReviewSummary: string | undefined;
  let prUrl: string | undefined;
  let baseline: TestBaseline = { runLint: false, runTypecheck: false, runUnit: false };

  // Cycle counters
  let planReviewCycle = 0;
  let codeReviewCycle = 0;
  let testFixCycle = 0;

  function totalCost(): number {
    return phases.reduce((sum, p) => sum + p.costUsd, 0);
  }

  function budgetExceeded(): boolean {
    return totalCost() >= config.maxTotalBudgetUsd;
  }

  async function failWithCleanup(summary: string, isDraft: boolean): Promise<ControllerResult> {
    // If we have a worktree with changes, try to salvage as draft PR
    if (worktreePath && isDraft && config.draftPrOnFailure && diff) {
      try {
        log.phase('commit', 'Salvaging partial work as draft PR');
        const commitResult = await commitPhase(
          taskInput, projectInfo, config, worktreePath, branchName,
          phases, totalCost(), lastTestResult, codeReviewSummary, true,
        );
        phases.push(commitResult.result);
        prUrl = commitResult.prUrl;
      } catch (err) {
        log.warn(`Failed to salvage: ${err instanceof Error ? err.message : String(err)}`);
        // Still clean up
        try { removeWorktree(taskInput.repoPath, worktreePath); } catch {}
      }
    } else if (worktreePath) {
      try { removeWorktree(taskInput.repoPath, worktreePath); } catch {}
    }

    return {
      status: prUrl ? 'partial' : 'failed',
      prUrl,
      branchName,
      phases,
      totalCostUsd: totalCost(),
      totalDurationMs: Date.now() - startTime,
      summary,
    };
  }

  try {
    // ─── INTAKE ───
    log.divider();
    log.phase('intake', `Processing task: ${taskInput.title}`);
    const intakeResult = await intake(taskInput.repoPath);
    phases.push(intakeResult.result);
    projectInfo = intakeResult.projectInfo;
    log.phase('intake', `Project: ${projectInfo.type}, PM: ${projectInfo.packageManager ?? 'none'}, Remote: ${projectInfo.hasGitRemote}`);
    state = 'setup';

    // ─── SETUP ───
    log.divider();
    log.phase('setup', 'Creating worktree and installing dependencies');
    const setupResult = await setup(taskInput, projectInfo, config);
    phases.push(setupResult.result);
    worktreePath = setupResult.worktreePath;
    branchName = setupResult.branchName;
    log.phase('setup', `Worktree: ${worktreePath}, Branch: ${branchName}`);

    // ─── BASELINE TESTS ───
    if (!config.skipTests && hasTests(projectInfo)) {
      log.divider();
      log.phase('baseline', 'Running baseline tests on clean worktree to detect pre-existing failures');
      baseline = runBaselineTests(projectInfo, worktreePath);
    }

    state = 'plan';

    // ─── PLAN ───
    log.divider();
    log.phase('plan', 'Starting planning phase');
    let planResult;
    try {
      planResult = await plan(taskInput, projectInfo, config, worktreePath);
    } catch (err) {
      // Retry once
      log.warn(`Plan failed: ${err instanceof Error ? err.message : String(err)}, retrying...`);
      planResult = await plan(taskInput, projectInfo, config, worktreePath);
    }
    phases.push(planResult.result);
    planContent = planResult.planContent;
    planSessionId = planResult.sessionId;
    state = 'plan-review';

    // ─── PLAN REVIEW ───
    if (!config.skipPlanReview) {
      log.divider();
      let reviewVerdict: PlanReviewVerdict | undefined;

      while (planReviewCycle < config.maxPlanReviewCycles) {
        planReviewCycle++;
        log.phase('plan-review', `Review cycle ${planReviewCycle}/${config.maxPlanReviewCycles}`);

        try {
          const prResult = await planReview(taskInput, planContent, config, worktreePath);
          phases.push(prResult.result);
          reviewVerdict = prResult.verdict;

          if (budgetExceeded()) {
            return failWithCleanup('Budget exceeded during plan review', false);
          }

          if (reviewVerdict.verdict === 'approve') {
            log.success('Plan approved');
            break;
          }

          if (reviewVerdict.verdict === 'reject') {
            return failWithCleanup(`Plan rejected: ${reviewVerdict.summary}`, false);
          }

          // verdict === 'revise'
          if (planReviewCycle < config.maxPlanReviewCycles) {
            log.phase('plan', 'Revising plan based on review feedback');
            const feedback = reviewVerdict.feedback
              .map(f => `- [${f.severity}] ${f.category}: ${f.description} → ${f.recommendation}`)
              .join('\n');

            const revisedPlan = await plan(
              taskInput, projectInfo, config, worktreePath, planSessionId, feedback,
            );
            phases.push(revisedPlan.result);
            planContent = revisedPlan.planContent;
            planSessionId = revisedPlan.sessionId;
          } else {
            log.warn('Max plan review cycles reached, proceeding with current plan');
          }
        } catch (err) {
          log.warn(`Plan review error: ${err instanceof Error ? err.message : String(err)}, skipping review`);
          break;
        }
      }
    } else {
      log.phase('plan-review', 'Skipped (--skip-plan-review)');
    }

    state = 'execute';
    if (budgetExceeded()) {
      return failWithCleanup('Budget exceeded before execution', false);
    }

    // ─── EXECUTE ───
    log.divider();
    log.phase('execute', 'Starting execution phase');
    const execResult = await execute(taskInput, config, worktreePath, planSessionId);
    phases.push(execResult.result);
    diff = execResult.diff;
    // Update planSessionId in case it changed (resumed session)
    if (execResult.result.sessionId) {
      planSessionId = execResult.result.sessionId;
    }
    state = 'code-review';

    // ─── CODE REVIEW ───
    if (!config.skipCodeReview) {
      log.divider();
      let crVerdict: CodeReviewVerdict | undefined;

      while (codeReviewCycle < config.maxCodeReviewCycles) {
        codeReviewCycle++;
        log.phase('code-review', `Review cycle ${codeReviewCycle}/${config.maxCodeReviewCycles}`);

        if (budgetExceeded()) {
          log.warn('Budget exceeded, skipping code review');
          break;
        }

        try {
          const crResult = await codeReview(taskInput, planContent, diff, config, worktreePath);
          phases.push(crResult.result);
          crVerdict = crResult.verdict;
          codeReviewSummary = crVerdict.summary;

          if (crVerdict.verdict === 'pass') {
            log.success('Code review passed');
            break;
          }

          // verdict === 'fail'
          if (codeReviewCycle < config.maxCodeReviewCycles) {
            const issuesStr = crVerdict.issues
              .map(i => `- [${i.severity}] ${i.file}: ${i.description} → ${i.suggestion}`)
              .join('\n');

            const fixResult = await executeFixFromReview(
              config, worktreePath, planSessionId, issuesStr, diff,
            );
            phases.push(fixResult.result);
            diff = fixResult.diff;
            if (fixResult.result.sessionId) {
              planSessionId = fixResult.result.sessionId;
            }
          } else {
            log.warn('Max code review cycles reached, proceeding with known issues');
          }
        } catch (err) {
          log.warn(`Code review error: ${err instanceof Error ? err.message : String(err)}, skipping`);
          break;
        }
      }
    } else {
      log.phase('code-review', 'Skipped (--skip-code-review)');
    }

    state = 'test';

    // ─── TEST + TEST-FIX LOOP ───
    if (!config.skipTests) {
      log.divider();
      log.phase('test', 'Running tests');
      const testResult = await test(projectInfo, worktreePath, baseline);
      phases.push(testResult.result);
      lastTestResult = testResult.testResult;

      while (!lastTestResult.passed && testFixCycle < config.maxTestFixCycles) {
        testFixCycle++;

        if (budgetExceeded()) {
          log.warn('Budget exceeded, stopping test-fix cycles');
          break;
        }

        log.phase('test-fix', `Fix cycle ${testFixCycle}/${config.maxTestFixCycles}`);

        try {
          const fixResult = await testFix(lastTestResult, config, worktreePath, planSessionId, baseline);
          phases.push(fixResult.result);

          // Re-run tests
          const retestResult = await test(projectInfo, worktreePath, baseline);
          phases.push(retestResult.result);
          lastTestResult = retestResult.testResult;
        } catch (err) {
          log.warn(`Test-fix error: ${err instanceof Error ? err.message : String(err)}`);
          break;
        }
      }

      if (!lastTestResult.passed) {
        log.warn('Tests still failing after all fix cycles');
      }
    } else {
      log.phase('test', 'Skipped (--skip-tests)');
    }

    state = 'commit';

    // ─── COMMIT ───
    log.divider();
    const isDraft = lastTestResult ? !lastTestResult.passed : false;
    const commitResult = await commitPhase(
      taskInput, projectInfo, config, worktreePath, branchName,
      phases, totalCost(), lastTestResult, codeReviewSummary, isDraft,
    );
    phases.push(commitResult.result);
    prUrl = commitResult.prUrl;

    state = 'done';

    // ─── DONE ───
    log.divider();
    const status = (lastTestResult && !lastTestResult.passed) ? 'partial' : 'success';
    const summary = status === 'success'
      ? `Task completed successfully. ${prUrl ? `PR: ${prUrl}` : `Branch: ${branchName}`}`
      : `Task completed with issues. ${prUrl ? `Draft PR: ${prUrl}` : `Branch: ${branchName}`}`;

    log.success(summary);
    log.cost('Total', totalCost());

    return {
      status,
      prUrl,
      branchName,
      phases,
      totalCostUsd: totalCost(),
      totalDurationMs: Date.now() - startTime,
      summary,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Fatal error in ${state}: ${message}`);
    return failWithCleanup(`Failed in ${state}: ${message}`, !!diff);
  }
}

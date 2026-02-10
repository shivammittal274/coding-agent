import { resolve } from 'node:path';
import { nanoid } from 'nanoid';
import type { TaskInput, AgentConfig, ControllerResult, StageResult } from './types.js';
import { mergeConfig } from './config.js';
import { log } from './utils/logger.js';
import { resetAccumulatedCost, getAccumulatedCost } from './utils/sdk.js';
import { getDiffFromBaseline, stageAll, commit, removeWorktree } from './utils/git.js';
import { runSetup } from './stages/setup.js';
import { runPlan } from './stages/plan.js';
import { runImplement } from './stages/implement.js';
import { runCommit } from './stages/commit.js';
import { generatePrBody, createPr } from './utils/pr.js';
import { push, getDiffStatFromBaseline } from './utils/git.js';

export interface ControllerInput {
  repoPath: string;
  task: string;
  title?: string;
  configOverrides?: Partial<AgentConfig>;
}

export async function runController(input: ControllerInput): Promise<ControllerResult> {
  const startTime = Date.now();
  resetAccumulatedCost();

  const config = mergeConfig(input.configOverrides ?? {});
  const id = nanoid(8);
  const title = input.title || input.task.slice(0, 80);
  const repoPath = resolve(input.repoPath);

  const taskInput: TaskInput = { id, title, description: input.task, repoPath };

  log.divider();
  log.info(`Coding Agent v2 — Task ${id}`);
  log.info(`Repo: ${repoPath}`);
  log.info(`Task: ${title}`);
  log.info(`Budget: $${config.maxTotalBudgetUsd.toFixed(2)}`);
  log.divider();

  const stages: StageResult[] = [];
  let worktreePath = '';
  let branchName = '';

  try {
    // ─── SETUP ───────────────────────────────────────────────────
    const setup = await runSetup(taskInput, config);
    stages.push(setup.stageResult);
    worktreePath = setup.worktreePath;
    branchName = setup.branchName;

    log.cost('Setup', setup.stageResult.costUsd);
    checkBudget(config);

    // ─── PLAN ────────────────────────────────────────────────────
    const plan = await runPlan(taskInput, config, worktreePath);
    stages.push(plan.stageResult);

    log.cost('Plan', plan.stageResult.costUsd);
    checkBudget(config);

    // ─── IMPLEMENT ───────────────────────────────────────────────
    const impl = await runImplement(taskInput, config, worktreePath);
    stages.push(impl.stageResult);

    log.cost('Implement', impl.stageResult.costUsd);
    checkBudget(config);

    // ─── COMMIT ──────────────────────────────────────────────────
    const commitResult = await runCommit(
      taskInput,
      setup.projectInfo,
      config,
      worktreePath,
      branchName,
      stages,
      getAccumulatedCost(),
    );
    stages.push(commitResult.stageResult);

    return {
      status: 'success',
      prUrl: commitResult.prUrl,
      branchName,
      stages,
      totalCostUsd: getAccumulatedCost(),
      totalDurationMs: Date.now() - startTime,
      summary: `Task completed successfully${commitResult.prUrl ? `. PR: ${commitResult.prUrl}` : ''}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Pipeline failed: ${message}`);

    // --- Salvage as draft PR if we have a diff ---
    if (config.draftPrOnFailure && worktreePath && branchName) {
      try {
        const diff = getDiffFromBaseline(worktreePath);
        if (diff && diff.trim().length > 0) {
          log.warn('Salvaging partial work as draft PR...');

          stageAll(worktreePath);
          try {
            commit(worktreePath, `draft(agent): ${taskInput.title} [partial]\n\nTask ID: ${taskInput.id}\nFailed: ${message}`);
          } catch {
            // may already be committed
          }

          const setup = stages.find(s => s.stage === 'setup');
          const projectInfo = setup ? { hasRemote: true, canPush: true, defaultBranch: 'main' } : undefined;

          if (projectInfo && !config.noPush) {
            try {
              push(taskInput.repoPath, branchName);
              const diffStat = getDiffStatFromBaseline(worktreePath);
              const body = generatePrBody({
                title: `[DRAFT] ${taskInput.title}`,
                description: `${taskInput.description}\n\n**Note**: This is a partial implementation. The pipeline failed with: ${message}`,
                diffStat,
                stages,
                totalCost: getAccumulatedCost(),
              });
              await createPr(taskInput.repoPath, branchName, `[DRAFT] ${taskInput.title}`, body, true);
            } catch {
              // Best effort
            }
          }

          removeWorktree(taskInput.repoPath, worktreePath);

          return {
            status: 'partial',
            branchName,
            stages,
            totalCostUsd: getAccumulatedCost(),
            totalDurationMs: Date.now() - startTime,
            summary: `Partial implementation saved as draft. Failed: ${message}`,
          };
        }
      } catch {
        // Salvage failed, continue to full failure
      }
    }

    // --- Cleanup worktree on failure ---
    if (worktreePath) {
      try {
        removeWorktree(taskInput.repoPath, worktreePath);
      } catch {
        // Best effort cleanup
      }
    }

    return {
      status: 'failed',
      branchName: branchName || undefined,
      stages,
      totalCostUsd: getAccumulatedCost(),
      totalDurationMs: Date.now() - startTime,
      summary: `Failed: ${message}`,
    };
  }
}

function checkBudget(config: AgentConfig): void {
  const cost = getAccumulatedCost();
  if (cost > config.maxTotalBudgetUsd) {
    throw new Error(`Budget exceeded: $${cost.toFixed(2)} > $${config.maxTotalBudgetUsd.toFixed(2)}`);
  }
}

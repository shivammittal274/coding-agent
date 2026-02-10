#!/usr/bin/env node

import { Command } from 'commander';
import { runController } from './controller.js';
import type { AgentConfig } from './types.js';
import { log } from './utils/logger.js';

const program = new Command();

program
  .name('coding-agent')
  .description('Autonomous coding agent: takes a repo + task, implements it in an isolated worktree, produces a PR')
  .version('0.1.0')
  .requiredOption('--repo <path>', 'Path to the git repository')
  .requiredOption('--task <description>', 'Task description')
  .option('--title <title>', 'Short title for the task (defaults to first 80 chars of task)')
  .option('--skip-plan-review', 'Skip the plan review phase')
  .option('--skip-code-review', 'Skip the code review phase')
  .option('--skip-tests', 'Skip the test phase')
  .option('--skip-push', 'Skip pushing to remote and PR creation')
  .option('--max-budget <dollars>', 'Maximum total budget in USD', parseFloat)
  .option('--model <model>', 'Model to use for all phases')
  .action(async (opts) => {
    const configOverrides: Partial<AgentConfig> = {};

    if (opts.skipPlanReview) configOverrides.skipPlanReview = true;
    if (opts.skipCodeReview) configOverrides.skipCodeReview = true;
    if (opts.skipTests) configOverrides.skipTests = true;
    if (opts.skipPush) configOverrides.noPush = true;
    if (opts.maxBudget) configOverrides.maxTotalBudgetUsd = opts.maxBudget;

    if (opts.model) {
      configOverrides.planModel = opts.model;
      configOverrides.executeModel = opts.model;
      configOverrides.reviewModel = opts.model;
      configOverrides.testFixModel = opts.model;
    }

    const result = await runController({
      repoPath: opts.repo,
      task: opts.task,
      title: opts.title,
      configOverrides,
    });

    // Final summary output
    log.divider();
    log.info(`Status: ${result.status}`);
    log.info(`Duration: ${(result.totalDurationMs / 1000).toFixed(1)}s`);
    log.cost('Total', result.totalCostUsd);
    if (result.prUrl) log.info(`PR: ${result.prUrl}`);
    if (result.branchName) log.info(`Branch: ${result.branchName}`);
    log.divider();

    // Exit with appropriate code
    process.exit(result.status === 'failed' ? 1 : 0);
  });

program.parse();

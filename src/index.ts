#!/usr/bin/env node

import { Command } from 'commander';
import { runController } from './controller.js';
import type { AgentConfig } from './types.js';
import { log } from './utils/logger.js';

const program = new Command();

program
  .name('coding-agent')
  .description('Autonomous coding agent v2: takes a repo + task, plans, implements, and creates a PR')
  .version('2.0.0')
  .requiredOption('--repo <path>', 'Path to the git repository')
  .requiredOption('--task <description>', 'Task description')
  .option('--title <title>', 'Short title for the task (defaults to first 80 chars of task)')
  .option('--skip-review', 'Skip Human Simulator review loops')
  .option('--skip-push', 'Skip pushing to remote and PR creation')
  .option('--max-budget <dollars>', 'Maximum total budget in USD', parseFloat)
  .option('--model <model>', 'Model to use for all agents')
  .action(async (opts) => {
    const configOverrides: Partial<AgentConfig> = {};

    if (opts.skipReview) configOverrides.skipReview = true;
    if (opts.skipPush) configOverrides.noPush = true;
    if (opts.maxBudget) configOverrides.maxTotalBudgetUsd = opts.maxBudget;
    if (opts.model) configOverrides.model = opts.model;

    const result = await runController({
      repoPath: opts.repo,
      task: opts.task,
      title: opts.title,
      configOverrides,
    });

    log.divider();
    log.info(`Status: ${result.status}`);
    log.info(`Duration: ${(result.totalDurationMs / 1000).toFixed(1)}s`);
    log.cost('Total', result.totalCostUsd);
    if (result.prUrl) log.info(`PR: ${result.prUrl}`);
    if (result.branchName) log.info(`Branch: ${result.branchName}`);
    log.divider();

    process.exit(result.status === 'failed' ? 1 : 0);
  });

program.parse();

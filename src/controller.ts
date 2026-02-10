import { resolve } from 'node:path';
import { nanoid } from 'nanoid';
import type { TaskInput, AgentConfig, ControllerResult } from './types.js';
import { mergeConfig } from './config.js';
import { orchestrate } from './orchestrator.js';
import { log } from './utils/logger.js';
import { resetAccumulatedCost } from './utils/sdk.js';

export interface ControllerInput {
  repoPath: string;
  task: string;
  title?: string;
  configOverrides?: Partial<AgentConfig>;
}

export async function runController(input: ControllerInput): Promise<ControllerResult> {
  const startTime = Date.now();

  // Reset cost tracking
  resetAccumulatedCost();

  // Merge config
  const config = mergeConfig(input.configOverrides ?? {});

  // Build task input
  const id = nanoid(8);
  const title = input.title || input.task.slice(0, 80);
  const repoPath = resolve(input.repoPath);

  const taskInput: TaskInput = {
    id,
    title,
    description: input.task,
    repoPath,
  };

  log.divider();
  log.info(`Coding Agent — Task ${id}`);
  log.info(`Repo: ${repoPath}`);
  log.info(`Task: ${title}`);
  log.info(`Budget: $${config.maxTotalBudgetUsd.toFixed(2)}`);
  log.divider();

  try {
    const result = await orchestrate(taskInput, config);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Controller error: ${message}`);

    return {
      status: 'failed',
      phases: [],
      totalCostUsd: 0,
      totalDurationMs: Date.now() - startTime,
      summary: `Fatal error: ${message}`,
    };
  }
}

import type { AgentConfig } from './types.js';

export const DEFAULT_CONFIG: AgentConfig = {
  model: 'claude-opus-4-6',

  maxPlannerTurns: 50,
  maxCoderTurns: 200,
  maxSimulatorTurns: 10,

  maxPlanReviewCycles: 2,
  maxCodeReviewCycles: 2,

  maxTotalBudgetUsd: 20.0,

  worktreeBase: '.worktrees',
  branchPrefix: 'feat',

  noPush: false,
  skipReview: false,
  draftPrOnFailure: true,
};

export function mergeConfig(overrides: Partial<AgentConfig>): AgentConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

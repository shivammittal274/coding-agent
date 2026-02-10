import type { AgentConfig } from './types.js';

export const DEFAULT_CONFIG: AgentConfig = {
  planModel: 'claude-opus-4-6',
  executeModel: 'claude-opus-4-6',
  reviewModel: 'claude-opus-4-6',
  testFixModel: 'claude-opus-4-6',

  maxPlanTurns: 50,
  maxPlanReviewTurns: 20,
  maxExecuteTurns: 100,
  maxCodeReviewTurns: 30,
  maxTestFixTurns: 50,

  maxPlanReviewCycles: 2,
  maxCodeReviewCycles: 2,
  maxTestFixCycles: 3,

  maxBudgetPerPhaseUsd: 5.0,
  maxTotalBudgetUsd: 20.0,

  worktreeBase: '.worktrees',
  branchPrefix: 'feat',

  skipPlanReview: false,
  skipCodeReview: false,
  skipTests: false,
  noPush: false,
  draftPrOnFailure: true,
};

export function mergeConfig(overrides: Partial<AgentConfig>): AgentConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

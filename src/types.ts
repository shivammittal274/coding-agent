// --- Input ---
export interface TaskInput {
  id: string;
  title: string;
  description: string;
  repoPath: string;
}

export interface ProjectInfo {
  packageManager?: 'npm' | 'yarn' | 'pnpm' | 'bun';
  defaultBranch: string;
  hasRemote: boolean;
  canPush: boolean;
}

// --- Stage results ---
export type StageName = 'setup' | 'plan' | 'implement' | 'commit';

export interface StageResult {
  stage: StageName;
  success: boolean;
  sessionId?: string;
  costUsd: number;
  durationMs: number;
  error?: string;
}

// --- Human Simulator ---
export interface SimulatorVerdict {
  verdict: 'approve' | 'revise';
  feedback: string;
  issues: string[];
  costUsd: number;
}

// --- SDK ---
export interface AgentResult {
  sessionId: string;
  costUsd: number;
  result: string;
  durationMs: number;
}

// --- Config ---
export interface AgentConfig {
  model: string;

  maxPlannerTurns: number;
  maxCoderTurns: number;
  maxSimulatorTurns: number;

  maxPlanReviewCycles: number;
  maxCodeReviewCycles: number;

  maxTotalBudgetUsd: number;

  worktreeBase: string;
  branchPrefix: string;

  noPush: boolean;
  skipReview: boolean;
  draftPrOnFailure: boolean;
}

// --- Final ---
export interface ControllerResult {
  status: 'success' | 'partial' | 'failed';
  prUrl?: string;
  branchName?: string;
  stages: StageResult[];
  totalCostUsd: number;
  totalDurationMs: number;
  summary: string;
}

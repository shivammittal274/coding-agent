// --- Input ---
export interface TaskInput {
  id: string;               // nanoid(8)
  title: string;
  description: string;
  repoPath: string;         // Absolute path to repo
}

export interface ProjectInfo {
  type: 'node' | 'python' | 'go' | 'rust' | 'unknown';
  packageManager?: 'npm' | 'yarn' | 'pnpm' | 'bun';
  testCommand?: string;
  lintCommand?: string;
  typecheckCommand?: string;
  buildCommand?: string;
  hasGitRemote: boolean;
  canPush: boolean;
  defaultBranch: string;
}

// --- Phase results ---
export type PhaseName =
  | 'intake'
  | 'setup'
  | 'plan'
  | 'plan-review'
  | 'execute'
  | 'code-review'
  | 'test'
  | 'test-fix'
  | 'commit';

export interface PhaseResult {
  phase: PhaseName;
  success: boolean;
  sessionId?: string;
  costUsd: number;
  durationMs: number;
  error?: string;
}

// --- Review types ---
export interface PlanReviewFeedback {
  category: 'feasibility' | 'completeness' | 'design' | 'scope' | 'risk';
  severity: 'critical' | 'suggestion';
  description: string;
  recommendation: string;
}

export interface PlanReviewVerdict {
  verdict: 'approve' | 'revise' | 'reject';
  feedback: PlanReviewFeedback[];
  summary: string;
}

export interface CodeReviewIssue {
  severity: 'critical' | 'major' | 'minor';
  category: 'correctness' | 'security' | 'completeness' | 'style';
  file: string;
  description: string;
  suggestion: string;
}

export interface CodeReviewVerdict {
  verdict: 'pass' | 'fail';
  issues: CodeReviewIssue[];
  summary: string;
}

// --- Test ---
export interface TestResult {
  passed: boolean;
  exitCode: number;
  output: string;
  failureCategory?: 'lint' | 'typecheck' | 'unit' | 'build';
}

// --- SDK ---
export interface AgentResult {
  sessionId: string;
  costUsd: number;
  result: string;
  durationMs: number;
}

// --- Final ---
export interface ControllerResult {
  status: 'success' | 'partial' | 'failed';
  prUrl?: string;
  branchName?: string;
  phases: PhaseResult[];
  totalCostUsd: number;
  totalDurationMs: number;
  summary: string;
}

// --- Config ---
export interface AgentConfig {
  planModel: string;
  executeModel: string;
  reviewModel: string;
  testFixModel: string;

  maxPlanTurns: number;
  maxPlanReviewTurns: number;
  maxExecuteTurns: number;
  maxCodeReviewTurns: number;
  maxTestFixTurns: number;

  maxPlanReviewCycles: number;
  maxCodeReviewCycles: number;
  maxTestFixCycles: number;

  maxBudgetPerPhaseUsd: number;
  maxTotalBudgetUsd: number;

  worktreeBase: string;
  branchPrefix: string;

  skipPlanReview: boolean;
  skipCodeReview: boolean;
  skipTests: boolean;
  noPush: boolean;
  draftPrOnFailure: boolean;
}

// --- Orchestrator State ---
export type OrchestratorState =
  | 'intake'
  | 'setup'
  | 'plan'
  | 'plan-review'
  | 'execute'
  | 'code-review'
  | 'test'
  | 'test-fix'
  | 'commit'
  | 'done'
  | 'failed';

export interface OrchestratorContext {
  taskInput: TaskInput;
  projectInfo: ProjectInfo;
  config: AgentConfig;
  worktreePath: string;
  branchName: string;

  // Session tracking
  planSessionId?: string;

  // Cycle counters
  planReviewCycle: number;
  codeReviewCycle: number;
  testFixCycle: number;

  // Accumulated results
  phases: PhaseResult[];
  totalCostUsd: number;

  // Intermediate data
  planContent?: string;
  planReview?: PlanReviewVerdict;
  codeReview?: CodeReviewVerdict;
  testResult?: TestResult;
  diff?: string;

  // Final
  prUrl?: string;
}

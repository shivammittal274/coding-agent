import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TaskInput, AgentConfig, StageResult } from '../types.js';
import { runAgent } from '../utils/sdk.js';
import { runSimulator } from '../human-simulator.js';
import { log } from '../utils/logger.js';

// ─── Planner Prompt ──────────────────────────────────────────────────

const PLANNER_PROMPT = (task: TaskInput) => `You are a senior software engineer tasked with planning the implementation of a feature.
You are an expert at understanding codebases deeply before making any changes.

TASK:
Title: ${task.title}
Description: ${task.description}

YOUR PROCESS — follow these phases IN ORDER:

═══ PHASE 1: EXPLORE ═══
Thoroughly explore the codebase to understand:
- Project structure: entry points, key directories, architectural patterns
- How the codebase handles SIMILAR features (find precedents)
- Conventions: naming, testing patterns, error handling style, import patterns
- Dependencies and frameworks in use

Use Glob to map the structure, Read to understand key files, Grep to find patterns.
Be thorough — bad research leads to thousands of bad lines of code.

═══ PHASE 2: LOCALIZE ═══
Pinpoint EXACTLY what needs to change. For each change:
- File path (exact)
- Function/class name (exact)
- Approximate line numbers
- WHY it needs to change

Also identify:
- Files to CREATE (and which existing file to use as a pattern/template)
- Files that provide CONTEXT (interfaces, types, configs the new code must conform to)

═══ PHASE 3: PLAN ═══
Write your plan to .agent/plan.md in this EXACT format:

## Feasibility Assessment
- **Confidence**: HIGH | MEDIUM | LOW
- **Reasoning**: [why this confidence level — be honest]
- **Blockers**: [anything that could prevent completion, or "none"]
- **Ambiguities**: [unclear requirements and the assumptions you're making]

## Localization Map

### Files to Modify
- \`path/to/file.ts:lineStart-lineEnd\` — \`functionName()\` — what needs to change and why

### Files to Create
- \`path/to/new/file.ts\` — purpose — pattern to follow: \`path/to/similar/file.ts\`

### Context Files (read-only reference)
- \`path/to/types.ts\` — interfaces/types the new code must use
- \`path/to/config.ts\` — configuration patterns to follow

## High-Level Plan
1. [Strategic step — what and why]
2. [Strategic step — what and why]
...

## Detailed Plan
### Step 1: [title]
- **File**: \`path\` (MODIFY | CREATE)
- **What**: Specific description of the change
- **Pattern**: Follow pattern from \`path/to/similar/code\`
- **Verify**: How to verify this step works (e.g., "npx tsc --noEmit" or "run test X")

### Step 2: [title]
...

## Test Strategy
- **Existing tests to run**: [commands]
- **New tests to write**: [what each test covers]
- **How to verify end-to-end**: [the command or check that proves the feature works]

## Risks & Assumptions
- [risk]: [mitigation]
- [assumption]: [what you're assuming and why]

CRITICAL RULES:
- DO NOT make any code changes. Only explore and plan.
- Every file path, function name, and line number must be REAL — verified by you reading the file.
- If you find the task is impossible or ambiguous, say so clearly in the Feasibility Assessment.
- Be specific enough that a junior engineer could follow your plan without asking questions.`;

const PLANNER_REVISION_PROMPT = (feedback: string) => `The plan reviewer found issues with your plan. Here is their feedback:

${feedback}

Please revise .agent/plan.md to address these issues.
Keep the same format. Update the Localization Map if files/locations changed.
Re-verify any file references that were questioned.`;

// ─── Stage ───────────────────────────────────────────────────────────

export interface PlanResult {
  stageResult: StageResult;
  planSessionId: string;
}

export async function runPlan(
  taskInput: TaskInput,
  config: AgentConfig,
  worktreePath: string,
): Promise<PlanResult> {
  const startTime = Date.now();
  let totalCost = 0;

  log.stage('plan', 'Starting planner agent...');

  // --- Run planner (new session) ---
  // appendSystemPrompt enforces read-only constraint at the system level
  const planResult = await runAgent({
    prompt: PLANNER_PROMPT(taskInput),
    model: config.model,
    cwd: worktreePath,
    maxTurns: config.maxPlannerTurns,
    allowedTools: ['Read', 'Glob', 'Grep', 'Bash', 'Write'],
    appendSystemPrompt: 'CRITICAL CONSTRAINT: You are in PLANNING mode. You may ONLY write to files inside the .agent/ directory (e.g., .agent/plan.md). You MUST NOT create, edit, modify, or write to any source code files, test files, or configuration files outside .agent/. If you feel tempted to make code changes, STOP — that is the coder\'s job. Your ONLY output is .agent/plan.md.',
  });

  totalCost += planResult.costUsd;
  log.cost('Planner', planResult.costUsd);

  // --- Validate plan exists ---
  const planPath = join(worktreePath, '.agent', 'plan.md');
  if (!existsSync(planPath)) {
    throw new Error('Planner did not create .agent/plan.md');
  }

  const planContent = readFileSync(planPath, 'utf-8');
  if (!planContent.includes('## Detailed Plan') && !planContent.includes('## Plan')) {
    throw new Error('.agent/plan.md is missing required sections');
  }

  log.success('Plan written to .agent/plan.md');

  let planSessionId = planResult.sessionId;

  // --- Human Simulator review loop ---
  if (!config.skipReview) {
    for (let cycle = 0; cycle < config.maxPlanReviewCycles; cycle++) {
      const verdict = await runSimulator('plan', taskInput, config, worktreePath);
      totalCost += verdict.costUsd;

      if (verdict.verdict === 'approve') {
        break;
      }

      // Revise: resume planner with feedback
      if (cycle < config.maxPlanReviewCycles - 1) {
        log.stage('plan', `Revising plan (cycle ${cycle + 2}/${config.maxPlanReviewCycles})...`);

        const issuesFeedback = verdict.issues.length > 0
          ? verdict.issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')
          : verdict.feedback;

        const revisionResult = await runAgent({
          prompt: PLANNER_REVISION_PROMPT(issuesFeedback),
          model: config.model,
          cwd: worktreePath,
          maxTurns: config.maxPlannerTurns,
          allowedTools: ['Read', 'Glob', 'Grep', 'Bash', 'Write'],
          resume: planSessionId,
          appendSystemPrompt: 'CRITICAL CONSTRAINT: You are in PLANNING mode. You may ONLY write to files inside the .agent/ directory. You MUST NOT modify any source code files.',
        });

        totalCost += revisionResult.costUsd;
        planSessionId = revisionResult.sessionId;
        log.cost('Planner (revision)', revisionResult.costUsd);
      } else {
        log.warn('Max plan review cycles reached, proceeding with current plan');
      }
    }
  }

  const durationMs = Date.now() - startTime;

  return {
    stageResult: {
      stage: 'plan',
      success: true,
      sessionId: planSessionId,
      costUsd: totalCost,
      durationMs,
    },
    planSessionId,
  };
}

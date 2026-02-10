import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type {
  TaskInput,
  AgentConfig,
  PhaseResult,
  PlanReviewVerdict,
} from '../types.js';
import { runAgent } from '../utils/sdk.js';
import { log } from '../utils/logger.js';

export async function planReview(
  taskInput: TaskInput,
  planContent: string,
  config: AgentConfig,
  worktreePath: string,
): Promise<{ result: PhaseResult; verdict: PlanReviewVerdict }> {
  const startTime = Date.now();

  log.phase('plan-review', 'Reviewing implementation plan');

  // --- Build prompt ---
  const prompt = `You are a senior architect reviewing an implementation plan. You did NOT write this plan.

TASK:
${taskInput.title}
${taskInput.description}

PLAN:
${planContent}

Review the plan for:
1. FEASIBILITY: Can this plan actually be implemented given the codebase?
2. COMPLETENESS: Does the plan cover all aspects of the task?
3. DESIGN: Are the patterns and approaches appropriate for this codebase?
4. SCOPE: Is the plan appropriately scoped (not too ambitious, not missing things)?
5. RISKS: Are the identified risks real? Are there risks the planner missed?

You may explore the codebase to verify the plan's assumptions.

Write your review to .agent/plan-review.json as valid JSON:
{
  "verdict": "approve" | "revise" | "reject",
  "feedback": [
    { "category": "feasibility|completeness|design|scope|risk", "severity": "critical|suggestion", "description": "what's wrong", "recommendation": "what to do instead" }
  ],
  "summary": "one-line summary"
}

Rules:
- "approve" if the plan is solid enough to execute
- "revise" if there are fixable issues
- "reject" only if the task is fundamentally unclear or the plan is completely wrong
- Be specific about what to change for "revise" verdicts`;

  // --- Run agent ---
  const agentResult = await runAgent({
    prompt,
    model: config.reviewModel,
    cwd: worktreePath,
    maxTurns: config.maxPlanReviewTurns,
    allowedTools: ['Read', 'Glob', 'Grep', 'Bash', 'Write'],
  });

  log.cost('plan-review', agentResult.costUsd);

  // --- Read and parse review ---
  const reviewPath = join(worktreePath, '.agent', 'plan-review.json');
  let verdict: PlanReviewVerdict;

  try {
    const raw = readFileSync(reviewPath, 'utf-8');
    verdict = JSON.parse(raw) as PlanReviewVerdict;
  } catch {
    log.warn('Could not parse plan-review.json, defaulting to approve');
    verdict = {
      verdict: 'approve',
      feedback: [],
      summary: 'Review output could not be parsed, proceeding',
    };
  }

  log.phase('plan-review', `Verdict: ${verdict.verdict} — ${verdict.summary}`);

  // --- Build result ---
  const durationMs = Date.now() - startTime;

  const result: PhaseResult = {
    phase: 'plan-review',
    success: true,
    sessionId: agentResult.sessionId,
    costUsd: agentResult.costUsd,
    durationMs,
  };

  return { result, verdict };
}

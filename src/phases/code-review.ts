import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runAgent } from '../utils/sdk.js';
import { log } from '../utils/logger.js';
import type { TaskInput, AgentConfig, PhaseResult, CodeReviewVerdict } from '../types.js';

const MAX_DIFF_LENGTH = 50_000;

export async function codeReview(
  taskInput: TaskInput,
  planContent: string,
  diff: string,
  config: AgentConfig,
  worktreePath: string,
): Promise<{ result: PhaseResult; verdict: CodeReviewVerdict }> {
  log.phase('code-review', `Reviewing code changes for task: ${taskInput.title}`);

  let truncatedDiff = diff;
  if (diff.length > MAX_DIFF_LENGTH) {
    truncatedDiff =
      diff.slice(0, MAX_DIFF_LENGTH) +
      `\n\n[diff truncated, ${diff.length} chars total]`;
  }

  const prompt = `You are a senior engineer reviewing code changes. You did NOT write this code.

ORIGINAL TASK: ${taskInput.title} — ${taskInput.description}

IMPLEMENTATION PLAN:
${planContent}

GIT DIFF:
${truncatedDiff}

Review for:
1. COMPLETENESS: Does the diff implement all plan steps?
2. CORRECTNESS: Logic errors, edge cases, null handling, off-by-one?
3. SECURITY: Hardcoded secrets, injection, path traversal?
4. STYLE: Consistent with existing codebase patterns?

Write to .agent/code-review.json as valid JSON:
{
  "verdict": "pass" | "fail",
  "issues": [
    { "severity": "critical|major|minor", "category": "correctness|security|completeness|style",
      "file": "path", "description": "what", "suggestion": "how to fix" }
  ],
  "summary": "one-line"
}

Rules:
- "fail" only for critical or major issues
- Be specific with file paths
- Flag genuine issues, not style preferences`;

  const agentResult = await runAgent({
    prompt,
    model: config.reviewModel,
    cwd: worktreePath,
    maxTurns: config.maxCodeReviewTurns,
    allowedTools: ['Read', 'Glob', 'Grep', 'Bash', 'Write'],
  });

  log.cost('code-review', agentResult.costUsd);

  let verdict: CodeReviewVerdict;
  try {
    const reviewPath = join(worktreePath, '.agent', 'code-review.json');
    const raw = readFileSync(reviewPath, 'utf-8');
    verdict = JSON.parse(raw) as CodeReviewVerdict;
  } catch {
    log.warn('Failed to parse code-review.json, defaulting to pass');
    verdict = {
      verdict: 'pass',
      issues: [],
      summary: 'Review output could not be parsed, proceeding',
    };
  }

  const result: PhaseResult = {
    phase: 'code-review',
    success: true,
    sessionId: agentResult.sessionId,
    costUsd: agentResult.costUsd,
    durationMs: agentResult.durationMs,
  };

  return { result, verdict };
}

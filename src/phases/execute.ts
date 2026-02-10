import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runAgent } from '../utils/sdk.js';
import { getDiff } from '../utils/git.js';
import { log } from '../utils/logger.js';
import type { TaskInput, AgentConfig, PhaseResult } from '../types.js';

export async function execute(
  taskInput: TaskInput,
  config: AgentConfig,
  worktreePath: string,
  planSessionId: string,
): Promise<{ result: PhaseResult; diff: string }> {
  log.phase('execute', `Implementing plan for task: ${taskInput.title}`);

  const prompt = `The plan has been approved. Now implement it.

RULES:
- Implement each step from .agent/plan.md in order
- After each step, verify: no syntax errors, imports resolve
- Write tests if the plan's Test Strategy calls for them
- Do NOT run the full test suite — the orchestrator handles that
- When done, re-read each file you modified and verify correctness
- Do NOT commit anything — the orchestrator handles git`;

  const agentResult = await runAgent({
    prompt,
    model: config.executeModel,
    cwd: worktreePath,
    maxTurns: config.maxExecuteTurns,
    resume: planSessionId,
    allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'NotebookEdit'],
  });

  log.cost('execute', agentResult.costUsd);

  const diff = getDiff(worktreePath);

  if (!diff) {
    throw new Error('Execution produced no code changes');
  }

  const result: PhaseResult = {
    phase: 'execute',
    success: true,
    sessionId: agentResult.sessionId,
    costUsd: agentResult.costUsd,
    durationMs: agentResult.durationMs,
  };

  return { result, diff };
}

export async function executeFixFromReview(
  config: AgentConfig,
  worktreePath: string,
  planSessionId: string,
  issues: string,
  previousDiff: string,
): Promise<{ result: PhaseResult; diff: string }> {
  log.phase('execute', 'Fixing issues found during code review');

  const prompt = `Code reviewer found issues:\n\n${issues}\n\nFix these issues in the code. Do NOT commit.`;

  const agentResult = await runAgent({
    prompt,
    model: config.executeModel,
    cwd: worktreePath,
    maxTurns: config.maxExecuteTurns,
    resume: planSessionId,
    allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'NotebookEdit'],
  });

  log.cost('execute (fix from review)', agentResult.costUsd);

  // Use current diff, or fall back to previous diff if agent made no new changes
  const diff = getDiff(worktreePath) || previousDiff;

  const result: PhaseResult = {
    phase: 'execute',
    success: true,
    sessionId: agentResult.sessionId,
    costUsd: agentResult.costUsd,
    durationMs: agentResult.durationMs,
  };

  return { result, diff };
}

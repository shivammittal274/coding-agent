import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type {
  TaskInput,
  ProjectInfo,
  AgentConfig,
  PhaseResult,
} from '../types.js';
import { runAgent } from '../utils/sdk.js';
import { log } from '../utils/logger.js';

export async function plan(
  taskInput: TaskInput,
  projectInfo: ProjectInfo,
  config: AgentConfig,
  worktreePath: string,
  resumeSessionId?: string,
  reviewFeedback?: string,
): Promise<{ result: PhaseResult; planContent: string; sessionId: string }> {
  const startTime = Date.now();

  log.phase('plan', resumeSessionId ? 'Revising plan based on review feedback' : 'Planning implementation');

  // --- Build prompt ---
  const basePrompt = `You are a senior engineer planning the implementation of a task.

TASK:
${taskInput.title}
${taskInput.description}

PROJECT INFO:
- Type: ${projectInfo.type}
- Test framework: ${projectInfo.testCommand || 'unknown'}
- Lint command: ${projectInfo.lintCommand || 'none'}
- Typecheck command: ${projectInfo.typecheckCommand || 'none'}

INSTRUCTIONS:
1. Explore the codebase: architecture, patterns, conventions, relevant files
2. Identify which files need to be modified or created
3. Think about edge cases, error handling, and how this integrates with existing code
4. Write your plan to .agent/plan.md in this exact format:

## Analysis
[What you found: architecture, relevant files, patterns, conventions]

## Plan
- [ ] Step 1: {description} (files: {paths})
- [ ] Step 2: ...

## Test Strategy
- Test framework: {detected or "none"}
- Test command: {command}
- New tests to write: {descriptions}
- Existing tests that may be affected: {paths}

## Risks & Ambiguities
- {risk 1}: {mitigation}
- {ambiguity 1}: {assumption you're making}

DO NOT make any code changes. Only explore and plan.`;

  let prompt: string;
  if (resumeSessionId && reviewFeedback) {
    prompt = `The plan reviewer found issues with your previous plan. Here is their feedback:\n\n${reviewFeedback}\n\nPlease revise .agent/plan.md to address these issues.`;
  } else {
    prompt = basePrompt;
  }

  // --- Run agent ---
  const agentResult = await runAgent({
    prompt,
    model: config.planModel,
    cwd: worktreePath,
    maxTurns: config.maxPlanTurns,
    allowedTools: ['Read', 'Glob', 'Grep', 'Bash', 'Write'],
    ...(resumeSessionId && { resume: resumeSessionId }),
  });

  log.cost('plan', agentResult.costUsd);

  // --- Read and validate plan ---
  const planPath = join(worktreePath, '.agent', 'plan.md');
  let planContent: string;

  try {
    planContent = readFileSync(planPath, 'utf-8');
  } catch {
    throw new Error(`Plan file not found at ${planPath}. The agent did not write .agent/plan.md`);
  }

  const requiredSections = ['## Plan', '## Test Strategy', '## Risks'];
  const missingSections = requiredSections.filter(
    (section) => !planContent.includes(section),
  );

  if (missingSections.length > 0) {
    throw new Error(
      `Plan is missing required sections: ${missingSections.join(', ')}. ` +
      `The plan must include ## Plan, ## Test Strategy, and ## Risks & Ambiguities sections.`,
    );
  }

  // --- Build result ---
  const durationMs = Date.now() - startTime;

  const result: PhaseResult = {
    phase: 'plan',
    success: true,
    sessionId: agentResult.sessionId,
    costUsd: agentResult.costUsd,
    durationMs,
  };

  return { result, planContent, sessionId: agentResult.sessionId };
}

import type { TaskInput, AgentConfig, StageResult } from '../types.js';
import { runAgent } from '../utils/sdk.js';
import { runSimulator } from '../human-simulator.js';
import { getDiffFromBaseline } from '../utils/git.js';
import { log } from '../utils/logger.js';

// ─── Coder Prompt ────────────────────────────────────────────────────

const CODER_PROMPT = (task: TaskInput) => `You are a disciplined software engineer implementing a feature according to a plan.
Read the plan first, then execute it methodically.

TASK:
Title: ${task.title}
Description: ${task.description}

YOUR PROCESS — follow these steps EXACTLY:

═══ STEP 0: UNDERSTAND THE PLAN ═══
1. Read .agent/plan.md thoroughly — understand every step before writing any code.
2. Read the Localization Map — know exactly which files to modify/create.
3. Read the Context Files listed in the plan — understand the interfaces and patterns you must follow.

═══ STEP 1..N: IMPLEMENT EACH PLAN STEP ═══
For EACH step in the Detailed Plan:

1. READ the target file(s) first to understand current state.
2. IMPLEMENT the change described in the plan step.
3. VERIFY immediately:
   - Read back what you wrote to check for typos, missing imports, logic errors.
   - Run the verify command from the plan step (e.g., "npx tsc --noEmit").
   - If tests are relevant, run them.
4. If verification FAILS:
   - Read the error output carefully.
   - Fix the issue (max 3 attempts per step).
   - If still failing after 3 attempts, note the issue and move on.
5. COMMIT your progress:
   - Run: git add -A && git commit -m "step N: [brief description of what was done]"
6. UPDATE progress:
   - Write/append to .agent/progress.md:
     "## Step N: [title] — DONE" or "## Step N: [title] — BLOCKED: [reason]"

═══ FINAL: SELF-REVIEW ═══
After all steps are complete:
1. Re-read every file you modified — look for:
   - Missing imports
   - Inconsistent naming
   - TODO comments you left
   - Edge cases not handled
2. Run the full verification suite from the plan's Test Strategy.
3. Fix any issues found.
4. Update .agent/progress.md with a final summary.

CRITICAL RULES:
- Follow the plan's Detailed Plan section step by step. Do NOT skip steps.
- Do NOT redesign the architecture — the plan was reviewed and approved.
- If the plan says to follow a pattern from another file, READ that file and match the pattern.
- If you discover the plan has an error (file doesn't exist, wrong function name), adapt
  intelligently but note the deviation in progress.md.
- Do NOT run "git push" — the orchestrator handles that.
- Commit after EACH step so progress is saved. Use descriptive commit messages.
- If you're unsure about something, check the plan. If the plan doesn't cover it,
  make the simplest choice that works and note it in progress.md.`;

const CODER_REVISION_PROMPT = (feedback: string) => `The code reviewer found issues with your implementation. Here is their feedback:

${feedback}

Fix these issues. For each fix:
1. Read the file mentioned in the issue.
2. Make the fix.
3. Verify the fix (run relevant tests/checks).
4. Commit: git add -A && git commit -m "fix: [brief description]"
5. Update .agent/progress.md with what you fixed.

Do NOT change anything that wasn't flagged in the review.`;

// ─── Stage ───────────────────────────────────────────────────────────

export interface ImplementResult {
  stageResult: StageResult;
  coderSessionId: string;
}

export async function runImplement(
  taskInput: TaskInput,
  config: AgentConfig,
  worktreePath: string,
): Promise<ImplementResult> {
  const startTime = Date.now();
  let totalCost = 0;

  log.stage('implement', 'Starting coder agent...');

  // --- Run coder (new session — fresh context, plan.md as handoff) ---
  const coderResult = await runAgent({
    prompt: CODER_PROMPT(taskInput),
    model: config.model,
    cwd: worktreePath,
    maxTurns: config.maxCoderTurns,
    allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'NotebookEdit'],
  });

  totalCost += coderResult.costUsd;
  log.cost('Coder', coderResult.costUsd);

  // --- Verify non-empty diff (compare against baseline, not HEAD, because coder commits per step) ---
  const diff = getDiffFromBaseline(worktreePath);
  if (!diff || diff.trim().length === 0) {
    throw new Error('Coder produced no changes (empty diff)');
  }

  log.success(`Implementation complete (${diff.split('\n').length} diff lines)`);

  let coderSessionId = coderResult.sessionId;

  // --- Human Simulator review loop ---
  if (!config.skipReview) {
    for (let cycle = 0; cycle < config.maxCodeReviewCycles; cycle++) {
      const verdict = await runSimulator('implementation', taskInput, config, worktreePath);
      totalCost += verdict.costUsd;

      if (verdict.verdict === 'approve') {
        break;
      }

      // Revise: resume coder with feedback
      if (cycle < config.maxCodeReviewCycles - 1) {
        log.stage('implement', `Fixing review issues (cycle ${cycle + 2}/${config.maxCodeReviewCycles})...`);

        const issuesFeedback = verdict.issues.length > 0
          ? verdict.issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')
          : verdict.feedback;

        const fixResult = await runAgent({
          prompt: CODER_REVISION_PROMPT(issuesFeedback),
          model: config.model,
          cwd: worktreePath,
          maxTurns: config.maxCoderTurns,
          allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'NotebookEdit'],
          resume: coderSessionId,
        });

        totalCost += fixResult.costUsd;
        coderSessionId = fixResult.sessionId;
        log.cost('Coder (fix)', fixResult.costUsd);
      } else {
        log.warn('Max code review cycles reached, proceeding with current implementation');
      }
    }
  }

  const durationMs = Date.now() - startTime;

  return {
    stageResult: {
      stage: 'implement',
      success: true,
      sessionId: coderSessionId,
      costUsd: totalCost,
      durationMs,
    },
    coderSessionId,
  };
}

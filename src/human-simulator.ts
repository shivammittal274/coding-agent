import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TaskInput, AgentConfig, SimulatorVerdict } from './types.js';
import { runAgent } from './utils/sdk.js';
import { getDiffStatFromBaseline, getChangedFilesFromBaseline } from './utils/git.js';
import { log } from './utils/logger.js';

// ─── Prompts ─────────────────────────────────────────────────────────

const PLAN_REVIEW_PROMPT = (task: TaskInput, planContent: string) => `You are a senior staff engineer and tech lead reviewing an implementation plan.
You did NOT write this plan. Your job: protect the codebase while helping the team ship quickly.

TASK THE PLAN IS FOR:
Title: ${task.title}
Description: ${task.description}

THE PLAN:
${planContent}

YOUR REVIEW PROCESS:
1. Read the plan carefully.
2. VERIFY the localization claims — the plan references specific files, functions, and line numbers.
   Use your tools to actually read those files and confirm:
   - Do the mentioned files exist?
   - Are the mentioned functions/classes at the stated locations?
   - Does the existing code structure match what the plan assumes?
3. Check COMPLETENESS: Does this plan address all aspects of the task?
4. Check FEASIBILITY: Can the proposed changes actually work given the codebase?
5. Check TEST STRATEGY: Is it adequate? Does it cover the changes?
6. Check for MISSING STEPS: Are there obvious gaps?

PHILOSOPHY:
- Default to APPROVAL. Only request revisions for issues that would cause bugs, incomplete
  implementation, or make the code untestable.
- Every piece of feedback MUST be actionable: what's wrong, where, why, and how to fix it.
- Maximum 5 issues. Prioritize by impact. If there are more than 5, drop the least important.
- Do NOT nitpick style, formatting, or naming conventions.
- If unsure whether something is an issue, frame it as a question, not a demand.
- A plan doesn't need to be perfect — it needs to be good enough to guide implementation.

THINK STEP BY STEP before giving your verdict. First write your reasoning, then give the verdict.

OUTPUT FORMAT (plain text, not JSON):
Write your analysis, then end with EXACTLY one of:

VERDICT: APPROVE

or:

VERDICT: REVISE
ISSUES:
1. [category] description — recommendation
2. ...

Categories: feasibility, completeness, design, scope, risk`;

const IMPLEMENTATION_REVIEW_PROMPT = (task: TaskInput, planContent: string, diffStat: string, changedFiles: string[]) => `You are a senior staff engineer and tech lead reviewing a code implementation.
You did NOT write this code. Your job: protect the codebase while helping the team ship quickly.

TASK:
Title: ${task.title}
Description: ${task.description}

IMPLEMENTATION PLAN (what was supposed to be built):
${planContent}

DIFF SUMMARY:
${diffStat}

FILES CHANGED:
${changedFiles.join('\n')}

YOUR REVIEW PROCESS:
1. Read the plan to understand what SHOULD have been implemented.
2. Read each changed file listed above (the full file, not just the diff) to understand the
   implementation in context. Use Read tool on each file.
3. Check REQUIREMENTS ALIGNMENT: Does the implementation match what the task asked for?
4. Check PLAN COMPLETION: Were all plan steps completed?
5. Check CORRECTNESS: Look for logic errors, null handling, edge cases, off-by-one errors.
6. Check SECURITY: Hardcoded secrets, injection vulnerabilities, path traversal.
7. If tests were supposed to be written (per the plan), verify they exist and cover the changes.

PHILOSOPHY:
- Default to APPROVAL. Only request revisions for issues that would cause bugs, incomplete
  implementation, or security vulnerabilities in production.
- Every piece of feedback MUST be actionable: file path, what's wrong, how to fix it.
- Maximum 5 issues. Prioritize by impact.
- Do NOT nitpick: style, formatting, naming, comments, type annotations on unchanged code.
- Minor improvements can be done in follow-up PRs.
- "Good enough to ship" is the bar, not "perfect."

THINK STEP BY STEP before giving your verdict. First write your analysis, then give the verdict.

OUTPUT FORMAT (plain text, not JSON):
Write your analysis, then end with EXACTLY one of:

VERDICT: APPROVE

or:

VERDICT: REVISE
ISSUES:
1. [file:path] description — how to fix
2. ...`;

// ─── Verdict Parser ──────────────────────────────────────────────────

function parseVerdict(text: string): SimulatorVerdict {
  const costUsd = 0; // Cost is tracked separately by the caller

  // Find the last VERDICT line (the model may discuss "VERDICT" earlier in reasoning)
  const lines = text.split('\n');
  let verdictLineIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim().startsWith('VERDICT:')) {
      verdictLineIdx = i;
      break;
    }
  }

  if (verdictLineIdx === -1) {
    // No verdict found — default to approve (don't block on parse failure)
    log.warn('Human Simulator: no verdict found in output, defaulting to APPROVE');
    return { verdict: 'approve', feedback: text, issues: [], costUsd };
  }

  const verdictLine = lines[verdictLineIdx].trim();

  if (verdictLine.includes('APPROVE')) {
    return { verdict: 'approve', feedback: text, issues: [], costUsd };
  }

  // Parse REVISE issues
  const issues: string[] = [];
  for (let i = verdictLineIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('ISSUES:')) continue;
    // Match numbered issues: "1. ...", "2. ...", etc.
    if (/^\d+\.\s/.test(line)) {
      issues.push(line.replace(/^\d+\.\s*/, ''));
    }
  }

  return {
    verdict: 'revise',
    feedback: text,
    issues,
    costUsd,
  };
}

// ─── Public API ──────────────────────────────────────────────────────

export type SimulatorMode = 'plan' | 'implementation';

export async function runSimulator(
  mode: SimulatorMode,
  taskInput: TaskInput,
  config: AgentConfig,
  worktreePath: string,
): Promise<SimulatorVerdict> {
  log.stage('simulator', `Running ${mode} review...`);

  let prompt: string;

  if (mode === 'plan') {
    const planPath = join(worktreePath, '.agent', 'plan.md');
    let planContent: string;
    try {
      planContent = readFileSync(planPath, 'utf-8');
    } catch {
      return { verdict: 'approve', feedback: 'No plan file found, skipping review', issues: [], costUsd: 0 };
    }
    prompt = PLAN_REVIEW_PROMPT(taskInput, planContent);
  } else {
    const planPath = join(worktreePath, '.agent', 'plan.md');
    let planContent = '';
    try {
      planContent = readFileSync(planPath, 'utf-8');
    } catch {
      // Plan may not exist if review was skipped
    }
    const diffStat = getDiffStatFromBaseline(worktreePath);
    const changedFiles = getChangedFilesFromBaseline(worktreePath);
    prompt = IMPLEMENTATION_REVIEW_PROMPT(taskInput, planContent, diffStat, changedFiles);
  }

  try {
    const result = await runAgent({
      prompt,
      model: config.model,
      cwd: worktreePath,
      maxTurns: config.maxSimulatorTurns,
      allowedTools: ['Read', 'Glob', 'Grep', 'Bash'],
    });

    const verdict = parseVerdict(result.result);
    verdict.costUsd = result.costUsd;

    if (verdict.verdict === 'approve') {
      log.success(`${mode} review: APPROVED`);
    } else {
      log.stage('simulator', `${mode} review: REVISE (${verdict.issues.length} issues)`);
      for (const issue of verdict.issues) {
        log.stage('simulator', `  - ${issue}`);
      }
    }

    return verdict;
  } catch (err) {
    log.warn(`Human Simulator error, defaulting to approve: ${err instanceof Error ? err.message : String(err)}`);
    return { verdict: 'approve', feedback: 'Review failed, proceeding', issues: [], costUsd: 0 };
  }
}

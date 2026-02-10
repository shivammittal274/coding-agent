import { runAgent } from '../utils/sdk.js';
import { getChangedFiles } from '../utils/git.js';
import { log } from '../utils/logger.js';
import type { TestResult, AgentConfig, PhaseResult } from '../types.js';
import type { TestBaseline } from '../utils/test-runner.js';

export async function testFix(
  testResult: TestResult,
  config: AgentConfig,
  worktreePath: string,
  sessionId?: string,
  baseline?: TestBaseline,
): Promise<{ result: PhaseResult }> {
  log.phase('test-fix', 'Attempting to fix failing tests');

  const changedFiles = getChangedFiles(worktreePath);

  // Build baseline context so agent knows what was already broken
  const baselineInfo: string[] = [];
  if (baseline) {
    if (!baseline.runLint) baselineInfo.push('- Lint was ALREADY failing before your changes (not your fault)');
    if (!baseline.runTypecheck) baselineInfo.push('- Typecheck was ALREADY failing before your changes (not your fault)');
    if (!baseline.runUnit) baselineInfo.push('- Unit tests were ALREADY failing before your changes (not your fault)');
  }

  const prompt = `Tests are failing. Fix the code.

FAILING OUTPUT:
${testResult.output}

FAILURE TYPE: ${testResult.failureCategory || 'unknown'}

FILES YOU CHANGED (from git diff --name-only):
${changedFiles.join('\n')}
${baselineInfo.length > 0 ? `\nPRE-EXISTING FAILURES (these were broken BEFORE your changes):\n${baselineInfo.join('\n')}\n` : ''}
RULES:
- Only fix errors that YOUR changes introduced
- Do NOT try to fix pre-existing failures listed above
- Fix source code, not pre-existing tests (unless you wrote them)
- If you cannot fix, leave a TODO comment
- Do NOT modify unrelated files
- Do NOT commit anything`;

  const agentResult = await runAgent({
    prompt,
    model: config.testFixModel,
    cwd: worktreePath,
    maxTurns: config.maxTestFixTurns,
    allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep'],
    ...(sessionId && { resume: sessionId }),
  });

  log.cost('test-fix', agentResult.costUsd);

  const result: PhaseResult = {
    phase: 'test-fix',
    success: true,
    sessionId: agentResult.sessionId,
    costUsd: agentResult.costUsd,
    durationMs: agentResult.durationMs,
  };

  return { result };
}

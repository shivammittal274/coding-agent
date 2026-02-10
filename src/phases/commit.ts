import { stageAll, commit, push, getDiffStat, removeWorktree } from '../utils/git.js';
import { generatePrBody, createPr } from '../utils/pr.js';
import { log } from '../utils/logger.js';
import type {
  TaskInput,
  ProjectInfo,
  AgentConfig,
  PhaseResult,
  TestResult,
} from '../types.js';

export async function commitPhase(
  taskInput: TaskInput,
  projectInfo: ProjectInfo,
  config: AgentConfig,
  worktreePath: string,
  branchName: string,
  phases: PhaseResult[],
  totalCost: number,
  testResult?: TestResult,
  codeReviewSummary?: string,
  isDraft?: boolean,
): Promise<{ result: PhaseResult; prUrl?: string }> {
  const start = Date.now();
  let prUrl: string | undefined;

  log.phase('commit', 'Committing changes and creating PR');

  stageAll(worktreePath);

  const commitMessage = `feat(agent): ${taskInput.title}\n\nTask ID: ${taskInput.id}`;
  commit(worktreePath, commitMessage);

  const shouldPush = projectInfo.canPush && !config.noPush;

  if (shouldPush) {
    // Get diff stat while we still have the worktree
    const diffStat = getDiffStat(worktreePath);

    // Push from the MAIN repo directory, not the worktree.
    // Worktrees share git refs/objects with the main repo, so the branch is visible.
    // Credential helpers (macOS Keychain, gh auth) resolve correctly from the main repo path.
    try {
      push(taskInput.repoPath, branchName);
      log.success(`Pushed branch: ${branchName}`);
    } catch (err) {
      log.warn(`Failed to push branch: ${err instanceof Error ? err.message : String(err)}`);
    }

    const body = generatePrBody({
      title: taskInput.title,
      description: taskInput.description,
      diffStat,
      phases,
      totalCost,
      testResult: testResult
        ? { passed: testResult.passed, output: testResult.output }
        : undefined,
      codeReviewSummary,
    });

    try {
      const url = await createPr(
        taskInput.repoPath,
        branchName,
        taskInput.title,
        body,
        isDraft ?? false,
      );
      if (url) {
        prUrl = url;
        log.success(`PR created: ${prUrl}`);
      }
    } catch (err) {
      log.warn(`Failed to create PR: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (projectInfo.hasGitRemote && !projectInfo.canPush) {
    log.warn('Remote exists but cannot push (no auth). Commit saved locally.');
  } else if (config.noPush) {
    log.phase('commit', 'Push skipped (--no-push)');
  }

  removeWorktree(taskInput.repoPath, worktreePath);

  const result: PhaseResult = {
    phase: 'commit',
    success: true,
    costUsd: 0,
    durationMs: Date.now() - start,
  };

  return { result, prUrl };
}

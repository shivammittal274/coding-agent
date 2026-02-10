import type { TaskInput, ProjectInfo, AgentConfig, StageResult } from '../types.js';
import { stageAll, commit, push, getDiffStatFromBaseline, removeWorktree, execSafe, getBaselineCommit } from '../utils/git.js';
import { generatePrBody, createPr } from '../utils/pr.js';
import { log } from '../utils/logger.js';

export interface CommitResult {
  stageResult: StageResult;
  prUrl?: string;
}

export async function runCommit(
  taskInput: TaskInput,
  projectInfo: ProjectInfo,
  config: AgentConfig,
  worktreePath: string,
  branchName: string,
  stages: StageResult[],
  totalCost: number,
  isDraft?: boolean,
): Promise<CommitResult> {
  const startTime = Date.now();
  let prUrl: string | undefined;

  log.stage('commit', 'Committing changes and creating PR...');

  // --- Squash intermediate coder commits into one clean commit ---
  // The coder made step-by-step commits. Squash them into a single feat commit.
  const baseline = getBaselineCommit(worktreePath);
  if (baseline) {
    execSafe(`git reset --soft ${baseline}`, worktreePath);
  }

  stageAll(worktreePath);
  const commitMessage = `feat(agent): ${taskInput.title}\n\nTask ID: ${taskInput.id}`;
  try {
    commit(worktreePath, commitMessage);
  } catch {
    // Nothing to commit — maybe diff was empty (shouldn't reach here)
    log.warn('Nothing to commit');
  }

  const shouldPush = projectInfo.canPush && !config.noPush;

  if (shouldPush) {
    const diffStat = getDiffStatFromBaseline(worktreePath);

    // Push from MAIN repo dir (credential helpers resolve correctly there)
    try {
      push(taskInput.repoPath, branchName);
      log.success(`Pushed branch: ${branchName}`);
    } catch (err) {
      log.warn(`Failed to push: ${err instanceof Error ? err.message : String(err)}`);
    }

    const body = generatePrBody({
      title: taskInput.title,
      description: taskInput.description,
      diffStat,
      stages,
      totalCost,
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
  } else if (projectInfo.hasRemote && !projectInfo.canPush) {
    log.warn('Remote exists but cannot push (no auth). Commit saved locally.');
  } else if (config.noPush) {
    log.stage('commit', 'Push skipped (--skip-push)');
  }

  // --- Cleanup worktree ---
  removeWorktree(taskInput.repoPath, worktreePath);
  log.stage('commit', 'Worktree cleaned up');

  const durationMs = Date.now() - startTime;

  return {
    stageResult: {
      stage: 'commit',
      success: true,
      costUsd: 0,
      durationMs,
    },
    prUrl,
  };
}

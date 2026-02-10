import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type {
  TaskInput,
  ProjectInfo,
  AgentConfig,
  PhaseResult,
} from '../types.js';
import {
  fetchOrigin,
  createWorktree,
  execSafe,
  stageAll,
  commit,
} from '../utils/git.js';
import { log } from '../utils/logger.js';

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 40);
}

export async function setup(
  taskInput: TaskInput,
  projectInfo: ProjectInfo,
  config: AgentConfig,
): Promise<{ result: PhaseResult; worktreePath: string; branchName: string }> {
  const startTime = Date.now();

  // --- Build branch name ---
  const slug = slugify(taskInput.title);
  const branchName = `${config.branchPrefix}/${taskInput.id}-${slug}`;

  // --- Build worktree path ---
  const worktreePath = resolve(
    taskInput.repoPath,
    config.worktreeBase,
    taskInput.id,
  );

  // --- Fetch origin if remote exists ---
  if (projectInfo.hasGitRemote) {
    try {
      fetchOrigin(taskInput.repoPath);
    } catch (err) {
      log.warn(`Failed to fetch origin, continuing anyway: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // --- Create worktree ---
  createWorktree(
    taskInput.repoPath,
    worktreePath,
    branchName,
    projectInfo.defaultBranch,
    projectInfo.hasGitRemote,
  );

  // --- Create .agent/ directory and ensure it's gitignored ---
  mkdirSync(join(worktreePath, '.agent'), { recursive: true });
  const gitignorePath = join(worktreePath, '.gitignore');
  const gitignoreEntry = '\n# Coding agent artifacts\n.agent/\n';
  if (existsSync(gitignorePath)) {
    const existing = readFileSync(gitignorePath, 'utf-8');
    if (!existing.includes('.agent/')) {
      appendFileSync(gitignorePath, gitignoreEntry);
    }
  } else {
    writeFileSync(gitignorePath, gitignoreEntry.trimStart());
  }

  // --- Copy CLAUDE.md if it exists ---
  const claudeMdSrc = join(taskInput.repoPath, 'CLAUDE.md');
  if (existsSync(claudeMdSrc)) {
    copyFileSync(claudeMdSrc, join(worktreePath, 'CLAUDE.md'));
  }

  // --- Install dependencies ---
  if (projectInfo.packageManager) {
    let installCmd: string;

    switch (projectInfo.packageManager) {
      case 'npm':
        installCmd = 'npm ci';
        break;
      case 'yarn':
        installCmd = 'yarn install --frozen-lockfile';
        break;
      case 'pnpm':
        installCmd = 'pnpm install --frozen-lockfile';
        break;
      case 'bun':
        installCmd = 'bun install --frozen-lockfile';
        break;
    }

    const installResult = execSafe(installCmd, worktreePath);
    if (!installResult.ok) {
      log.warn(
        `Dependency installation failed: ${installResult.stderr}`,
      );
    }
  }

  // --- Baseline commit so git diff only captures agent's work ---
  stageAll(worktreePath);
  try {
    commit(worktreePath, 'chore: baseline setup (deps, .agent dir)');
    log.phase('setup', 'Baseline commit created');
  } catch {
    // Nothing to commit (clean worktree) — that's fine
  }

  // --- Build result ---
  const durationMs = Date.now() - startTime;

  const result: PhaseResult = {
    phase: 'setup',
    success: true,
    costUsd: 0,
    durationMs,
  };

  return { result, worktreePath, branchName };
}

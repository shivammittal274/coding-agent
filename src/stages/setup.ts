import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { TaskInput, ProjectInfo, AgentConfig, StageResult } from '../types.js';
import {
  isGitRepo,
  getDefaultBranch,
  hasRemote,
  canPushToRemote,
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

function detectPackageManager(repoPath: string): ProjectInfo['packageManager'] {
  if (existsSync(join(repoPath, 'bun.lockb')) || existsSync(join(repoPath, 'bun.lock'))) return 'bun';
  if (existsSync(join(repoPath, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(repoPath, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(repoPath, 'package.json'))) return 'npm';
  return undefined;
}

function getInstallCommand(pm: ProjectInfo['packageManager']): string | undefined {
  switch (pm) {
    case 'npm': return 'npm ci';
    case 'yarn': return 'yarn install --frozen-lockfile';
    case 'pnpm': return 'pnpm install --frozen-lockfile';
    case 'bun': return 'bun install --frozen-lockfile';
    default: return undefined;
  }
}

export interface SetupResult {
  stageResult: StageResult;
  projectInfo: ProjectInfo;
  worktreePath: string;
  branchName: string;
}

export async function runSetup(
  taskInput: TaskInput,
  config: AgentConfig,
): Promise<SetupResult> {
  const startTime = Date.now();

  // --- Validate repo ---
  if (!existsSync(taskInput.repoPath)) {
    throw new Error(`Repository path does not exist: ${taskInput.repoPath}`);
  }
  if (!isGitRepo(taskInput.repoPath)) {
    throw new Error(`Not a git repository: ${taskInput.repoPath}`);
  }

  log.stage('setup', 'Validating repository...');

  // --- Detect minimal project info ---
  const packageManager = detectPackageManager(taskInput.repoPath);
  const defaultBranch = getDefaultBranch(taskInput.repoPath);
  const hasGitRemote = hasRemote(taskInput.repoPath);
  const canPush = hasGitRemote ? canPushToRemote(taskInput.repoPath) : false;

  const projectInfo: ProjectInfo = {
    packageManager,
    defaultBranch,
    hasRemote: hasGitRemote,
    canPush,
  };

  log.stage('setup', `Branch: ${defaultBranch} | PM: ${packageManager || 'none'} | Remote: ${hasGitRemote} | Push: ${canPush}`);

  // --- Fetch origin ---
  if (hasGitRemote) {
    try {
      fetchOrigin(taskInput.repoPath);
    } catch (err) {
      log.warn(`Failed to fetch origin: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // --- Create worktree ---
  const slug = slugify(taskInput.title);
  const branchName = `${config.branchPrefix}/${taskInput.id}-${slug}`;
  const worktreePath = resolve(taskInput.repoPath, config.worktreeBase, taskInput.id);

  createWorktree(taskInput.repoPath, worktreePath, branchName, defaultBranch, hasGitRemote);
  log.stage('setup', `Worktree: ${worktreePath}`);

  // --- Create .agent/ dir, gitignore it ---
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

  // --- Install deps ---
  const installCmd = getInstallCommand(packageManager);
  if (installCmd) {
    log.stage('setup', `Installing dependencies (${packageManager})...`);
    const result = execSafe(installCmd, worktreePath);
    if (!result.ok) {
      log.warn(`Dependency install failed: ${result.stderr.slice(0, 200)}`);
    }
  }

  // --- Baseline commit ---
  stageAll(worktreePath);
  try {
    commit(worktreePath, 'chore: baseline setup');
    log.stage('setup', 'Baseline commit created');
  } catch {
    // Nothing to commit — clean worktree
  }

  const durationMs = Date.now() - startTime;

  return {
    stageResult: {
      stage: 'setup',
      success: true,
      costUsd: 0,
      durationMs,
    },
    projectInfo,
    worktreePath,
    branchName,
  };
}

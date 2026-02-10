import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PhaseResult, ProjectInfo } from '../types.js';
import { isGitRepo, getDefaultBranch, hasRemote, canPushToRemote } from '../utils/git.js';

function makeRunCmd(pm: string, script: string): string {
  return `${pm} run ${script}`;
}

export async function intake(
  repoPath: string,
): Promise<{ result: PhaseResult; projectInfo: ProjectInfo }> {
  const startTime = Date.now();

  // --- Validate repo ---
  if (!existsSync(repoPath)) {
    throw new Error(`Repository path does not exist: ${repoPath}`);
  }

  if (!isGitRepo(repoPath)) {
    throw new Error(`Path is not a git repository: ${repoPath}`);
  }

  // --- Detect project type ---
  let type: ProjectInfo['type'] = 'unknown';

  if (existsSync(join(repoPath, 'package.json'))) {
    type = 'node';
  } else if (
    existsSync(join(repoPath, 'pyproject.toml')) ||
    existsSync(join(repoPath, 'requirements.txt'))
  ) {
    type = 'python';
  } else if (existsSync(join(repoPath, 'go.mod'))) {
    type = 'go';
  } else if (existsSync(join(repoPath, 'Cargo.toml'))) {
    type = 'rust';
  }

  // --- Detect package manager & commands (node only) ---
  let packageManager: ProjectInfo['packageManager'];
  let testCommand: string | undefined;
  let lintCommand: string | undefined;
  let typecheckCommand: string | undefined;
  let buildCommand: string | undefined;

  if (type === 'node') {
    if (
      existsSync(join(repoPath, 'bun.lockb')) ||
      existsSync(join(repoPath, 'bun.lock'))
    ) {
      packageManager = 'bun';
    } else if (existsSync(join(repoPath, 'pnpm-lock.yaml'))) {
      packageManager = 'pnpm';
    } else if (existsSync(join(repoPath, 'yarn.lock'))) {
      packageManager = 'yarn';
    } else {
      packageManager = 'npm';
    }

    try {
      const pkgRaw = readFileSync(join(repoPath, 'package.json'), 'utf-8');
      const pkg = JSON.parse(pkgRaw) as {
        scripts?: Record<string, string>;
      };
      const scripts = pkg.scripts ?? {};

      if (
        scripts.test &&
        !scripts.test.includes('no test specified')
      ) {
        testCommand = makeRunCmd(packageManager, 'test');
      }

      if (scripts.lint) {
        lintCommand = makeRunCmd(packageManager, 'lint');
      }

      if (scripts.typecheck) {
        typecheckCommand = makeRunCmd(packageManager, 'typecheck');
      } else if (scripts['type-check']) {
        typecheckCommand = makeRunCmd(packageManager, 'type-check');
      }

      if (scripts.build) {
        buildCommand = makeRunCmd(packageManager, 'build');
      }
    } catch {
      // If package.json is unreadable, continue with defaults
    }
  }

  // --- Git info ---
  const defaultBranch = getDefaultBranch(repoPath);
  const hasGitRemote = hasRemote(repoPath);
  const canPush = hasGitRemote ? canPushToRemote(repoPath) : false;

  // --- Build result ---
  const durationMs = Date.now() - startTime;

  const projectInfo: ProjectInfo = {
    type,
    packageManager,
    testCommand,
    lintCommand,
    typecheckCommand,
    buildCommand,
    hasGitRemote,
    canPush,
    defaultBranch,
  };

  const result: PhaseResult = {
    phase: 'intake',
    success: true,
    costUsd: 0,
    durationMs,
  };

  return { result, projectInfo };
}

import { execSync, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function exec(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000 }).trim();
}

export function execSafe(cmd: string, cwd: string): { ok: boolean; stdout: string; stderr: string } {
  try {
    const stdout = execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000 }).trim();
    return { ok: true, stdout, stderr: '' };
  } catch (err: any) {
    return {
      ok: false,
      stdout: (err.stdout ?? '').toString().trim(),
      stderr: (err.stderr ?? '').toString().trim(),
    };
  }
}

export function isGitRepo(repoPath: string): boolean {
  return existsSync(join(repoPath, '.git'));
}

export function getDefaultBranch(repoPath: string): string {
  // Try to get remote default branch
  const symbolic = execSafe('git symbolic-ref refs/remotes/origin/HEAD', repoPath);
  if (symbolic.ok && symbolic.stdout) {
    // refs/remotes/origin/main -> main
    return symbolic.stdout.replace('refs/remotes/origin/', '');
  }

  // Try main
  const main = execSafe('git rev-parse --verify main', repoPath);
  if (main.ok) return 'main';

  // Try master
  const master = execSafe('git rev-parse --verify master', repoPath);
  if (master.ok) return 'master';

  return 'main';
}

export function hasRemote(repoPath: string): boolean {
  const result = execSafe('git remote', repoPath);
  return result.ok && result.stdout.length > 0;
}

export function canPushToRemote(repoPath: string): boolean {
  // Quick check: can we reach the remote?
  const result = execSafe('git ls-remote --exit-code origin HEAD', repoPath);
  return result.ok;
}

export function fetchOrigin(repoPath: string): void {
  execSafe('git fetch origin', repoPath);
}

export function createWorktree(
  repoPath: string,
  worktreePath: string,
  branchName: string,
  baseBranch: string,
  hasRemote: boolean,
): void {
  const base = hasRemote ? `origin/${baseBranch}` : baseBranch;
  execFileSync('git', ['worktree', 'add', '-b', branchName, worktreePath, base], {
    cwd: repoPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000,
  });
}

export function removeWorktree(repoPath: string, worktreePath: string): void {
  execSafe(`git worktree remove ${worktreePath} --force`, repoPath);
}

export function getDiff(cwd: string): string {
  // Stage everything first so new untracked files are included
  exec('git add -A', cwd);
  return exec('git diff --cached HEAD', cwd);
}

export function getDiffStat(cwd: string): string {
  exec('git add -A', cwd);
  return exec('git diff --cached HEAD --stat', cwd);
}

export function getChangedFiles(cwd: string): string[] {
  exec('git add -A', cwd);
  const result = execSafe('git diff --cached HEAD --name-only', cwd);
  if (!result.ok) return [];
  return result.stdout.split('\n').filter((f) => f.length > 0);
}

export function stageAll(cwd: string): void {
  exec('git add -A', cwd);
}

export function commit(cwd: string, message: string): void {
  execFileSync('git', ['commit', '--no-verify', '-m', message], { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
}

export function push(cwd: string, branchName: string): void {
  exec(`git push -u origin ${branchName}`, cwd);
}

export function getCurrentBranch(cwd: string): string {
  return exec('git rev-parse --abbrev-ref HEAD', cwd);
}

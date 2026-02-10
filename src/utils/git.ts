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

export function getBaselineCommit(cwd: string): string | null {
  // Try to find the baseline commit by message
  const result = execSafe('git log --all --grep="chore: baseline setup" --format=%H -1', cwd);
  if (result.ok && result.stdout) return result.stdout;

  // Fallback: find the merge-base with the first parent (the branch point)
  const mergeBase = execSafe('git rev-list --max-parents=0 HEAD', cwd);
  if (mergeBase.ok && mergeBase.stdout) {
    const firstCommit = mergeBase.stdout.split('\n')[0];
    return firstCommit;
  }
  return null;
}

export function getDiffFromBaseline(cwd: string): string {
  const baseline = getBaselineCommit(cwd);
  if (!baseline) return getDiff(cwd);
  // Stage any uncommitted changes so they're included
  exec('git add -A', cwd);
  // Diff from baseline to the current staged state (HEAD + staged)
  // Use --cached to include staged but uncommitted changes on top of committed ones
  const committed = execSafe(`git diff ${baseline} HEAD`, cwd);
  const staged = execSafe('git diff --cached HEAD', cwd);
  // If there are committed changes from baseline, return those
  if (committed.ok && committed.stdout.trim()) return committed.stdout;
  // Otherwise return staged changes (in case nothing was committed yet)
  if (staged.ok && staged.stdout.trim()) return staged.stdout;
  return '';
}

export function getDiffStatFromBaseline(cwd: string): string {
  const baseline = getBaselineCommit(cwd);
  if (!baseline) return getDiffStat(cwd);
  exec('git add -A', cwd);
  const result = execSafe(`git diff ${baseline} HEAD --stat`, cwd);
  if (result.ok && result.stdout.trim()) return result.stdout;
  return execSafe('git diff --cached HEAD --stat', cwd).stdout || '';
}

export function getChangedFilesFromBaseline(cwd: string): string[] {
  const baseline = getBaselineCommit(cwd);
  if (!baseline) return getChangedFiles(cwd);
  exec('git add -A', cwd);
  const result = execSafe(`git diff ${baseline} HEAD --name-only`, cwd);
  if (result.ok && result.stdout.trim()) {
    return result.stdout.split('\n').filter((f) => f.length > 0);
  }
  // Fallback to staged changes
  return getChangedFiles(cwd);
}

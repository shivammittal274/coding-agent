import type { PhaseName } from '../types.js';

const PHASE_COLORS: Record<string, string> = {
  intake: '\x1b[36m',     // cyan
  setup: '\x1b[34m',      // blue
  plan: '\x1b[33m',       // yellow
  'plan-review': '\x1b[35m', // magenta
  execute: '\x1b[32m',    // green
  'code-review': '\x1b[35m', // magenta
  test: '\x1b[31m',       // red
  'test-fix': '\x1b[31m', // red
  commit: '\x1b[32m',     // green
};

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

function timestamp(): string {
  return new Date().toISOString().slice(11, 19);
}

export const log = {
  phase(phase: PhaseName | string, message: string): void {
    const color = PHASE_COLORS[phase] || '\x1b[37m';
    const tag = phase.toUpperCase().padEnd(12);
    console.log(`${DIM}${timestamp()}${RESET} ${color}${BOLD}[${tag}]${RESET} ${message}`);
  },

  info(message: string): void {
    console.log(`${DIM}${timestamp()}${RESET} ${DIM}[INFO]${RESET}        ${message}`);
  },

  warn(message: string): void {
    console.log(`${DIM}${timestamp()}${RESET} \x1b[33m[WARN]${RESET}        ${message}`);
  },

  error(message: string): void {
    console.error(`${DIM}${timestamp()}${RESET} \x1b[31m${BOLD}[ERROR]${RESET}       ${message}`);
  },

  success(message: string): void {
    console.log(`${DIM}${timestamp()}${RESET} \x1b[32m${BOLD}[OK]${RESET}          ${message}`);
  },

  cost(label: string, costUsd: number): void {
    console.log(`${DIM}${timestamp()}${RESET} ${DIM}[COST]${RESET}        ${label}: $${costUsd.toFixed(4)}`);
  },

  divider(): void {
    console.log(`${DIM}${'─'.repeat(60)}${RESET}`);
  },
};

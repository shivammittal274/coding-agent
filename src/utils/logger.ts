import type { StageName } from '../types.js';

const STAGE_COLORS: Record<string, string> = {
  setup: '\x1b[34m',       // blue
  plan: '\x1b[33m',        // yellow
  implement: '\x1b[32m',   // green
  commit: '\x1b[36m',      // cyan
  simulator: '\x1b[35m',   // magenta
};

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

function timestamp(): string {
  return new Date().toISOString().slice(11, 19);
}

export const log = {
  stage(stage: StageName | string, message: string): void {
    const color = STAGE_COLORS[stage] || '\x1b[37m';
    const tag = stage.toUpperCase().padEnd(12);
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

  agent(role: string, message: string): void {
    const color = STAGE_COLORS[role] || DIM;
    console.log(`${DIM}${timestamp()}${RESET} ${color}  ${role}:${RESET} ${DIM}${message}${RESET}`);
  },

  divider(): void {
    console.log(`${DIM}${'─'.repeat(60)}${RESET}`);
  },
};

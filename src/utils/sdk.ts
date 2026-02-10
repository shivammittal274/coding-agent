import { query } from '@anthropic-ai/claude-code';
import type { AgentResult } from '../types.js';
import { log } from './logger.js';

export interface RunAgentOptions {
  prompt: string;
  model: string;
  cwd: string;
  maxTurns: number;
  allowedTools?: string[];
  resume?: string;
  appendSystemPrompt?: string;
  maxBudgetUsd?: number;
}

/** Cost accumulator shared across all SDK calls in a session */
let totalAccumulatedCost = 0;

export function getAccumulatedCost(): number {
  return totalAccumulatedCost;
}

export function resetAccumulatedCost(): void {
  totalAccumulatedCost = 0;
}

/**
 * Run a Claude Code agent session.
 * Streams messages, captures session ID + cost, returns result.
 * Supports per-phase budget enforcement via abortController.
 */
export async function runAgent(options: RunAgentOptions): Promise<AgentResult> {
  const {
    prompt,
    model,
    cwd,
    maxTurns,
    allowedTools,
    resume,
    appendSystemPrompt,
    maxBudgetUsd,
  } = options;

  const startTime = Date.now();
  let sessionId = '';
  let resultText = '';
  let costUsd = 0;

  const abortController = new AbortController();

  const stream = query({
    prompt,
    options: {
      model,
      cwd,
      maxTurns,
      permissionMode: 'bypassPermissions',
      abortController,
      ...(allowedTools && { allowedTools }),
      ...(resume && { resume }),
      ...(appendSystemPrompt && { appendSystemPrompt }),
    },
  });

  try {
    for await (const message of stream) {
      // Capture session ID from init
      if (message.type === 'system' && message.subtype === 'init') {
        sessionId = message.session_id;
      }

      // Capture result
      if (message.type === 'result') {
        costUsd = message.total_cost_usd;
        totalAccumulatedCost += costUsd;

        if (message.subtype === 'success') {
          resultText = message.result;
        } else {
          // error_max_turns or error_during_execution
          log.warn(`Agent ended with: ${message.subtype}`);
        }
      }

      // Per-phase budget enforcement: check accumulated cost mid-stream
      // We can't get exact mid-stream cost, but we can check total accumulated
      if (maxBudgetUsd && totalAccumulatedCost + costUsd > maxBudgetUsd) {
        log.warn(`Phase budget exceeded ($${maxBudgetUsd}), aborting agent`);
        abortController.abort();
        break;
      }
    }
  } catch (err: any) {
    // AbortError is expected when we abort the stream
    if (err?.name !== 'AbortError') {
      throw err;
    }
    log.warn('Agent aborted due to budget limit');
  }

  const durationMs = Date.now() - startTime;
  return { sessionId, costUsd, result: resultText, durationMs };
}

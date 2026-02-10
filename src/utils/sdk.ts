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

let totalAccumulatedCost = 0;

export function getAccumulatedCost(): number {
  return totalAccumulatedCost;
}

export function resetAccumulatedCost(): void {
  totalAccumulatedCost = 0;
}

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
      if (message.type === 'system' && message.subtype === 'init') {
        sessionId = message.session_id;
      }

      // Stream tool usage to give user visibility
      if (message.type === 'assistant' && message.message?.content) {
        for (const block of message.message.content) {
          if (block.type === 'tool_use') {
            const name = block.name;
            const input = block.input as Record<string, unknown>;
            // Show what the agent is doing
            if (name === 'Read' && input.file_path) {
              log.agent('agent', `reading ${input.file_path}`);
            } else if (name === 'Write' && input.file_path) {
              log.agent('agent', `writing ${input.file_path}`);
            } else if (name === 'Edit' && input.file_path) {
              log.agent('agent', `editing ${input.file_path}`);
            } else if (name === 'Bash' && input.command) {
              const cmd = String(input.command).slice(0, 80);
              log.agent('agent', `$ ${cmd}`);
            } else if (name === 'Glob' || name === 'Grep') {
              log.agent('agent', `searching (${name.toLowerCase()})`);
            }
          }
        }
      }

      if (message.type === 'result') {
        costUsd = message.total_cost_usd;
        totalAccumulatedCost += costUsd;

        if (message.subtype === 'success') {
          resultText = message.result;
        } else {
          log.warn(`Agent ended with: ${message.subtype}`);
        }
      }

      if (maxBudgetUsd && totalAccumulatedCost + costUsd > maxBudgetUsd) {
        log.warn(`Budget exceeded ($${maxBudgetUsd}), aborting agent`);
        abortController.abort();
        break;
      }
    }
  } catch (err: any) {
    if (err?.name !== 'AbortError') {
      throw err;
    }
    log.warn('Agent aborted due to budget limit');
  }

  const durationMs = Date.now() - startTime;
  return { sessionId, costUsd, result: resultText, durationMs };
}

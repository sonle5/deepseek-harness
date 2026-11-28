import { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import * as BashEnvPlugin from '@deepseek-ai/dsh-shell-env'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as ToolBash from '@deepseek-ai/dsh-tool-bash'
import * as ToolTodo from '@deepseek-ai/dsh-tool-todo'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek-api-key'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import DeepSeekAuth from '@deepseek-ai/dsh-deepseek-auth'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import ToolResultPruner from '@deepseek-ai/dsh-compaction-tool-result-pruner'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as SessionCheckpointPolicy from '@deepseek-ai/dsh-session-checkpoint-policy'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import type { BasicCompactionConfig } from '@deepseek-ai/dsh-compaction-basic'

/**
 * Shared harness for the headless-agent e2e suites: the full plugin stack
 * with a real model route and the real bash + todo_write tools. Lives
 * outside the *.e2e.ts pattern so importing it never re-registers another
 * file's tests.
 */

/** Provider route and model id the headless real-API suites create agents on. */
export interface E2eRoute {
  provider: string
  model: string
}

const OPENAI_COMPLETIONS_ROUTE = 'e2e-openai-completions'

function resolveE2eRoute(env: NodeJS.ProcessEnv): E2eRoute | undefined {
  const protocol = env.DSH_E2E_PROTOCOL || 'anthropic-messages'
  if (protocol === 'anthropic-messages') {
    return env.DEEPSEEK_API_KEY ? { provider: 'deepseek-official', model: env.DSH_E2E_MODEL || 'deepseek-v4-flash' } : undefined
  }
  if (protocol !== 'openai-completions') {
    throw new Error(`DSH_E2E_PROTOCOL must be anthropic-messages or openai-completions, got ${JSON.stringify(protocol)}`)
  }
  if (!env.DSH_E2E_API_KEY) return undefined
  if (!env.DSH_E2E_BASE_URL || !env.DSH_E2E_MODEL) {
    throw new Error('DSH_E2E_PROTOCOL=openai-completions requires DSH_E2E_BASE_URL and DSH_E2E_MODEL')
  }
  return { provider: OPENAI_COMPLETIONS_ROUTE, model: env.DSH_E2E_MODEL }
}

/**
 * The route these suites drive, or undefined when its key is absent so they
 * skip. `DSH_E2E_PROTOCOL=openai-completions` selects an llm-pi-ai Chat
 * Completions route at `DSH_E2E_BASE_URL` for `DSH_E2E_MODEL`, keyed by
 * `DSH_E2E_API_KEY`; otherwise the DeepSeek adapter runs `DSH_E2E_MODEL`
 * (default `deepseek-v4-flash`) with `DEEPSEEK_API_KEY`.
 */
export const e2eRoute: E2eRoute | undefined = resolveE2eRoute(process.env)

export const SYSTEM_PROMPT = 'You are a coding agent. Use bash for file operations '
  + 'with cat/grep/heredocs; check [exit code: N] markers, '
  + 'and report results briefly.'

/** System prompt for the todo_write e2e: nudges the model to plan with the tool. */
export const TODO_SYSTEM_PROMPT = 'You are a coding agent. For multi-step work, '
  + 'use the todo_write tool to track a task list: send the WHOLE list each call, '
  + 'mark every task being actively worked on in_progress (several at once when '
  + 'work runs in parallel, at least one while work remains), and mark a task '
  + 'completed as soon as it is done.'

/** Options for {@link codingHarness}. */
export interface CodingHarnessOptions {
  /**
   * Deployment persona prefix for the tree (the system-prompt plugin's `personaPrefix`
   * config — per-context, not per-agent). Omitted ⇒ no persona prefix section.
   */
  personaPrefix?: string
  /** Durable JSONL persistence root (the resume suite needs it; others stay file-free). */
  persistenceRoot?: string
  /**
   * Load {@link BasicCompactionEngine} with this config so the compaction e2e can
   * trigger compaction at a small, controlled history size. Omitted ⇒ no
   * compaction plugin (the default suites run without it).
   */
  compact?: BasicCompactionConfig
  /**
   * Test-only context capacity advertised for the {@link e2eRoute} model.
   * Automatic pressure scales the message budget left after the request's
   * reserved output tokens, so this capacity must exceed the advertised output cap.
   */
  modelContextWindow?: number
  /**
   * Test-only per-request output cap advertised for the {@link e2eRoute}
   * model, which the adapter forwards as its output-cap field and pressure
   * excludes from the capacity above.
   */
  modelMaxTokens?: number
}

async function mountModelRoute(ctx: Context, options: CodingHarnessOptions): Promise<void> {
  const sizing = {
    ...options.modelContextWindow === undefined ? {} : { contextWindow: options.modelContextWindow },
    ...options.modelMaxTokens === undefined ? {} : { maxTokens: options.modelMaxTokens },
  }
  if (e2eRoute?.provider === OPENAI_COMPLETIONS_ROUTE) {
    await ctx.plugin(LlmPiAi, {
      providers: {
        [OPENAI_COMPLETIONS_ROUTE]: {
          api: 'openai-completions',
          apiKeyEnv: 'DSH_E2E_API_KEY',
          baseURL: process.env.DSH_E2E_BASE_URL ?? null,
          models: [{ id: e2eRoute.model, ...sizing }],
        },
      },
    })
    return
  }
  await ctx.plugin(DeepSeekAuth)
  await ctx.plugin(LlmDeepSeek, Object.keys(sizing).length === 0 ? {} : { models: [{ id: e2eRoute?.model ?? 'deepseek-v4-flash', ...sizing }] })
}

export async function codingHarness(workdir: string, options: CodingHarnessOptions = {}): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx, {
    workingDirectory: true,
    systemPrompt: { personaPrefix: options.personaPrefix ?? '' },
  })
  await ctx.plugin(AgentLoop, { agents: [] })
  await mountModelRoute(ctx, options)
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(BashEnvPlugin)
  await ctx.plugin(LocalBashExecutor, { cwd: workdir, timeoutMs: 30_000 })
  await ctx.plugin(ToolBash)
  await ctx.plugin(ToolTodo, { allowParallelInProgress: true })
  // Compaction is opt-in: only the compaction e2e loads the reusable meter and backend.
  if (options.compact !== undefined) {
    await ctx.plugin(TokenMeter)
    await ctx.plugin(ToolResultPruner)
    await ctx.plugin(BasicCompactionEngine, options.compact)
  }
  // Durable JSONL persistence is opt-in: only the resume e2e needs it, and the
  // other suites stay file-free. Loaded last so a resume's deferred
  // `ctx.inject(['sessionPersistence'])` resolves once this is present.
  if (options.persistenceRoot !== undefined) {
    await ctx.plugin(JsonlSessionPersistence, { root: options.persistenceRoot })
    await ctx.plugin(SessionCheckpointPolicy)
  }
  return ctx
}

export function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

export function finalText(events: readonly SessionEvent[]): string {
  const message = events.findLast(event => event.type === 'assistant/message')
  if (message?.type !== 'assistant/message') return ''
  return message.data.message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

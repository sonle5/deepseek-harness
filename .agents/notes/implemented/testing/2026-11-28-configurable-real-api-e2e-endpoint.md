# Agent Note: Keyless skip and configurable endpoint for real-API e2e CI

Status: implemented

English | [中文](2026-11-28-configurable-real-api-e2e-endpoint.zh.md)

## Problem

The [real-API e2e workflow](2026-06-19-real-api-e2e-ci.md) failed every trusted run whose repository had no `DEEPSEEK_API_KEY_EXTERNAL` secret, and it pinned the DeepSeek Anthropic Messages endpoint, model and secret. A repository that tests against another provider, such as the OneNexus gateway at `https://catalog.onenexus.cloud/v1`, which serves only OpenAI Chat Completions, could neither turn the job green without a DeepSeek key nor point it at its own endpoint. The Python installed-wheel live test in [build-exe-for-python-sdk.yml](../../../../.github/workflows/build-exe-for-python-sdk.yml) had the same hard failure.

## Decision

A missing key skips the real-API steps visibly instead of failing the job. The preflight step in [e2e.yml](../../../../.github/workflows/e2e.yml) receives only whether a key exists, never its value. Without one it writes a `::notice::` and a step-summary line saying the real-API tests did not run, and the build and test steps are skipped through its `present` output. The job is not red, and its log and summary do not claim the suite passed. The Python live smoke has the same POSIX and Windows preflights, which skip the live step with a notice and summary line.

### Configuration

Repository variables select the endpoint:

- `DSH_E2E_PROTOCOL`: `anthropic-messages` (default) or `openai-completions`. Any other value fails the preflight.
- `DSH_E2E_BASE_URL`: default `https://api.deepseek.com/anthropic`.
- `DSH_E2E_MODEL`: required under `openai-completions`; under `anthropic-messages` it replaces `deepseek-v4-flash` in the headless suites and the Python live smoke.

The key is `secrets.DSH_E2E_API_KEY`, falling back to `DEEPSEEK_API_KEY_EXTERNAL`. Only the test step receives it, as `DSH_E2E_API_KEY`. Under `anthropic-messages` the step exports it as `DEEPSEEK_API_KEY` with `DEEPSEEK_BASE_URL`, so every DeepSeek suite runs as before.

### Protocol-neutral suites, not a rerouted suite

Under `openai-completions` the suite splits. The headless agent suites (full loop, coding task, todo_write, resume, compaction) read their route from [harness.ts](../../../../apps/cli/tests/profiles/headless/tests/harness.ts), which mounts an `llm-pi-ai` Chat Completions route at `DSH_E2E_BASE_URL` for `DSH_E2E_MODEL`, keyed by `DSH_E2E_API_KEY`. The DeepSeek-wire suites (the DeepSeek adapter, pi-ai DeepSeek parity, the subagent backends, web search and the loader smokes) see no `DEEPSEEK_API_KEY` and skip, because they assert DeepSeek model ids, reasoning fields or the Anthropic wire.

The Python live smoke stays on `anthropic-messages`: the SDK's DeepSeek route speaks Anthropic Messages. Under another protocol the preflight skips it with a notice naming the protocol.

## Alternatives considered

- **Route the whole suite through `llm-pi-ai` `openai-completions`.** Rejected: most suites assert DeepSeek-specific model ids, reasoning blocks, vision upload or Anthropic-wire behavior. Rerouting them would weaken those assertions into protocol-neutral ones and lose the DeepSeek coverage they exist for.
- **Keep the fail-loud preflight.** Rejected: a repository without a DeepSeek key would stay red on every trusted push. The notice and summary line keep the skip visible, which was the reason for failing loud.
- **Skip at the job level.** Rejected: a job skipped by a job-level `if:` reports success with no annotation, which hides that the tests did not run.

## Consequences

A keyless repository gets a green job whose annotation and summary say the real-API tests did not run, so required-check status alone no longer shows whether real requests were made. With a OneNexus key, only the five headless agent suites make real requests, and DeepSeek-wire coverage needs a DeepSeek key on `anthropic-messages`. Repositories that keep `DEEPSEEK_API_KEY_EXTERNAL` and set no variables behave as before.

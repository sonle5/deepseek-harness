# Agent Note: 真实 API e2e CI 的无密钥跳过与可配置端点

Status: implemented

[English](2026-11-28-configurable-real-api-e2e-endpoint.md) | 中文

## 问题

[真实 API e2e 工作流](2026-06-19-real-api-e2e-ci.zh.md)在仓库没有 `DEEPSEEK_API_KEY_EXTERNAL` secret 时会让每次可信运行失败，并且固定使用 DeepSeek Anthropic Messages 端点、模型和 secret。针对其他提供方测试的仓库（例如只提供 OpenAI Chat Completions 的 OneNexus 网关 `https://catalog.onenexus.cloud/v1`）既无法在没有 DeepSeek 密钥时让 job 变绿，也无法把它指向自己的端点。[build-exe-for-python-sdk.yml](../../../../.github/workflows/build-exe-for-python-sdk.yml) 中的 Python 安装后 wheel 真实 API 测试也有同样的硬失败。

## 决策

缺少密钥时可见地跳过真实 API 步骤，而不是让 job 失败。[e2e.yml](../../../../.github/workflows/e2e.yml) 中的 preflight 步骤只获知密钥是否存在，从不获得其值。没有密钥时，它写出一条 `::notice::` 和一行 step summary，说明真实 API 测试未运行，构建与测试步骤通过其 `present` 输出被跳过。job 不会变红，其日志和 summary 也不会声称套件已通过。Python 真实 API 冒烟测试有同样的 POSIX 与 Windows preflight，会以 notice 和 summary 行跳过真实 API 步骤。

### 配置

仓库变量选择端点：

- `DSH_E2E_PROTOCOL`：`anthropic-messages`（默认）或 `openai-completions`。其他值会让 preflight 失败。
- `DSH_E2E_BASE_URL`：`anthropic-messages` 下默认 `https://api.deepseek.com/anthropic`；`openai-completions` 下必填，因为该 DeepSeek URL 不是 Chat Completions 端点。
- `DSH_E2E_MODEL`：`openai-completions` 下必填；`anthropic-messages` 下它替换 headless 套件和 Python 真实 API 冒烟测试中的 `deepseek-v4-flash`。

密钥为 `secrets.DSH_E2E_API_KEY`，回退到 `DEEPSEEK_API_KEY_EXTERNAL`。只有测试步骤以 `DSH_E2E_API_KEY` 接收它。`anthropic-messages` 下该步骤把它连同 `DEEPSEEK_BASE_URL` 导出为 `DEEPSEEK_API_KEY`，因此每个 DeepSeek 套件照旧运行。

### 协议无关套件，而非重新路由整个套件

`openai-completions` 下套件分为两部分。headless agent 套件（full loop、coding task、todo_write、resume、compaction）从 [harness.ts](../../../../apps/cli/tests/profiles/headless/tests/harness.ts) 读取路由，它在 `DSH_E2E_BASE_URL` 上为 `DSH_E2E_MODEL` 挂载一条 `llm-pi-ai` Chat Completions 路由，以 `DSH_E2E_API_KEY` 作为密钥。DeepSeek 线协议套件（DeepSeek 适配器、pi-ai DeepSeek 一致性、subagent 后端、web search 和 loader 冒烟测试）看不到 `DEEPSEEK_API_KEY` 而跳过，因为它们断言 DeepSeek 模型 id、推理字段或 Anthropic 线协议。

Python 真实 API 冒烟测试保持在 `anthropic-messages` 上：SDK 的 DeepSeek 路由使用 Anthropic Messages。在其他协议下，preflight 以注明该协议的 notice 跳过它。

## 备选方案

- **通过 `llm-pi-ai` `openai-completions` 路由整个套件。** 已否决：大多数套件断言 DeepSeek 特有的模型 id、推理块、图像上传或 Anthropic 线协议行为。重新路由会把这些断言削弱为协议无关断言，并失去它们本应提供的 DeepSeek 覆盖。
- **保留明确失败的 preflight。** 已否决：没有 DeepSeek 密钥的仓库会在每次可信 push 上保持红色。notice 和 summary 行让跳过保持可见，而这正是明确失败的理由。
- **在 job 级别跳过。** 已否决：被 job 级 `if:` 跳过的 job 报告成功且没有注解，会隐藏测试未运行这一事实。

## 后果

无密钥仓库得到一个绿色 job，其注解和 summary 说明真实 API 测试未运行，因此仅凭必需检查状态已无法看出是否发出了真实请求。使用 OneNexus 密钥时，只有五个 headless agent 套件发出真实请求；DeepSeek 线协议覆盖需要在 `anthropic-messages` 上使用 DeepSeek 密钥。保留 `DEEPSEEK_API_KEY_EXTERNAL` 且不设置变量的仓库行为不变。

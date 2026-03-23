# Repository Guidelines

- Repo: https://github.com/alchemistprime/tiny-D
- AlphaSentry is an AI agent for deep financial research, built with TypeScript, LangChain JS, and LangGraph.
- Forked from virattt/dexter (upstream remote is fetch-only, no intent to contribute back).

## Project Structure

- Source code: `src/`
  - Agent core: `src/agent/` (agent loop, prompts, scratchpad, run context, token counting, tool executor, channel profiles, types)
  - CLI interface: `src/cli.ts` (Ink/React), entry point: `src/index.tsx`
  - Components: `src/components/` (Ink UI components: answer box, approval prompt, chat log, debug panel, intro, tool events, working indicator)
  - Controllers: `src/controllers/` (agent runner, model selection, input history — CLI-specific orchestration)
  - Model/LLM: `src/model/llm.ts` (multi-provider LLM abstraction with retry logic)
  - Provider registry: `src/providers.ts` (canonical provider definitions, prefix-based routing)
  - Tools: `src/tools/` (financial search, web search, browser, filesystem, heartbeat, memory, skill tool)
    - Tool registry: `src/tools/registry.ts` (conditional registration based on env vars)
    - Finance tools: `src/tools/finance/` (stock price, fundamentals, earnings, estimates, filings, read-filings, financial-search, financial-metrics, insider trades, key ratios, news, segments, crypto, historical prices, FMP)
    - Search tools: `src/tools/search/` (Exa preferred → Perplexity → Tavily fallback; X/Twitter search)
    - Browser: `src/tools/browser/` (Playwright-based web scraping)
    - Fetch: `src/tools/fetch/` (web-fetch tool for reading URLs)
    - Filesystem: `src/tools/filesystem/` (read-file, write-file, edit-file tools)
    - Heartbeat: `src/tools/heartbeat/` (periodic heartbeat checker tool)
    - Memory tools: `src/tools/memory/` (memory-search, memory-get, memory-update)
  - Skills: `src/skills/` (SKILL.md-based extensible workflows: DCF valuation, X research)
  - Memory: `src/memory/` (persistent memory system with chunking, embedding, indexing, search, flush)
  - Storage: `src/storage/` (LibSQL/Turso persistence for web sessions: libsql.ts, web-chat-store.ts)
  - LangGraph: `src/langgraph/dexter-graph.ts` (LangGraph StateGraph wrapper for LangSmith deployment)
  - Gateway: `src/gateway/` (WhatsApp channel via Baileys, session management, heartbeat scheduler, access control, group chat, routing)
  - Utils: `src/utils/` (env, config, caching, token estimation, markdown tables, errors, AI message helpers, history context, logger, paths, progress channel)
  - Evals: `src/evals/` (LangSmith evaluation runner with Ink UI)
- Web frontend: `web/` (Next.js app on Vercel — pure proxy to LangSmith deployment, NOT a local agent runner)
- Config: `.alphasentry/settings.json` (persisted model/provider selection)
- Memory: `.alphasentry/memory/` (persistent agent memory files)
- Heartbeat: `.alphasentry/HEARTBEAT.md` (user-configurable heartbeat checklist)
- Environment: `.env` (API keys; see below)
- LangGraph config: `langgraph.json` (graph_id: "alphasentry", exports dexter-graph.ts:app)
- Scripts: `scripts/release.sh`
- Identity: `SOUL.md` (agent personality/investing philosophy, loaded into system prompt)

## Architecture Overview

AlphaSentry has three deployment surfaces sharing the same agent core (`src/agent/`):

1. **CLI** (`bun run start`): Ink/React terminal UI. Runs agent in-process. Uses `src/controllers/` for model selection and input history.
2. **LangSmith Deployment**: LangGraph (`src/langgraph/dexter-graph.ts`) deployed to LangSmith, auto-deploys from `main` branch. Graph ID: `alphasentry`. Reads `DEXTER_MODEL`, `DEXTER_MODEL_PROVIDER`, `DEXTER_MAX_ITERATIONS` env vars.
3. **Web App** (`web/`): Next.js on Vercel. Route handler (`web/app/api/chat/route.ts`) is a pure SSE proxy — forwards requests to the LangSmith deployment URL and streams responses back. Does NOT run the agent locally.

Additionally, the **Gateway** (`src/gateway/`) provides a WhatsApp channel via Baileys with session management, access control, heartbeat scheduling, and group chat support.

## Build, Test, and Development Commands

- Runtime: Bun (primary). Use `bun` for all commands.
- Install deps: `bun install`
- Run CLI: `bun run start` or `bun run src/index.tsx`
- Dev (watch mode): `bun run dev`
- Gateway: `bun run gateway` (WhatsApp channel)
- Type-check: `bun run typecheck`
- Tests: `bun test`
- Evals: `bun run src/evals/run.ts` (full) or `bun run src/evals/run.ts --sample 10` (sampled)
- Web app: `cd web && bun run dev` (Next.js dev server)
- CI runs `bun run typecheck` and `bun test` on push/PR to main.

## Coding Style & Conventions

- Language: TypeScript (ESM, strict mode). JSX via React (Ink for CLI rendering).
- Path aliases: `@/*` maps to `./src/*` (configured in tsconfig.json).
- Prefer strict typing; avoid `any`.
- Keep files concise; extract helpers rather than duplicating code.
- Add brief comments for tricky or non-obvious logic.
- Do not add logging unless explicitly asked.
- Do not create README or documentation files unless explicitly asked.

## LLM Providers

- Canonical registry: `src/providers.ts` — single source of truth for all provider metadata.
- Supported: OpenAI (default), Anthropic, Google, xAI (Grok), Moonshot (Kimi), DeepSeek, OpenRouter, Ollama (local).
- Default model: `gpt-5.4`. Provider detection is prefix-based (`claude-` → Anthropic, `gemini-` → Google, `grok-` → xAI, `kimi-` → Moonshot, `deepseek-` → DeepSeek, `openrouter:` → OpenRouter, `ollama:` → Ollama).
- Each provider has a `fastModel` for lightweight tasks (summarization, memory flush).
- Anthropic uses explicit `cache_control` on system prompt for prompt caching cost savings (~90% reduction).
- Model factories: `src/model/llm.ts` — keyed by provider ID from `src/providers.ts`.
- Users switch providers/models via `/model` command in the CLI.

## Tools

- `financial_search`: primary tool for all financial data queries (prices, metrics, filings, earnings, estimates, insider trades, news, segments, crypto). Delegates to multiple sub-tools internally.
- `financial_metrics`: direct metric lookups (revenue, market cap, etc.).
- `read_filings`: SEC filing reader for 10-K, 10-Q, 8-K documents.
- `web_search`: general web search (Exa if `EXASEARCH_API_KEY` → Perplexity if `PERPLEXITY_API_KEY` → Tavily if `TAVILY_API_KEY`).
- `x_search`: X/Twitter search for real-time sentiment, news, expert opinions (requires `X_BEARER_TOKEN`). Commands: search, profile, thread.
- `web_fetch`: fetch and read web page content.
- `browser`: Playwright-based web scraping for JavaScript-rendered pages.
- `read_file`, `write_file`, `edit_file`: filesystem operations.
- `heartbeat`: view/update the periodic heartbeat checklist.
- `memory_search`, `memory_get`, `memory_update`: persistent memory operations.
- `skill`: invokes SKILL.md-defined workflows (e.g., DCF valuation, X research). Each skill runs at most once per query.
- Tool registry: `src/tools/registry.ts`. Tools are conditionally included based on env vars at startup. Rich descriptions are injected into the system prompt.

## Skills

- Skills live as `SKILL.md` files with YAML frontmatter (`name`, `description`) and markdown body (instructions).
- Built-in skills: `src/skills/dcf/SKILL.md` (DCF valuation), `src/skills/x-research/` (X/Twitter research).
- Discovery: `src/skills/registry.ts` scans for SKILL.md files at startup.
- Skills are exposed to the LLM as metadata in the system prompt; the LLM invokes them via the `skill` tool.

## Agent Architecture

- Agent loop: `src/agent/agent.ts`. Iterative tool-calling loop with configurable max iterations (default 10).
- Run context: `src/agent/run-context.ts`. Per-run state (scratchpad, token counter, iteration count).
- Scratchpad: `src/agent/scratchpad.ts`. Single source of truth for all tool results within a query.
- Tool executor: `src/agent/tool-executor.ts`. Handles tool approval, denied tools, and execution.
- Context management: Anthropic-style. Full tool results kept in context; oldest results cleared when token threshold exceeded.
- Memory flush: `src/memory/flush.ts`. Before context clearing, optionally flushes accumulated data to persistent memory files.
- Final answer: when the LLM responds without tool calls, that response becomes the answer (no separate "final answer" LLM call).
- Events: agent yields typed events (`tool_start`, `tool_end`, `thinking`, `context_cleared`, `memory_flush`, `tool_denied`, `done`, etc.) for real-time UI updates.
- Channel profiles: `src/agent/channels.ts`. Different response formatting for CLI vs WhatsApp vs web.

## Memory System

- Persistent memory stored as Markdown files in `.alphasentry/memory/`.
- Components: chunker, embeddings, indexer, search, store, database, flush.
- Agent can search, get, and update memories via dedicated tools.
- Memory flush runs automatically when context threshold is exceeded (once per query).

## Environment Variables

- LLM keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `XAI_API_KEY` (Grok LLM), `OPENROUTER_API_KEY`, `MOONSHOT_API_KEY`, `DEEPSEEK_API_KEY`
- Ollama: `OLLAMA_BASE_URL` (default `http://127.0.0.1:11434`)
- Finance: `FINANCIAL_DATASETS_API_KEY`
- Search: `EXASEARCH_API_KEY` (preferred), `PERPLEXITY_API_KEY` (second), `TAVILY_API_KEY` (fallback)
- X/Twitter: `X_BEARER_TOKEN` (for x_search tool — NOT the same as XAI_API_KEY)
- Storage: `LIBSQL_URL` (Turso/LibSQL for web session persistence)
- Tracing: `LANGSMITH_API_KEY`, `LANGSMITH_ENDPOINT`, `LANGSMITH_PROJECT`, `LANGSMITH_TRACING`
- LangSmith deployment: `DEXTER_MODEL`, `DEXTER_MODEL_PROVIDER`, `DEXTER_MAX_ITERATIONS` (read by dexter-graph.ts only)
- Web app: `LANGSMITH_DEPLOYMENT_URL`, `LANGSMITH_API_KEY` (in `web/.env`)
- Never commit `.env` files or real API keys.

## Internal Naming Note

- Some internal function names retain "dexter" (e.g., `dexterPath()`, `getDexterDir()` in `src/utils/paths.ts`) to avoid massive import churn. They resolve to `.alphasentry/` via the `DEXTER_DIR` constant.
- The LangGraph file is `src/langgraph/dexter-graph.ts` — cosmetic, functional name doesn't matter.
- All user-facing, prompt-facing, and identity references say "AlphaSentry".

## Version & Release

- Version format: CalVer `YYYY.M.D` (no zero-padding). Tag prefix: `v`.
- Release script: `bash scripts/release.sh [version]` (defaults to today's date).
- Release flow: bump version in `package.json`, create git tag, push tag, create GitHub release via `gh`.
- Do not push or publish without user confirmation.

## Testing

- Framework: Bun's built-in test runner (primary), Jest config exists for legacy compatibility.
- Tests colocated as `*.test.ts`.
- Run `bun test` before pushing when you touch logic.

## Security

- API keys stored in `.env` (gitignored). Users can also enter keys interactively via the CLI.
- Config stored in `.alphasentry/settings.json` (gitignored).
- Never commit or expose real API keys, tokens, or credentials.

## SDK & Framework References

- This codebase uses LangChain JS/TS SDK. Always refer to official LangChain JS documentation for SDK patterns.
- Key packages: `@langchain/core`, `@langchain/openai`, `@langchain/anthropic`, `@langchain/google-genai`, `@langchain/ollama`, `@langchain/langgraph`, `@langchain/exa`, `@langchain/tavily`
- Use `DynamicStructuredTool` with Zod schemas for tool definitions (not deprecated `DynamicTool`).
- Use `ChatPromptTemplate.fromMessages()` for prompt construction (except Anthropic which uses raw messages with `cache_control`).
- Use `StructuredToolInterface` for tool type annotations.
- Prefer SDK patterns over custom implementations when the SDK provides the functionality.

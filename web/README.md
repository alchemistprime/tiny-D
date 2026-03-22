# AlphaSentry Web

Production web interface for AlphaSentry. Built with Next.js 15, Tailwind CSS, and the Vercel AI SDK. Deployed on Vercel.

**This is the production frontend only.** It does not run the agent directly — it proxies requests to a LangSmith Deployment that hosts the AlphaSentry LangGraph agent. For local agent development and testing, use the CLI (`bun start` from the repo root).

## Architecture

```
Browser (Vercel)
    │
    ▼
/api/chat (Next.js route — SSE proxy)
    │
    ▼
LangSmith Deployment (LANGSMITH_DEPLOYMENT_URL)
    │
    ▼
LangGraph (src/langgraph/dexter-graph.ts)
    │
    ▼
Agent (src/agent/agent.ts) → Tools → Answer
    │
    ▼
LibSQL/Turso (session persistence, optional)
```

### How It Works

1. The web UI (`page.tsx`) sends chat messages to `/api/chat`
2. The API route (`route.ts`) forwards the query to the LangSmith Deployment via `POST /runs/stream`
3. LangSmith runs the compiled LangGraph, which instantiates the Agent, executes tools, and returns an answer
4. The route relays the SSE stream back to the browser in Vercel AI SDK format
5. Session history is persisted to Turso/LibSQL if `LIBSQL_URL` is configured on the LangSmith side

The route requires `LANGSMITH_DEPLOYMENT_URL` and `LANGSMITH_API_KEY`. Without them, it returns a 500 error.

## File Structure

```
web/
├── app/
│   ├── api/
│   │   ├── chat/route.ts    # SSE proxy to LangSmith Deployment
│   │   └── health/route.ts  # Health check endpoint
│   ├── globals.css          # Tailwind + brand theme (dark mode, red accent)
│   ├── layout.tsx           # Root layout with metadata
│   └── page.tsx             # Chat UI — messages, tool status, streaming, markdown
├── public/
│   └── logo.png             # AlphaSentry logo
├── next.config.ts           # Webpack aliases to resolve parent src/ imports
├── tailwind.config.ts       # Brand colors (red, black, grays)
├── package.json
├── vercel.json              # Standalone Vercel config
└── tsconfig.json
```

## API

### `POST /api/chat`

SSE proxy endpoint. Forwards queries to the LangSmith Deployment and relays streamed responses.

**Request body:**

```json
{
  "messages": [
    { "role": "user", "content": "What is AAPL's P/E ratio?" }
  ],
  "memory": { "thread": "optional-session-id" }
}
```

**Response:** Server-Sent Events stream.

| Event | Description |
|-------|-------------|
| `start` | Message stream begins |
| `text-start` | Text content begins |
| `text-delta` | Streamed answer chunk |
| `text-end` | Text content complete |
| `finish-step` | Processing step complete |
| `finish` | Stream complete |
| `error` | Something went wrong |

**Session continuity:** Pass `memory.thread` with a consistent session ID to maintain conversation history across messages.

## Local Development

**The web app is not designed for local agent testing.** Use the CLI instead:

```bash
# From repo root — install deps and run the CLI agent
bun install
bun start
```

The CLI runs the same agent, same tools, same SOUL.md identity — just in a terminal UI instead of a browser. This is the primary development workflow.

### Running the web UI locally (optional)

If you need to work on the frontend (styling, layout, UI behavior), you can run the Next.js dev server. It will still proxy to your LangSmith Deployment, so you need those env vars set:

```bash
# From repo root
bun install && cd web && bun install

# Ensure .env has LANGSMITH_DEPLOYMENT_URL and LANGSMITH_API_KEY set
cd web && bun run dev
```

Opens at http://localhost:3000. The agent runs remotely via LangSmith — only the UI is local.

## Deployment (Vercel)

Deploys from the repo root. CI/CD pushes to Vercel automatically.

**Root-level Vercel config:**

```json
{
  "buildCommand": "cd web && bun run build",
  "installCommand": "bun install && cd web && bun install",
  "outputDirectory": "web/.next",
  "framework": "nextjs"
}
```

### Required Environment Variables

Set these in the Vercel project dashboard:

| Variable | Required | Description |
|----------|----------|-------------|
| `LANGSMITH_DEPLOYMENT_URL` | **Yes** | LangSmith Deployment base URL |
| `LANGSMITH_API_KEY` | **Yes** | LangSmith API key for deployment access |

These are the only env vars the web app itself needs. All agent-related keys (`OPENAI_API_KEY`, `FINANCIAL_DATASETS_API_KEY`, etc.) are configured on the LangSmith Deployment side, not in Vercel.

### Vercel Notes

- `export const runtime = 'nodejs'` and `export const maxDuration = 300` (5 min timeout for agent tool-calling loops)
- `export const dynamic = 'force-dynamic'` prevents static generation of the API route
- 401 errors on `GET /` and `/favicon.ico` in Vercel logs are from Vercel's password protection, not a code issue

## Agent Tools

The agent (running on LangSmith) has access to these tools:

| Tool | Description |
|------|-------------|
| `financial_search` | Primary financial data tool — prices, metrics, filings, earnings (routes to sub-tools internally) |
| `financial_metrics` | Direct metric lookups (revenue, market cap, P/E, etc.) |
| `read_filings` | SEC filing reader for 10-K, 10-Q, 8-K documents |
| `web_search` | General web search (Exa, Perplexity, or Tavily depending on API keys) |
| `web_fetch` | Fetch and summarize web page content |
| `browser` | Playwright-based browser for JavaScript-rendered pages |
| `x_search` | X/Twitter sentiment search (requires `X_BEARER_TOKEN`) |
| `heartbeat` | Manage periodic monitoring checklist |
| `memory_search` / `memory_get` / `memory_update` | Persistent memory read/write |
| `skill` | Invoke SKILL.md workflows (e.g., DCF valuation, X-Research) |

## Frontend Details

### Chat UI (`page.tsx`)

Single-page chat interface with:

- **Message history** — user and assistant messages with markdown rendering (react-markdown + remark-gfm)
- **Tool status indicators** — real-time display of tool invocations with friendly labels ("Money Hunt", "Filing Finder", etc.)
- **Thinking animations** — rotating verbs ("Analyzing...", "Correlating...", "Synthesizing...") while the agent works
- **Composing indicator** — shown after tools complete but before text streams
- **Suggested queries** — starter prompts on empty state
- **Session management** — "New Chat" button resets session; session ID persists in localStorage
- **Streaming cursor** — red pulsing cursor during text generation
- **Abort support** — AbortController on fetch for cancellation

### Theming

Brand palette defined in `globals.css` and `tailwind.config.ts`:

- Background: `#0a0a0a` (near-black)
- Accent: `#ff0000` (red)
- Font: Inter
- Financial tables: monospaced numeric columns, right-aligned, alternating row backgrounds
- Custom scrollbar, tool spinners, and dot-pulse animations

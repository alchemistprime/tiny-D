import { Agent } from '@dexter/agent/agent.js';
import { InMemoryChatHistory } from '@dexter/utils/in-memory-chat-history.js';
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from '@dexter/model/llm.js';
import { appendSessionMessage, loadSessionMessages } from '@dexter/storage/web-chat-store.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type IncomingMessage = {
  role?: string;
  content?: string;
  parts?: Array<{ type: string; text?: string }>;
};

function extractUserText(messages: IncomingMessage[]): string {
  const lastUser = [...messages].reverse().find((message) => message.role === 'user');
  if (!lastUser) return '';
  if (typeof lastUser.content === 'string') return lastUser.content;
  if (Array.isArray(lastUser.parts)) {
    return lastUser.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text ?? '')
      .join('');
  }
  return '';
}

type ToolCallRecord = { tool: string; id: string };

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const messages = Array.isArray(body?.messages) ? (body.messages as IncomingMessage[]) : [];
  const memory = body?.memory as { thread?: string; resource?: string } | undefined;

  const query = extractUserText(messages).trim();
  if (!query) {
    return new Response(JSON.stringify({ error: 'Missing user query.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const modelProvider = process.env.DEXTER_MODEL_PROVIDER ?? DEFAULT_PROVIDER;
  const model = process.env.DEXTER_MODEL ?? DEFAULT_MODEL;
  const sessionKey = memory?.thread || `web-${crypto.randomUUID()}`;

  const deploymentUrl = process.env.LANGSMITH_DEPLOYMENT_URL;
  const langsmithApiKey = process.env.LANGSMITH_API_KEY;

  const encoder = new TextEncoder();
  const toolCalls: ToolCallRecord[] = [];
  let toolCounter = 0;
  const messageId = crypto.randomUUID();
  const textId = crypto.randomUUID();

  const stream = new ReadableStream({
    start(controller) {
      const send = createSseSender(controller, encoder);
      send({ type: 'start', messageId });
      send({ type: 'start-step' });

      const run = async () => {
        try {
          if (deploymentUrl && langsmithApiKey) {
            await streamFromLangSmith({
              send,
              query,
              sessionKey,
              deploymentUrl,
              apiKey: langsmithApiKey,
              textId,
            });
            return;
          }

          const history = new InMemoryChatHistory(model);
          const stored = await loadSessionMessages(sessionKey);
          if (stored.length > 0) {
            history.loadMessages(stored);
          }

          history.saveUserQuery(query);

          const agent = await Agent.create({
            model,
            modelProvider,
            maxIterations: 10,
          });

          let finalAnswer = '';
          for await (const event of agent.run(query, history)) {
            switch (event.type) {
              case 'tool_start': {
                const toolId = `tool-${++toolCounter}`;
                toolCalls.push({ tool: event.tool, id: toolId });
                send({
                  type: 'tool-input-available',
                  toolCallId: toolId,
                  toolName: event.tool,
                  input: event.args,
                });
                break;
              }
              case 'tool_end': {
                const idx = toolCalls.findIndex((entry) => entry.tool === event.tool);
                const toolId = idx >= 0 ? toolCalls.splice(idx, 1)[0]!.id : `tool-${++toolCounter}`;
                send({
                  type: 'tool-output-available',
                  toolCallId: toolId,
                  output: event.result,
                });
                break;
              }
              case 'tool_error': {
                const idx = toolCalls.findIndex((entry) => entry.tool === event.tool);
                const toolId = idx >= 0 ? toolCalls.splice(idx, 1)[0]!.id : `tool-${++toolCounter}`;
                send({
                  type: 'tool-output-available',
                  toolCallId: toolId,
                  output: `Error: ${event.error}`,
                });
                break;
              }
              case 'done': {
                finalAnswer = event.answer || '';
                send({ type: 'text-start', id: textId });
                send({ type: 'text-delta', id: textId, delta: finalAnswer });
                send({ type: 'text-end', id: textId });
                send({ type: 'finish-step' });
                send({ type: 'finish', finishReason: 'stop' });
                break;
              }
              default:
                break;
            }
          }

          if (finalAnswer) {
            await history.saveAnswer(finalAnswer);
            const last = history.getMessages().slice(-1)[0];
            if (last?.answer) {
              await appendSessionMessage(sessionKey, {
                query: last.query,
                answer: last.answer,
                summary: last.summary,
              });
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          send({ type: 'error', errorText: message });
        } finally {
          controller.close();
        }
      };

      void run();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

function createSseSender(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder
): (chunk: Record<string, unknown>) => void {
  return (chunk) => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
  };
}

async function streamFromLangSmith(args: {
  send: (chunk: Record<string, unknown>) => void;
  query: string;
  sessionKey: string;
  deploymentUrl: string;
  apiKey: string;
  textId: string;
}) {
  const { send, query, sessionKey, deploymentUrl, apiKey, textId } = args;

  const apiUrl = deploymentUrl.replace(/\/+$/, '');
  const res = await fetch(`${apiUrl}/runs/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'x-session-id': sessionKey,
    },
    body: JSON.stringify({
      assistant_id: 'dexter',
      input: {
        messages: [
          {
            role: 'human',
            content: query,
          },
        ],
      },
      stream_mode: ['messages-tuple'],
      config: {
        configurable: {
          'x-session-id': sessionKey,
          session_id: sessionKey,
        },
      },
    }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => 'Unknown error');
    send({ type: 'error', errorText: text });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent: string | null = null;

  let started = false;
  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: true });
    }
    if (done) {
      buffer += decoder.decode();
    }

    const lines = buffer.split('\n');
    buffer = done ? '' : (lines.pop() || '');

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (!line) {
        currentEvent = null;
        continue;
      }
      if (line.startsWith('event:')) {
        currentEvent = line.slice(6).trim();
        continue;
      }
      if (!line.startsWith('data:')) continue;

      const dataText = line.slice(5).trim();
      if (!dataText) continue;

      try {
        const payload = JSON.parse(dataText);
        if (currentEvent === 'messages' || currentEvent === 'messages/partial') {
          const messageChunk = Array.isArray(payload) ? payload[0] : payload?.[0];
          const delta = messageChunk?.content ?? messageChunk?.text ?? '';
          if (delta) {
            if (!started) {
              send({ type: 'text-start', id: textId });
              started = true;
            }
            send({ type: 'text-delta', id: textId, delta });
          }
        }
      } catch {
        // ignore parsing errors
      }
    }

    if (done) break;
  }

  if (started) {
    send({ type: 'text-end', id: textId });
  }
  send({ type: 'finish-step' });
  send({ type: 'finish', finishReason: 'stop' });
  controller.close();
}

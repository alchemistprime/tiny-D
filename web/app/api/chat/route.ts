import { runAgentForMessage } from '../../../../src/gateway/agent-runner.js';
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from '../../../../src/model/llm.js';
import type { AgentEvent } from '../../../../src/agent/types.js';

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

  const encoder = new TextEncoder();
  const toolCalls: ToolCallRecord[] = [];
  let toolCounter = 0;
  const messageId = crypto.randomUUID();
  const textId = crypto.randomUUID();

  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      };

      send({ type: 'start', messageId });
      send({ type: 'start-step' });

      const run = async () => {
        try {
          await runAgentForMessage({
            sessionKey,
            query,
            model,
            modelProvider,
            maxIterations: 10,
            onEvent: async (event: AgentEvent) => {
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
                  send({ type: 'text-start', id: textId });
                  send({ type: 'text-delta', id: textId, delta: event.answer || '' });
                  send({ type: 'text-end', id: textId });
                  send({ type: 'finish-step' });
                  send({ type: 'finish', finishReason: 'stop' });
                  break;
                }
                default:
                  break;
              }
            },
          });
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

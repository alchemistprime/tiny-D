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

  const sessionKey = memory?.thread || `web-${crypto.randomUUID()}`;

  const deploymentUrl = process.env.LANGSMITH_DEPLOYMENT_URL;
  const langsmithApiKey = process.env.LANGSMITH_API_KEY;

  if (!deploymentUrl || !langsmithApiKey) {
    return new Response(
      JSON.stringify({
        error: 'Missing LANGSMITH_DEPLOYMENT_URL or LANGSMITH_API_KEY in web environment.',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const encoder = new TextEncoder();
  const messageId = crypto.randomUUID();
  const textId = crypto.randomUUID();

  const stream = new ReadableStream({
    start(controller) {
      const send = createSseSender(controller, encoder);
      send({ type: 'start', messageId });
      send({ type: 'start-step' });

      const run = async () => {
        try {
          await streamFromLangSmith({
            send,
            query,
            sessionKey,
            deploymentUrl,
            apiKey: langsmithApiKey,
            textId,
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
  const extractText = (chunk: unknown): string => {
    if (!chunk || typeof chunk !== 'object') return '';
    const candidate = chunk as { content?: unknown; text?: unknown };
    if (typeof candidate.text === 'string') return candidate.text;
    if (typeof candidate.content === 'string') return candidate.content;
    if (Array.isArray(candidate.content)) {
      return candidate.content
        .map((part) =>
          part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
            ? ((part as { text: string }).text ?? '')
            : ''
        )
        .join('');
    }
    return '';
  };
  const isFinalGraphMessage = (chunk: unknown): boolean => {
    if (!chunk || typeof chunk !== 'object') return false;
    const id = (chunk as { id?: unknown }).id;
    return typeof id === 'string' && id.startsWith('run-');
  };

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
  let sawPartial = false;
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
        if (currentEvent === 'messages/partial') {
          sawPartial = true;
          const messageChunk = Array.isArray(payload) ? payload[0] : payload?.[0];
          if (!isFinalGraphMessage(messageChunk)) continue;
          const delta = extractText(messageChunk);
          if (!delta) continue;
          if (!started) {
            send({ type: 'text-start', id: textId });
            started = true;
          }
          send({ type: 'text-delta', id: textId, delta });
          continue;
        }

        if (currentEvent === 'messages' && !sawPartial) {
          const messageChunk = Array.isArray(payload) ? payload[0] : payload?.[0];
          if (!isFinalGraphMessage(messageChunk)) continue;
          const delta = extractText(messageChunk);
          if (!delta) continue;
          if (!started) {
            send({ type: 'text-start', id: textId });
            started = true;
          }
          send({ type: 'text-delta', id: textId, delta });
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
}

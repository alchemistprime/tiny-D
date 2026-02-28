import { AIMessage, BaseMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { Annotation, StateGraph, START, END, messagesStateReducer } from '@langchain/langgraph';
import { Agent } from '../agent/agent.js';
import { InMemoryChatHistory } from '../utils/in-memory-chat-history.js';
import { appendSessionMessage, loadSessionMessages } from '../storage/web-chat-store.js';

const State = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  input: Annotation<string>(),
  session_id: Annotation<string | undefined>(),
  result: Annotation<string>(),
});

type GraphState = typeof State.State;

function resolveQuery(state: GraphState): string {
  const messages = state.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message) continue;
    const type = typeof message.getType === 'function' ? message.getType() : '';
    if (type === 'human' || type === 'user') {
      return message.content?.toString() ?? '';
    }
  }

  if (typeof state.input === 'string') {
    return state.input;
  }

  return '';
}

function resolveSessionId(state: GraphState, config?: RunnableConfig): string | undefined {
  const configurable = config?.configurable as Record<string, unknown> | undefined;
  const headerSession = configurable?.['x-session-id'];
  if (typeof headerSession === 'string' && headerSession.trim()) {
    return headerSession.trim();
  }

  if (typeof state.session_id === 'string' && state.session_id.trim()) {
    return state.session_id.trim();
  }

  return undefined;
}

async function runDexter(state: GraphState, config?: RunnableConfig): Promise<Partial<GraphState>> {
  const query = resolveQuery(state).trim();
  if (!query) {
    return {
      result: 'No input provided.',
      messages: [new AIMessage('No input provided.')],
    };
  }

  const sessionId = resolveSessionId(state, config);
  const modelProvider = process.env.DEXTER_MODEL_PROVIDER;
  const model = process.env.DEXTER_MODEL;
  const maxIterations = process.env.DEXTER_MAX_ITERATIONS
    ? Number(process.env.DEXTER_MAX_ITERATIONS)
    : undefined;

  const history = new InMemoryChatHistory(model);
  if (sessionId) {
    const stored = await loadSessionMessages(sessionId);
    if (stored.length > 0) {
      history.loadMessages(stored);
    }
  }

  history.saveUserQuery(query);

  const agent = await Agent.create({
    ...(modelProvider ? { modelProvider } : {}),
    ...(model ? { model } : {}),
    ...(Number.isFinite(maxIterations) ? { maxIterations } : {}),
  });

  let answer = '';
  for await (const event of agent.run(query, history)) {
    if (event.type === 'done') {
      answer = event.answer;
    }
  }

  if (!answer) {
    answer = 'No response generated.';
  }

  if (sessionId) {
    await history.saveAnswer(answer);
    const last = history.getMessages().slice(-1)[0];
    if (last?.answer) {
      await appendSessionMessage(sessionId, {
        query: last.query,
        answer: last.answer,
        summary: last.summary,
      });
    }
  }

  return {
    result: answer,
    messages: [new AIMessage(answer)],
  };
}

const graph = new StateGraph(State)
  .addNode('dexter', runDexter)
  .addEdge(START, 'dexter')
  .addEdge('dexter', END);

export const app = graph.compile();

export type { GraphState };

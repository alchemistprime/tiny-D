import { AIMessage, BaseMessage } from '@langchain/core/messages';
import { Annotation, StateGraph, START, END, messagesStateReducer } from '@langchain/langgraph';
import { Agent } from '../agent/agent.js';

const State = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  input: Annotation<string>(),
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

async function runDexter(state: GraphState): Promise<Partial<GraphState>> {
  const query = resolveQuery(state).trim();
  if (!query) {
    return {
      result: 'No input provided.',
      messages: [new AIMessage('No input provided.')],
    };
  }

  const modelProvider = process.env.DEXTER_MODEL_PROVIDER;
  const model = process.env.DEXTER_MODEL;
  const maxIterations = process.env.DEXTER_MAX_ITERATIONS
    ? Number(process.env.DEXTER_MAX_ITERATIONS)
    : undefined;

  const agent = await Agent.create({
    ...(modelProvider ? { modelProvider } : {}),
    ...(model ? { model } : {}),
    ...(Number.isFinite(maxIterations) ? { maxIterations } : {}),
  });

  let answer = '';
  for await (const event of agent.run(query)) {
    if (event.type === 'done') {
      answer = event.answer;
    }
  }

  if (!answer) {
    answer = 'No response generated.';
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

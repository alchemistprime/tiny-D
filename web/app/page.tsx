'use client';

import { useState, useRef, useEffect, useDeferredValue, memo } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Image from 'next/image';

const remarkPlugins = [remarkGfm];
const markdownComponents = {
  a: ({ href, children }: any) => (
    <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
  ),
};

const MarkdownText = memo(function MarkdownText({
  text,
  streaming,
}: { text: string; streaming: boolean }) {
  const deferredText = useDeferredValue(text);

  return (
    <div className="prose prose-invert max-w-none">
      <ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents}>
        {deferredText}
      </ReactMarkdown>
      {streaming && <span className="inline-block w-2 h-5 bg-red-500 animate-pulse ml-1" />}
    </div>
  );
});

// Always route through the Next.js proxy at /api/chat.
// The proxy bridges the UI to Dexter's LangChain-based agent runtime.
const CHAT_API = '/api/chat';

const THINKING_VERBS = [
  'Analyzing', 'Investigating', 'Examining', 'Evaluating',
  'Scrutinizing', 'Quantifying', 'Extrapolating', 'Correlating',
  'Synthesizing', 'Aggregating', 'Parsing', 'Validating',
  'Cross-referencing', 'Calculating', 'Modeling', 'Assessing',
];

const TOOL_LABELS: Record<string, string> = {
  financial_search: 'Money Hunt',
  financial_metrics: 'Metric Magic',
  read_filings: 'Filing Finder',
  web_search: 'Web Scout',
  web_fetch: 'Page Grab',
  browser: 'Browser Buddy',
  get_stock_price: 'Price Peek',
  get_historical_stock_prices: 'History Hop',
  get_company_news: 'News Nudge',
  get_key_ratios: 'Ratio Riff',
  get_income_statements: 'Income Intel',
  get_balance_sheets: 'Balance Buzz',
  get_cash_flow_statements: 'Cash Chaser',
  get_all_financial_statements: 'Full Stack',
  get_crypto_price_snapshot: 'Crypto Snap',
  get_crypto_prices: 'Crypto Trail',
  get_available_crypto_tickers: 'Ticker Trove',
  get_insider_trades: 'Insider Buzz',
  get_segmented_revenues: 'Segment Scoop',
  get_analyst_estimates: 'Analyst Angle',
  skill: 'Skill Spark',
  read_file: 'File Peek',
  write_file: 'File Scribble',
  edit_file: 'File Fixer',
};

function formatToolName(name: string): string {
  return (
    TOOL_LABELS[name] ??
    name
      .split(/[_-]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  );
}

export default function Chat() {
  const [sessionId] = useState(() => crypto.randomUUID());
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status, error, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: CHAT_API,
      prepareSendMessagesRequest({ messages }) {
        return {
          body: {
            messages,
            memory: {
              thread: `web-${sessionId}`,
              resource: `user-${sessionId}`,
            },
          },
        };
      },
    }),
    experimental_throttle: 16,
  });

  const isLoading = status === 'streaming' || status === 'submitted';

  useEffect(() => {
    const behavior = status === 'streaming' ? 'auto' : 'smooth';
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, [messages.length, status]);

  const handleNewChat = () => {
    setMessages([]);
    setInput('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      sendMessage({ text: input });
      setInput('');
    }
  };

  const handleSuggestion = (text: string) => {
    setInput(text);
  };

  return (
    <div className="flex flex-col h-screen max-w-5xl mx-auto">
      {/* Header */}
      <header className="flex items-center gap-4 p-4 border-b border-neutral-800">
        <Image src="/logo.png" alt="Bindle" width={40} height={40} className="w-10 h-10" />
        <div className="flex-1">
          <h1 className="font-semibold text-3xl">AlphaSentry</h1>
        </div>
        {messages.length > 0 && (
          <button
            onClick={handleNewChat}
            className="px-3 py-1.5 text-sm border border-neutral-700 hover:border-neutral-500 rounded-lg text-gray-400 hover:text-white transition-colors"
          >
            New Chat
          </button>
        )}
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center h-full text-center text-gray-500">
            <div className="flex items-center gap-3 mb-2">
              <Image src="/logo.png" alt="AlphaSentry" width={50} height={50} className="w-[50px] h-[50px]" />
              <span className="text-3xl font-semibold text-white">AlphaSentry</span>
            </div>
            <p className="text-[9px] text-gray-400">Your AI assistant for deep financial research.</p>
            <div className="grid grid-cols-2 gap-3 mt-6 max-w-lg">
              <SuggestionButton text="What's NVDA's current P/E ratio?" onClick={handleSuggestion} />
              <SuggestionButton text="Compare AAPL and MSFT revenue" onClick={handleSuggestion} />
              <SuggestionButton text="Latest insider trades for TSLA" onClick={handleSuggestion} />
              <SuggestionButton text="Summarize META's latest 10-K" onClick={handleSuggestion} />
            </div>
          </div>
        )}

        {messages.map((message) => {
          const isLastMessage = message.id === messages[messages.length - 1]?.id;
          const isStreamingThis = status === 'streaming' && isLastMessage;
          const isActiveAssistant = isLastMessage && isLoading && message.role === 'assistant';

          return (
            <div key={message.id} className="space-y-2">
              {message.role === 'user' ? (
                <div className="flex justify-end">
                  <div className="bg-red-600 text-white rounded-2xl px-4 py-3 max-w-[80%]">
                    <p>{message.parts?.filter(p => p.type === 'text').map(p => p.text).join('') || ''}</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Tool invocations */}
                  {message.parts?.some(p => p.type === 'tool-invocation') && (
                    <div className="flex items-start gap-3">
                      <Image
                        src="/logo.png"
                        alt="AlphaSentry"
                        width={32}
                        height={32}
                        className={`w-8 h-8 flex-shrink-0 ${isActiveAssistant ? 'animate-pulse' : ''}`}
                      />
                      <div className="flex-1 bg-neutral-900 rounded-lg p-4 tool-status border border-neutral-800">
                        <div className="space-y-3">
                          {message.parts
                            ?.filter((p): p is Extract<typeof p, { type: 'tool-invocation' }> => p.type === 'tool-invocation')
                            .map((part) => (
                              <ToolStatusItem
                                key={part.toolInvocation.toolCallId}
                                name={part.toolInvocation.toolName}
                                state={part.toolInvocation.state}
                                args={part.toolInvocation.args as Record<string, unknown>}
                              />
                            ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Thinking indicator — shown while agent is working but no text has arrived yet */}
                  {isActiveAssistant && !message.parts?.some(p => p.type === 'text' && p.text.trim()) && (
                    <div className="flex items-start gap-3">
                      <div className="w-8" />
                      <ThinkingIndicator />
                    </div>
                  )}

                  {/* Text content */}
                  {message.parts?.some(p => p.type === 'text' && p.text.trim()) && (
                    <div className="flex items-start gap-3">
                      <Image src="/logo.png" alt="Bindle" width={32} height={32} className="w-8 h-8 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <MarkdownText
                          text={message.parts?.filter(p => p.type === 'text').map(p => p.text).join('') || ''}
                          streaming={isStreamingThis}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Thinking indicator — before any assistant message appears */}
        {isLoading && (messages.length === 0 || messages[messages.length - 1]?.role === 'user') && (
          <div className="flex items-start gap-3">
            <Image src="/logo.png" alt="AlphaSentry" width={32} height={32} className="w-8 h-8 animate-pulse" />
            <ThinkingIndicator />
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 text-red-400">
            <strong>Error:</strong> {error.message}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-neutral-800">
        <div className="flex gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about stocks, earnings, financial metrics..."
            className="flex-1 bg-neutral-900 border border-neutral-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-all"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="bg-red-600 hover:bg-red-700 disabled:bg-neutral-700 disabled:cursor-not-allowed text-white px-6 py-3 rounded-xl font-medium transition-colors"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

function SuggestionButton({ text, onClick }: { text: string; onClick: (text: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onClick(text)}
      className="text-left bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-700 rounded-lg px-4 py-3 text-gray-400 hover:text-white transition-all"
    >
      {text}
    </button>
  );
}

function ToolStatusItem({ name, state, args }: { name: string; state: string; args?: Record<string, unknown> }) {
  const isRunning = state === 'call' || state === 'partial-call';
  const isComplete = state === 'result';

  const formatArgs = (a?: Record<string, unknown>): string => {
    if (!a) return '';
    if (Object.keys(a).length === 1 && 'query' in a) {
      const query = String(a.query);
      return query.length > 60 ? `"${query.slice(0, 60)}..."` : `"${query}"`;
    }
    return Object.entries(a)
      .map(([key, value]) => {
        const strValue = String(value);
        return `${key}=${strValue.length > 40 ? strValue.slice(0, 40) + '...' : strValue}`;
      })
      .join(', ');
  };

  return (
    <div className="tool-status-item">
      <span className="tool-status-icon">
        {isRunning ? (
          <span className="tool-spinner" />
        ) : isComplete ? (
          <span className="text-green-500">✓</span>
        ) : (
          <span className="text-red-500">✗</span>
        )}
      </span>
      <div className="flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="tool-status-name">{formatToolName(name)}</span>
          {args && <span className="tool-status-args">({formatArgs(args)})</span>}
        </div>
        {isRunning && <div className="tool-status-result">Searching...</div>}
        {isComplete && <div className="tool-status-result">Completed</div>}
      </div>
    </div>
  );
}

function ThinkingIndicator() {
  const [verbIndex, setVerbIndex] = useState(0);
  const [dots, setDots] = useState('');

  useEffect(() => {
    const verbInterval = setInterval(() => {
      setVerbIndex(prev => (prev + 1) % THINKING_VERBS.length);
    }, 2000);
    const dotsInterval = setInterval(() => {
      setDots(prev => (prev.length >= 3 ? '' : prev + '.'));
    }, 400);
    return () => {
      clearInterval(verbInterval);
      clearInterval(dotsInterval);
    };
  }, []);

  return (
    <div className="flex items-center gap-3">
      <div className="flex gap-1">
        <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
        <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
        <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
      </div>
      <span className="text-gray-400 min-w-[180px]">
        <span className="text-red-400 font-medium transition-all duration-300">{THINKING_VERBS[verbIndex]}</span>
        <span className="text-gray-500">{dots}</span>
      </span>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState, type JSX } from 'react';
import type { PublicQuote } from '@/lib/widget/conversation';

const PREVIEW_NOTE = "This practice chat doesn't send the enquiry.";
const ENQUIRY_NOTE = "Prices appear once you've told it about at least one kind of work.";

type Bubble = {
  role: 'user' | 'assistant';
  content: string;
  quote: PublicQuote | null;
  askForDetails: boolean;
};

function safeColour(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#0C66E4';
}

function asQuote(raw: unknown): PublicQuote | null {
  if (!raw || typeof raw !== 'object') return null;
  const quote = raw as Record<string, unknown>;
  if (quote.kind === 'firm' && typeof quote.amount === 'number' && typeof quote.summary === 'string') {
    return { kind: 'firm', amount: quote.amount, summary: quote.summary };
  }
  if (
    quote.kind === 'guide' &&
    typeof quote.min === 'number' &&
    typeof quote.max === 'number' &&
    typeof quote.summary === 'string'
  ) {
    return { kind: 'guide', min: quote.min, max: quote.max, summary: quote.summary };
  }
  if (quote.kind === 'visit' && typeof quote.summary === 'string') {
    return { kind: 'visit', summary: quote.summary };
  }
  return null;
}

export function WidgetPreview(props: {
  source: 'live' | 'interview';
  businessName: string;
  greeting: string;
  primaryColour: string;
  starterPrompts?: string[];
}): JSX.Element {
  const { source, businessName, greeting, starterPrompts } = props;
  const colour = safeColour(props.primaryColour);
  const [messages, setMessages] = useState<Bubble[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [limited, setLimited] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enquiryNote, setEnquiryNote] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, sending, limited, error]);

  function startAgain() {
    setMessages([]);
    setInput('');
    setSending(false);
    setLimited(null);
    setError(null);
    setEnquiryNote(false);
    inputRef.current?.focus();
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || sending || limited) return;
    const userCount = messages.filter((message) => message.role === 'user').length;
    if (userCount >= 30) {
      setError('This practice chat is full. Start again to keep going.');
      return;
    }

    const history = [
      ...messages.map((message) => ({ role: message.role, content: message.content })),
      { role: 'user' as const, content },
    ];
    setMessages((current) => [...current, { role: 'user', content, quote: null, askForDetails: false }]);
    setInput('');
    setSending(true);
    setError(null);

    try {
      const res = await fetch('/api/lite/preview/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, source }),
      });
      const body = (await res.json().catch(() => null)) as {
        reply?: unknown;
        quote?: unknown;
        askForDetails?: unknown;
        message?: unknown;
        mode?: unknown;
        error?: unknown;
      } | null;
      if (res.status === 429 && body && typeof body.message === 'string') {
        setLimited(body.message);
        return;
      }
      if (!res.ok || !body || typeof body.reply !== 'string') {
        setError(typeof body?.error === 'string' ? body.error : 'Something went wrong. Try again.');
        return;
      }
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: body.reply as string,
          quote: asQuote(body.quote),
          askForDetails: body.askForDetails === true,
        },
      ]);
      if (source === 'interview') setEnquiryNote(body.mode === 'enquiry');
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-2">
      {enquiryNote ? <p className="max-w-[380px] text-sm text-[#6B6964]">{ENQUIRY_NOTE}</p> : null}
      <div
        className="flex h-[520px] w-full max-w-[380px] flex-col overflow-hidden rounded-2xl bg-white text-left text-[#0A1A2E] shadow-[0_8px_48px_rgba(0,0,0,0.18)]"
        style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3.5 text-white" style={{ backgroundColor: colour }}>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{businessName}</div>
            <div className="text-[11px] text-white/60">Website assistant</div>
          </div>
          <button type="button" onClick={startAgain} className="shrink-0 text-xs text-white/80 underline">
            Start again
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto bg-[#FAFAF8] p-4">
          {greeting ? (
            <div className="max-w-[82%] self-start rounded-2xl rounded-bl-sm bg-white px-3.5 py-2.5 text-sm leading-normal shadow-sm">
              {greeting}
            </div>
          ) : null}
          {messages.map((message, index) =>
            message.role === 'user' ? (
              <div
                key={`${message.role}-${index}`}
                className="max-w-[82%] self-end whitespace-pre-wrap rounded-2xl rounded-br-sm px-3.5 py-2.5 text-sm leading-normal text-white"
                style={{ backgroundColor: colour }}
              >
                {message.content}
              </div>
            ) : (
              <div key={`${message.role}-${index}`} className="flex flex-col gap-2.5">
                <div className="max-w-[82%] self-start whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-white px-3.5 py-2.5 text-sm leading-normal shadow-sm">
                  {message.content}
                </div>
                {message.askForDetails ? (
                  <div className="self-start">
                    <button
                      type="button"
                      disabled
                      className="rounded-full bg-[#0A1A2E]/80 px-3.5 py-2 text-[13px] text-white opacity-40"
                    >
                      Leave my details
                    </button>
                    <p className="mt-2 text-xs text-[#6B6964]">{PREVIEW_NOTE}</p>
                  </div>
                ) : null}
              </div>
            ),
          )}
          {sending ? (
            <div className="flex w-fit items-center gap-1 self-start rounded-2xl rounded-bl-sm bg-white px-3.5 py-3 shadow-sm">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#B8B6B0]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#B8B6B0] [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#B8B6B0] [animation-delay:300ms]" />
            </div>
          ) : null}
          {limited ? <p className="self-start text-sm text-[#6B6964]">{limited}</p> : null}
          {error ? <p className="self-start text-sm text-[#B42318]">{error}</p> : null}
          <div ref={bottomRef} />
        </div>

        {starterPrompts && starterPrompts.length > 0 && messages.length === 0 ? (
          <div className="flex flex-wrap gap-1.5 border-t border-[#EBEBEA] bg-white px-4 pt-3">
            {starterPrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                disabled={sending || limited != null}
                onClick={() => setInput(prompt)}
                className="rounded-full border border-[#EBEBEA] bg-white px-2.5 py-1.5 text-xs text-[#0A1A2E]"
              >
                {prompt}
              </button>
            ))}
          </div>
        ) : null}

        <form
          className="flex shrink-0 items-end gap-2 border-t border-[#EBEBEA] bg-white px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            void send(input);
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            maxLength={1000}
            rows={1}
            disabled={sending || limited != null}
            placeholder="Type a message"
            aria-label="Message"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send(input);
              }
            }}
            className="max-h-24 min-w-0 flex-1 resize-none rounded-3xl border border-[#EBEBEA] bg-[#FAFAF8] px-4 py-2.5 text-sm outline-none disabled:opacity-40"
          />
          <button
            type="submit"
            disabled={sending || limited != null || input.trim() === ''}
            aria-label="Send"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white disabled:opacity-40"
            style={{ backgroundColor: colour }}
          >
            ↑
          </button>
        </form>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export function InterviewChat({
  messages,
  input,
  sending,
  thinkingLabel,
  error,
  canMoveToExamples,
  onInput,
  onSend,
  onMoveToExamples,
  onRetry,
}: {
  messages: { role: 'user' | 'assistant'; content: string }[];
  input: string;
  sending: boolean;
  thinkingLabel?: string | null;
  error: string | null;
  canMoveToExamples: boolean;
  onInput: (value: string) => void;
  onSend: () => void;
  onMoveToExamples: () => void;
  onRetry?: () => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const moveOn = error === 'too_long';
  const errorText =
    error === 'ai_failed'
      ? "Sorry, that didn't go through — send it again."
      : error === 'too_long'
        ? "That's plenty — let's move on to example jobs."
        : error === 'busy'
          ? 'Still working on your last answer — send it again.'
          : error === 'not_found' || error === 'finished'
            ? "That interview isn't open. Refresh the page."
            : error;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, sending, errorText]);

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  }

  return (
    <section className="glass-card flex min-w-0 flex-col gap-3 rounded-xl p-4">
      <div className="flex max-h-[min(32rem,60vh)] flex-col gap-3 overflow-y-auto">
        {messages.map((message, index) => (
          <p
            key={`${message.role}-${index}`}
            className={
              message.role === 'user'
                ? 'ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md border border-border bg-card px-3.5 py-2.5 text-sm text-foreground'
                : 'mr-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-md bg-(--tone-lite-soft) px-3.5 py-2.5 text-sm text-foreground'
            }
          >
            {message.content}
          </p>
        ))}
        {sending ? (
          <p className="mr-auto flex items-center gap-2 rounded-2xl rounded-bl-md bg-(--tone-lite-soft) px-3.5 py-2.5" aria-label={thinkingLabel ?? 'Typing'}>
            <span className="flex items-center gap-1">
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
            </span>
            {thinkingLabel ? <span className="text-sm text-muted-foreground">{thinkingLabel}</span> : null}
          </p>
        ) : null}
        <div ref={bottomRef} />
      </div>

      <Textarea
        value={input}
        disabled={sending}
        placeholder="Type your answer"
        aria-label="Your answer"
        onChange={(event) => onInput(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="flex items-center justify-end">
        <Button
          type="button"
          className="bg-(--tone-lite-solid) text-white hover:bg-(--tone-lite-solid)/90"
          disabled={sending || input.trim() === ''}
          onClick={onSend}
        >
          Send
        </Button>
      </div>
      {errorText ? (
        <div className="flex flex-wrap items-center gap-3" role="alert">
          <p className="text-sm text-destructive">{errorText}</p>
          {onRetry ? (
            <Button type="button" variant="outline" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}
      {moveOn && canMoveToExamples ? (
        <Button type="button" variant="outline" onClick={onMoveToExamples}>
          Example jobs
        </Button>
      ) : null}
    </section>
  );
}

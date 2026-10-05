'use client';

import { useCallback, useEffect, useState, type JSX } from 'react';
import { BoardToast, type BoardToastData } from '@/components/rounds/week-board/board-toast';

export type FloatingAction = { label: string; onClick: () => void | Promise<void> };

export type FloatingMessageInput = {
  /** "Moved to Friday" */
  title: string;
  /** "3 customers not told yet" */
  body?: string;
  tone?: 'default' | 'success' | 'error';
  /** Undo, Tell them… at most two. */
  actions?: FloatingAction[];
  /** How long it stays. Default 10 seconds. */
  durationMs?: number;
};

type Listener = (message: BoardToastData | null) => void;

let listener: Listener | null = null;
let counter = 0;

/**
 * "Something just happened": a glass message at the bottom that fades after 10 seconds, with a line
 * showing the time left, a close button and up to two actions. One at a time: a new message replaces
 * the old one. Needs a FloatingMessageHost on the page (the dashboard and the customer pages mount it).
 */
export function floatingMessage(input: FloatingMessageInput): void {
  if (!listener) return;
  counter += 1;
  const text = input.body ? `${input.title}. ${input.body}` : input.title;
  listener({
    id: `floating-${counter}`,
    text,
    tone: input.tone === 'error' ? 'danger' : 'success',
    actions: (input.actions ?? []).slice(0, 2).map((action) => ({
      label: action.label,
      onClick: () => {
        void action.onClick();
        listener?.(null);
      },
    })),
    durationMs: input.durationMs,
  });
}

export function FloatingMessageHost(): JSX.Element | null {
  const [message, setMessage] = useState<BoardToastData | null>(null);
  useEffect(() => {
    listener = setMessage;
    return () => {
      if (listener === setMessage) listener = null;
    };
  }, []);
  const dismiss = useCallback((id: string) => setMessage((current) => (current?.id === id ? null : current)), []);
  return <BoardToast message={message} onDismiss={dismiss} />;
}

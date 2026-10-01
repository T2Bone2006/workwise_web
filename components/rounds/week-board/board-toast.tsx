'use client';

import { useEffect, useRef, useState, type JSX } from 'react';
import { AlertCircle, Check, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/** How long a result message stays before it fades. */
export const BOARD_TOAST_MS = 10_000;

export type BoardToastData = {
  /** A new id is a new message: it comes in again and its timer starts over. */
  id: string;
  text: string;
  tone?: 'success' | 'danger' | 'working';
  actions?: { label: string; onClick: () => void }[];
  /** Stays until replaced (a "Swapping…" waiting for the server). */
  sticky?: boolean;
  /** Shorter than the usual 10 seconds (a plain "Told 5" needs no time). */
  durationMs?: number;
};

const TICK_MS = 100;
const LEAVE_MS = 260;

/**
 * "This just happened" with Undo and Tell them: a glass pill at the bottom of the screen
 * that fades after 10 seconds, with a thin line that shows the time running out. It waits
 * while the mouse is over it or a dialog is open. Each message is its own component (keyed
 * by id), so a new one starts fresh.
 */
export function BoardToast(props: {
  message: BoardToastData | null;
  /** Hold the countdown (a confirm dialog is open). */
  paused?: boolean;
  onDismiss: (id: string) => void;
}): JSX.Element | null {
  if (!props.message) return null;
  return (
    <ToastBody
      key={props.message.id}
      shown={props.message}
      paused={props.paused === true}
      onDismiss={props.onDismiss}
    />
  );
}

function ToastBody(props: {
  shown: BoardToastData;
  paused: boolean;
  onDismiss: (id: string) => void;
}): JSX.Element {
  const { shown, onDismiss } = props;
  const [entered, setEntered] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [progress, setProgress] = useState(1);
  const elapsed = useRef(0);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const paused = props.paused || hovered;
  const id = shown.id;
  const sticky = shown.sticky === true;
  const duration = shown.durationMs ?? BOARD_TOAST_MS;

  useEffect(() => {
    if (sticky || paused || leaving) return;
    const timer = setInterval(() => {
      elapsed.current += TICK_MS;
      setProgress(Math.max(0, 1 - elapsed.current / duration));
      if (elapsed.current >= duration) {
        clearInterval(timer);
        setLeaving(true);
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [sticky, paused, leaving, duration]);

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => onDismiss(id), LEAVE_MS);
    return () => clearTimeout(timer);
  }, [leaving, id, onDismiss]);

  const tone = shown.tone ?? 'success';

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div
        role="status"
        aria-live="polite"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={cn(
          'pointer-events-auto relative flex max-w-xl items-center gap-3 overflow-hidden rounded-2xl border px-3 py-2.5 pb-3',
          'border-white/50 bg-background/70 shadow-[0_10px_30px_-10px_rgba(15,23,42,0.35)] backdrop-blur-xl',
          'dark:border-white/10 dark:bg-background/60',
          'transition-all duration-[260ms] ease-out',
          entered && !leaving ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0',
        )}
      >
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-full',
            tone === 'success' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
            tone === 'danger' && 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300',
            tone === 'working' && 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300',
          )}
        >
          {tone === 'working' ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : tone === 'danger' ? (
            <AlertCircle className="size-4" aria-hidden />
          ) : (
            <Check className="size-4" aria-hidden />
          )}
        </span>
        <p className="min-w-0 flex-1 text-sm font-semibold text-foreground">{shown.text}</p>
        {shown.actions?.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={action.onClick}
            className="shrink-0 rounded-md px-2 py-1 text-sm font-bold text-primary hover:bg-primary/10"
          >
            {action.label}
          </button>
        ))}
        {!sticky ? (
          <button
            type="button"
            onClick={() => setLeaving(true)}
            aria-label="Dismiss"
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
        {!sticky ? (
          <div className="pointer-events-none absolute inset-x-3 bottom-0 h-[3px]">
            <div
              className="h-full origin-left rounded-full bg-primary/55"
              style={{ transform: `scaleX(${progress})` }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Banknote,
  Briefcase,
  CalendarDays,
  Check,
  CircleAlert,
  CornerDownRight,
  Inbox,
  MapPin,
  Receipt,
  Square,
  TrendingUp,
  Undo2,
  UserRound,
  Users,
  Wand2,
  type LucideIcon,
} from 'lucide-react';
import { IconChip, toneClasses, type Tone } from '@/components/look';
import { ActionCardView, CardView } from '@/components/assistant/cards';
import { MessageText } from '@/components/assistant/message-text';
import { Thinking } from '@/components/assistant/thinking';
import type { useAssistantChat } from '@/components/assistant/use-assistant-chat';
import type { AssistantAction, AssistantTurn, PageContext } from '@/lib/assistant/shared';
import { cn } from '@/lib/utils';

export type Chat = ReturnType<typeof useAssistantChat>;
export type SuggestionGroup = { title: string; icon: LucideIcon; tone: Tone; asks: string[] };

/** Starters for the full page: the whole business. */
export function pageSuggestions(hasRounds: boolean, hasLite: boolean, hasPro = false): SuggestionGroup[] {
  const groups: SuggestionGroup[] = [];
  if (hasPro) {
    groups.push(
      { title: 'Needs you', icon: CircleAlert, tone: 'amber', asks: ['What needs me today?', 'Which jobs were declined, and why?'] },
      { title: 'Your team', icon: Users, tone: 'sky', asks: ["Who's free tomorrow?", 'What is everyone on today?'] },
      { title: 'Numbers', icon: TrendingUp, tone: 'teal', asks: ['How many jobs did we finish this month?', 'Show me jobs per week for the last 6 weeks'] },
      { title: 'Jobs for me', icon: Wand2, tone: 'rounds', asks: ['Give the jobs with no worker to whoever is free tomorrow', 'Move everything on Friday to Monday'] },
    );
  }
  if (hasRounds) {
    groups.push(
      { title: 'Your day', icon: CalendarDays, tone: 'sky', asks: ["What's left to do today?", "Show tomorrow's round on a map"] },
      { title: 'Money', icon: Banknote, tone: 'emerald', asks: ['Who owes me money?', 'How did last month compare with the month before?'] },
      { title: 'Growing', icon: TrendingUp, tone: 'teal', asks: ['Where could I fit a new customer?', "Who's due a price rise?"] },
      { title: 'Jobs for me', icon: Wand2, tone: 'rounds', asks: ["It's raining. Move today's round to my next free day", 'I spent £48 on diesel today'] },
    );
  }
  if (hasLite) {
    groups.push({ title: 'Website leads', icon: Inbox, tone: 'lite', asks: ['Any new leads this week?', "My callout's gone up to £60"] });
  }
  return groups;
}

/** Starters for the quick panel in a Pro office: about the page you're on. */
function proQuickSuggestions(page: PageContext): SuggestionGroup {
  const path = page.path ?? '';
  if (page.jobId) {
    return { title: 'This job', icon: Briefcase, tone: 'sky', asks: ['What happened with this job?', "Who's free to take this?", 'Email the summary to the customer', 'Move this to tomorrow'] };
  }
  if (page.workerId) {
    return { title: 'This worker', icon: UserRound, tone: 'sky', asks: ["What's on for them this week?", 'How many jobs have they finished this month?', 'Are they free tomorrow?'] };
  }
  if (page.customerId) {
    return { title: 'This customer', icon: UserRound, tone: 'sky', asks: ['What jobs have we done for them?', 'Are any of their jobs still open?'] };
  }
  if (path.startsWith('/workers')) {
    return { title: 'Workers', icon: Users, tone: 'sky', asks: ["Who's free tomorrow?", 'Who has the most on this week?', 'What is everyone on today?'] };
  }
  if (path.startsWith('/customers')) {
    return { title: 'Customers', icon: UserRound, tone: 'sky', asks: ['Which customers have open jobs?', 'Which customer has the most jobs this year?'] };
  }
  if (path.startsWith('/jobs') || path.startsWith('/dashboard')) {
    return { title: 'Jobs', icon: Briefcase, tone: 'rounds', asks: ['What needs me today?', 'Show the jobs with no worker', 'Which jobs were not completed this week, and why?', 'Give the jobs with no worker to whoever is free tomorrow'] };
  }
  return { title: 'Ask about anything', icon: Wand2, tone: 'rounds', asks: ['What needs me today?', "Who's free tomorrow?", 'How many jobs did we finish this month?'] };
}

/** Starters for the quick panel: about the page you're on. */
export function quickSuggestions(page: PageContext, hasRounds: boolean, hasLite: boolean, hasPro = false): SuggestionGroup {
  const path = page.path ?? '';
  if (hasPro) return proQuickSuggestions(page);
  if (page.customerId) {
    return { title: 'This customer', icon: UserRound, tone: 'sky', asks: ['What do they owe?', 'When did I last do them?', 'Move their next visit to next week', 'Put their price up by £2'] };
  }
  if (page.leadId) {
    return { title: 'This lead', icon: Inbox, tone: 'lite', asks: ['What did they ask for?', 'Mark this lead as won'] };
  }
  if (path.startsWith('/calendar')) {
    const day = page.date ? 'this day' : 'today';
    return { title: 'Calendar', icon: CalendarDays, tone: 'sky', asks: [`What's on ${day}?`, `Show ${day} on a map`, `Move ${day}'s round to my next free day`, 'Where could I fit a new customer?'] };
  }
  if (path.startsWith('/payments')) {
    return { title: 'Payments', icon: Banknote, tone: 'emerald', asks: ['Who owes me money?', "Who's waited over a month?", 'How much came in this month?', 'Email pay links to everyone who owes over £50'] };
  }
  if (path.startsWith('/expenses')) {
    return { title: 'Expenses', icon: Receipt, tone: 'violet', asks: ['What did I spend this month?', 'How much on fuel this tax year?', 'I spent £48 on diesel today'] };
  }
  if (path.startsWith('/customers')) {
    return { title: 'Customers', icon: UserRound, tone: 'sky', asks: ['Who owes me money?', "Who's paused at the moment?", "Who's due a price rise?", 'Add a new customer'] };
  }
  if (path.startsWith('/lite')) {
    return { title: 'Leads', icon: Inbox, tone: 'lite', asks: ['Any new leads this week?', "Which leads haven't I contacted?", "My callout's gone up to £60"] };
  }
  if (!hasRounds && hasLite) {
    return { title: 'Website leads', icon: Inbox, tone: 'lite', asks: ['Any new leads this week?', "My callout's gone up to £60"] };
  }
  return { title: 'Ask about anything', icon: Wand2, tone: 'rounds', asks: ["What's left to do today?", 'Who owes me money?', 'How did this month go?'] };
}

/** Turns → question-and-answer pairs, the way the assistant lays them out. */
function exchanges(turns: AssistantTurn[]): Array<{ id: string; question: string | null; answer: AssistantTurn | null }> {
  const out: Array<{ id: string; question: string | null; answer: AssistantTurn | null }> = [];
  for (const t of turns) {
    if (t.role === 'user') {
      out.push({ id: t.id, question: t.parts.map((p) => (p.type === 'text' ? p.text : '')).join(''), answer: null });
    } else {
      const last = out[out.length - 1];
      if (last && !last.answer) last.answer = t;
      else out.push({ id: t.id, question: null, answer: t });
    }
  }
  return out;
}

export function DoneTodayList({ items, onUndo, tone }: { items: AssistantAction[]; onUndo: (id: string) => void; tone: Tone }) {
  if (items.length === 0) {
    return <p className="px-3 py-4 text-sm text-muted-foreground">Nothing yet. Anything I change for you today shows here, with Undo.</p>;
  }
  return (
    <ul className="divide-y divide-border">
      {items.map((a) => (
        <li key={a.id} className="flex items-start gap-3 px-3 py-2.5">
          <span
            className={cn('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg', a.status === 'undone' ? 'bg-muted text-muted-foreground' : toneClasses('emerald').chip)}
            aria-hidden
          >
            {a.status === 'undone' ? <Undo2 className="size-3" /> : <Check className="size-3.5" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className={cn('text-sm leading-snug font-medium', a.status === 'undone' && 'text-muted-foreground line-through')}>{a.title}</p>
            <p className="text-xs text-muted-foreground">{a.result ?? (a.status === 'undone' ? 'Undone' : 'Done')}</p>
            {a.error ? <p className="text-xs text-(--tone-rose-text)">{a.error}</p> : null}
          </div>
          {a.status === 'running' ? (
            <span className="ai-shimmer shrink-0 text-xs font-medium">Working…</span>
          ) : a.canUndo && a.status === 'done' ? (
            <button
              type="button"
              onClick={() => onUndo(a.id)}
              className={cn('shrink-0 rounded-lg px-2 py-1 text-xs font-semibold hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none', toneClasses(tone).text)}
            >
              Undo
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Composer({
  busy,
  onSend,
  onStop,
  tone,
  page,
  questionsLeft,
  autoFocus,
  compact,
}: {
  busy: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  tone: Tone;
  page: PageContext | null;
  questionsLeft: number | null;
  autoFocus: boolean;
  compact: boolean;
}) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 28), 168)}px`;
  }, [text]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const submit = () => {
    if (busy || !text.trim()) return;
    onSend(text);
    setText('');
  };

  const showLeft = questionsLeft != null && questionsLeft <= 30;
  return (
    <div className={cn('shrink-0 border-t border-border bg-background pt-3 pb-4', compact ? 'px-4' : 'px-4 sm:px-6')}>
      <div>
        {page?.label || showLeft ? (
          <div className="mb-2 flex items-center justify-between gap-3">
            {page?.label ? (
              <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                <MapPin className="size-3 shrink-0" aria-hidden />
                <span className="truncate">Looking at: {page.label}</span>
              </span>
            ) : (
              <span />
            )}
            {showLeft ? (
              <span className="shrink-0 text-xs text-muted-foreground">
                {questionsLeft === 0 ? 'No questions left this month' : `${questionsLeft} questions left this month`}
              </span>
            ) : null}
          </div>
        ) : null}
        <div
          className={cn(
            'flex items-end gap-2 rounded-[18px] border border-border bg-card py-2 pr-2 pl-4 shadow-(--look-card-shadow) transition-[border-color,box-shadow]',
            'focus-within:border-(--tone-rounds-solid)/45 focus-within:shadow-[0_0_0_4px_rgb(12_102_228/0.10)]',
          )}
        >
          <label htmlFor={compact ? 'ask-quick-input' : 'ask-input'} className="sr-only">
            Ask Lily
          </label>
          <textarea
            id={compact ? 'ask-quick-input' : 'ask-input'}
            ref={ref}
            rows={1}
            value={text}
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={compact ? 'Ask about this page' : 'Ask a question, or tell me what to change'}
            className="max-h-[168px] flex-1 resize-none self-center bg-transparent py-1.5 text-[15px] leading-6 outline-none placeholder:text-muted-foreground/80"
          />
          {busy ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop"
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <Square className="size-3 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!text.trim()}
              aria-label="Send"
              className={cn(
                'flex size-10 shrink-0 items-center justify-center rounded-full text-white transition-[opacity,transform] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none active:scale-95 disabled:opacity-30',
                toneClasses(tone).solid,
              )}
            >
              <ArrowUp className="size-[18px]" strokeWidth={2.5} />
            </button>
          )}
        </div>
        {!compact ? (
          <p className="mt-2 hidden text-[11px] text-muted-foreground sm:block">
            Enter to send, Shift + Enter for a new line. Nothing changes until you tap the button on a card.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function SuggestionCard({ group, onAsk }: { group: SuggestionGroup; onAsk: (q: string) => void }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-3.5 shadow-(--look-card-shadow)">
      <p className="mb-1.5 flex items-center gap-2 text-[13px] font-semibold">
        <IconChip icon={group.icon} tone={group.tone} size="sm" />
        {group.title}
      </p>
      <div className="flex flex-col">
        {group.asks.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onAsk(q)}
            className="group flex items-center gap-2 rounded-xl px-2 py-2 text-left text-sm text-foreground/85 transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <CornerDownRight className="size-3.5 shrink-0 text-muted-foreground/60 group-hover:text-muted-foreground" aria-hidden />
            {q}
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * The conversation itself — question-and-answer pairs, cards, Do it cards,
 * the thinking shimmer, and the box to type in. The full page and the quick
 * panel both show this, over the same chat.
 */
export function Conversation({
  chat,
  page,
  hasRounds,
  variant,
  intro,
  suggestions,
  autoFocus = false,
  afterSuggestions,
}: {
  chat: Chat;
  page: PageContext | null;
  hasRounds: boolean;
  variant: 'page' | 'quick';
  intro: { title: string; body: string };
  suggestions: SuggestionGroup[];
  autoFocus?: boolean;
  afterSuggestions?: React.ReactNode;
}) {
  const { state, send, decide, stop } = chat;
  const tone: Tone = hasRounds ? 'rounds' : 'lite';
  const compact = variant === 'quick';
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const pairs = exchanges(state.turns);
  const empty = pairs.length === 0 && !state.busy;

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight });
  }, [state.turns, state.status, state.error]);

  const ask = (q: string) => {
    stick.current = true;
    void send(q, page);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto bg-background"
      >
        {!state.loaded ? (
          <div className={cn('py-10', compact ? 'px-5' : 'px-4 sm:px-6')}>
            <Thinking label="Getting things ready…" lite={!hasRounds} />
          </div>
        ) : empty ? (
          <div className={cn(compact ? 'px-5 py-6' : 'px-4 py-8 sm:px-6 sm:py-12')}>
            <h2 className={cn('leading-tight font-semibold tracking-tight', compact ? 'text-xl' : 'text-[28px]')}>{intro.title}</h2>
            <p className={cn('mt-1.5 text-muted-foreground', compact ? 'text-sm' : 'max-w-lg text-[15px]')}>{intro.body}</p>
            <div className={cn('mt-6 grid gap-3', !compact && 'sm:grid-cols-2')}>
              {suggestions.map((g) => (
                <SuggestionCard key={g.title} group={g} onAsk={ask} />
              ))}
            </div>
            {afterSuggestions}
            {state.error ? (
              <p className="mt-4 flex items-start gap-2 rounded-xl bg-(--tone-rose-soft) px-3 py-2 text-sm text-(--tone-rose-text)" role="alert">
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {state.error}
              </p>
            ) : null}
          </div>
        ) : (
          <div className={cn('flex flex-col pb-6', compact ? 'px-5' : 'px-4 sm:px-6')}>
            {pairs.map((pair, i) => {
              const last = i === pairs.length - 1;
              const parts = pair.answer?.parts ?? [];
              const tail = parts[parts.length - 1];
              // Until the whole answer is in, something always shows it's still working:
              // the tool it's using, "Writing…" while words arrive, "Thinking…" in between (after a card, say).
              const working = last && state.busy;
              const label = state.status ? `${state.status}…` : tail?.type === 'text' ? 'Writing…' : 'Thinking…';
              return (
                <article key={pair.id} className={cn(compact ? 'py-5' : 'py-6', !last && 'border-b border-border')}>
                  {pair.question ? (
                    <h3 className={cn('flex items-start gap-2.5 leading-snug font-semibold', compact ? 'text-[15px]' : 'text-[16px]')}>
                      <span className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md', toneClasses(tone).chip)} aria-hidden>
                        <CornerDownRight className="size-3" />
                      </span>
                      <span className="min-w-0 whitespace-pre-wrap">{pair.question}</span>
                    </h3>
                  ) : null}
                  <div className={cn('mt-3 flex flex-col gap-3', !compact && 'sm:pl-[30px]')}>
                    {parts.map((p, j) =>
                      p.type === 'text' ? (
                        <MessageText key={j} text={p.text} />
                      ) : p.type === 'card' ? (
                        <CardView key={j} card={p.card} />
                      ) : (
                        <ActionCardView key={p.action.id} action={p.action} onDecide={(d) => void decide(p.action.id, d)} />
                      ),
                    )}
                    {working ? <Thinking label={label} lite={!hasRounds} /> : null}
                    {last && state.error ? (
                      <p className="flex items-start gap-2 rounded-xl bg-(--tone-rose-soft) px-3 py-2 text-sm text-(--tone-rose-text)" role="alert">
                        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {state.error}
                      </p>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
      <Composer
        busy={state.busy}
        onSend={ask}
        onStop={stop}
        tone={tone}
        page={page}
        questionsLeft={state.questionsLeft}
        autoFocus={autoFocus}
        compact={compact}
      />
    </div>
  );
}

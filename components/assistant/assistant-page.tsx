'use client';

import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, Clock, RotateCcw, ShieldCheck, Sparkles } from 'lucide-react';
import { IconChip, toneClasses, type Tone } from '@/components/look';
import { useAsk } from '@/components/assistant/ask-provider';
import { Conversation, DoneTodayList, pageSuggestions } from '@/components/assistant/conversation';
import { ASSISTANT_MONTHLY_QUESTIONS } from '@/lib/assistant/shared';
import { cn } from '@/lib/utils';

/**
 * Your assistant, full size: the same conversation as the quick panel, with
 * room for charts and maps, and today's changes alongside. No list of old
 * chats: it clears itself after 45 quiet minutes, or with Clear.
 */
export function AssistantPage() {
  const ask = useAsk();
  const refresh = ask?.pageChat.refresh;

  // Coming from Lily's hello on the overview: /assistant?ask=… asks that question once her chat has loaded.
  const router = useRouter();
  const params = useSearchParams();
  const starter = useRef(params.get('ask'));
  const asked = useRef(false);
  const send = ask?.pageChat.send;

  useEffect(() => {
    let live = true;
    void (async () => {
      await refresh?.();
      const q = starter.current;
      if (!live || !q || !send || asked.current) return;
      asked.current = true;
      router.replace('/assistant');
      await send(q.slice(0, 500), null);
    })();
    return () => {
      live = false;
    };
  }, [refresh, send, router]);

  if (!ask) return null;
  const { pageChat: chat, hasRounds, hasLite, hasPro, blue } = ask;
  const { state, decide, clear } = chat;
  const tone: Tone = blue ? 'rounds' : 'lite';
  const hasChat = state.turns.length > 0;
  const used = state.questionsLeft == null ? null : ASSISTANT_MONTHLY_QUESTIONS - state.questionsLeft;

  return (
    <div className="flex min-h-0 flex-1">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-3 border-b border-border bg-background px-4 py-3.5 sm:px-6">
          <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl text-white', toneClasses(tone).solid)} aria-hidden>
            <Sparkles className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg leading-tight font-semibold tracking-tight">Lily</h1>
            <p className="truncate text-xs text-muted-foreground">{hasPro ? 'Answers from your own jobs, team and customers. Changes wait for your OK.' : 'Answers from your own customers, calendar and money. Changes wait for your OK.'}</p>
          </div>
          {hasChat ? (
            <button
              type="button"
              onClick={() => void clear()}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <RotateCcw className="size-3.5" aria-hidden /> Clear
            </button>
          ) : null}
        </header>
        <div className="min-h-0 flex-1">
          <Conversation
            chat={chat}
            page={null}
            hasRounds={blue}
            variant="page"
            autoFocus
            intro={{
              title: "Hi, I'm Lily. What do you need?",
              body: hasPro
                ? "Ask me about your jobs, your team or your customers, or tell me what to change. I'll show you exactly what I'm about to do first."
                : "Ask me about your customers, your day or your money, or tell me what to change. I'll show you exactly what I'm about to do first.",
            }}
            suggestions={pageSuggestions(hasRounds, hasLite, hasPro)}
            afterSuggestions={
              state.doneToday.length > 0 ? (
                <section className="mt-6 xl:hidden">
                  <h3 className="mb-2 text-[13px] font-semibold">Done today</h3>
                  <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-(--look-card-shadow)">
                    <DoneTodayList items={state.doneToday} onUndo={(id) => void decide(id, 'undo')} tone={tone} />
                  </div>
                </section>
              ) : null
            }
          />
        </div>
      </section>

      <aside className="hidden w-[300px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-border bg-card p-4 xl:flex">
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
            <IconChip icon={Check} tone="emerald" size="sm" />
            Done today
          </h2>
          <div className="overflow-hidden rounded-2xl border border-border">
            <DoneTodayList items={state.doneToday} onUndo={(id) => void decide(id, 'undo')} tone={tone} />
          </div>
        </section>
        <section className="rounded-2xl bg-muted/50 p-3.5 text-sm">
          <h2 className="mb-2.5 text-[13px] font-semibold">How it works</h2>
          <ul className="space-y-2.5 text-[13px] text-muted-foreground">
            <li className="flex gap-2.5">
              <ShieldCheck className={cn('mt-0.5 size-4 shrink-0', toneClasses(tone).text)} aria-hidden />
              {hasPro ? 'Nothing changes until you tap the button on a card. Workers aren\'t told about a job until you Send out.' : 'Nothing changes until you tap the button on a card. Customers aren\'t told unless you tell them.'}
            </li>
            <li className="flex gap-2.5">
              <Clock className={cn('mt-0.5 size-4 shrink-0', toneClasses(tone).text)} aria-hidden />
              This conversation clears itself after 45 minutes without a question. What it changed stays here.
            </li>
            <li className="flex gap-2.5">
              <Sparkles className={cn('mt-0.5 size-4 shrink-0', toneClasses(tone).text)} aria-hidden />
              Lily is an AI assistant. She works from your own data, but check anything important before you rely on it.
            </li>
            <li className="flex gap-2.5">
              <Sparkles className={cn('mt-0.5 size-4 shrink-0', toneClasses(tone).text)} aria-hidden />
              On any other page, the Ask button at the bottom right opens a quick chat beside that page. It starts fresh each time.
            </li>
          </ul>
          {used != null && state.questionsLeft != null && state.questionsLeft <= 30 ? (
            <p className="mt-3 text-xs text-muted-foreground">{state.questionsLeft} questions left this month.</p>
          ) : null}
        </section>
      </aside>
    </div>
  );
}

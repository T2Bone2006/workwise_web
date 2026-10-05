'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Check,
  ClipboardList,
  Globe,
  ListChecks,
  MapPin,
  PoundSterling,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { beginExampleChatAction, fillExampleDetailAction, sendInterviewMessageAction } from '@/lib/actions/lite/interview';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { FinishPanel } from '@/components/lite/setup/finish-panel';
import { InterviewChat } from '@/components/lite/setup/interview-chat';
import { LearntPanel } from '@/components/lite/setup/learnt-panel';
import { WebsiteStep } from '@/components/lite/setup/website-step';
import { EXAMPLES_INTRO, readSetupChat, stageReady, type DraftProfile, type Stage } from '@/lib/lite/interview-schema';

type InterviewView = {
  id: string;
  stage: Stage;
  messages: { role: 'user' | 'assistant'; content: string }[];
  draft: DraftProfile;
  examples: { description: string; price: number; reasoning: string }[];
  status: 'in_progress' | 'finished';
};

const STEPS: { stage: Stage; label: string; icon: LucideIcon; chip: string }[] = [
  { stage: 'areas', label: 'Where you work', icon: MapPin, chip: 'bg-sky-500/15 text-sky-800 dark:text-sky-200' },
  { stage: 'work', label: 'Your work', icon: Wrench, chip: 'bg-violet-500/15 text-violet-800 dark:text-violet-200' },
  {
    stage: 'pricing',
    label: 'Your prices',
    icon: PoundSterling,
    chip: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200',
  },
  { stage: 'rules', label: 'Your rules', icon: ListChecks, chip: 'bg-amber-500/15 text-amber-900 dark:text-amber-200' },
  {
    stage: 'examples',
    label: 'Example jobs',
    icon: ClipboardList,
    chip: 'bg-orange-500/15 text-orange-800 dark:text-orange-200',
  },
  { stage: 'website', label: 'Your website', icon: Globe, chip: 'bg-cyan-500/15 text-cyan-800 dark:text-cyan-200' },
  { stage: 'done', label: 'Done', icon: Check, chip: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200' },
];

const CHAT: Stage[] = ['areas', 'work', 'pricing', 'rules'];

type Common = {
  businessName: string;
  greeting: string;
  primaryColour: string;
  snippet: string;
  starterPrompts: string[];
  initialWebsite: string;
  initialSignOff: string;
  initialMobile: string;
};

type Props = Common & ({ phase: 'done' } | { phase: 'interview'; view: InterviewView });

function promptsFromDraft(draft: DraftProfile): string[] {
  return (draft.job_types ?? []).slice(0, 2).map((job) => `I need ${job.name.toLowerCase()}`);
}

function ProgressRail({ stage }: { stage: Stage }) {
  const current = STEPS.findIndex((step) => step.stage === stage);
  return (
    <nav
      aria-label="Set-up progress"
      className="flex max-w-full gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] lg:w-56 lg:flex-col lg:overflow-visible [&::-webkit-scrollbar]:hidden"
    >
      {STEPS.map((step, index) => {
        const done = index < current;
        const here = index === current;
        const Icon = step.icon;
        return (
          <div
            key={step.stage}
            aria-current={here ? 'step' : undefined}
            className={
              here
                ? 'flex shrink-0 items-center gap-2.5 rounded-full bg-(--tone-lite-soft) px-2 py-1.5 ring-1 ring-(--tone-lite-line)'
                : 'flex shrink-0 items-center gap-2.5 rounded-full px-2 py-1.5'
            }
          >
            <span
              className={`flex size-7 shrink-0 items-center justify-center rounded-full ${
                done
                  ? 'bg-(--tone-emerald-solid) text-white'
                  : here
                    ? 'bg-(--tone-lite-solid) text-white'
                    : 'bg-muted text-muted-foreground'
              }`}
            >
              {done ? <Check className="size-4" /> : <Icon className="size-4" />}
            </span>
            <span
              className={
                here
                  ? 'text-sm font-semibold whitespace-nowrap text-(--tone-lite-text)'
                  : done
                    ? 'text-sm whitespace-nowrap text-foreground'
                    : 'text-sm whitespace-nowrap text-muted-foreground'
              }
            >
              {step.label}
            </span>
            {done ? <span className="sr-only">Done</span> : null}
          </div>
        );
      })}
    </nav>
  );
}

export function SetupFlow(props: Props) {
  const serverView = props.phase === 'interview' ? props.view : null;
  const [trackedId, setTrackedId] = useState(serverView?.id ?? null);
  const [view, setView] = useState<InterviewView | null>(serverView);
  const [override, setOverride] = useState<Stage | null>(null);
  const [localDone, setLocalDone] = useState(false);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [exampleError, setExampleError] = useState<string | null>(null);
  const [detailFailed, setDetailFailed] = useState(false);
  const sendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (serverView && serverView.id !== trackedId) {
    setTrackedId(serverView.id);
    setView(serverView);
    setOverride(null);
    setLocalDone(false);
    setInput('');
    setPending(null);
    setError(null);
    setExampleError(null);
    setDetailFailed(false);
  }

  const showDone = props.phase === 'done' || localDone || view?.status === 'finished';
  const setupChat = view ? readSetupChat(view.draft) : null;
  const setupChatKey = setupChat
    ? `${setupChat.mode}:${setupChat.cursor}:${setupChat.prompts.length}:${setupChat.detailed ? 1 : 0}`
    : '';
  const preparingExamples = Boolean(view && view.stage === 'examples' && !setupChat && !exampleError);
  const needsDetail = Boolean(setupChat?.mode === 'examples' && !setupChat.detailed && !detailFailed);
  const thinkingLabel = preparingExamples
    ? view && view.examples.length > 0
      ? 'One moment…'
      : 'Thinking of a few jobs to price…'
    : needsDetail
      ? 'Adding the details needed to price it…'
      : null;

  useEffect(() => {
    if (!view || view.stage !== 'examples' || setupChatKey || exampleError) return;
    const interviewId = view.id;
    let active = true;
    sendingRef.current = true;
    void beginExampleChatAction(interviewId).then((result) => {
      if (!active) return;
      sendingRef.current = false;
      if (result.ok) {
        setView(result.view);
        return;
      }
      setExampleError(result.error);
    });
    return () => {
      active = false;
      sendingRef.current = false;
    };
  }, [view, setupChatKey, exampleError]);

  useEffect(() => {
    if (!view || !needsDetail) return;
    const interviewId = view.id;
    let active = true;
    sendingRef.current = true;
    void fillExampleDetailAction(interviewId).then((result) => {
      if (!active) return;
      sendingRef.current = false;
      if (result.ok) {
        setView(result.view);
        return;
      }
      setDetailFailed(true);
    });
    return () => {
      active = false;
      sendingRef.current = false;
    };
  }, [view, needsDetail]);
  const stage: Stage = showDone ? 'done' : (override ?? view?.stage ?? 'areas');
  const draft = view?.draft ?? {};
  const prompts = showDone && view ? promptsFromDraft(draft) : props.starterPrompts;

  async function send() {
    if (!view || sendingRef.current) return;
    const text = input.trim();
    if (text === '') return;
    sendingRef.current = true;
    setSending(true);
    setInput('');
    setPending(text);
    setError(null);
    const result = await sendInterviewMessageAction(view.id, text);
    sendingRef.current = false;
    setSending(false);
    setPending(null);
    if (result.ok) {
      setView(result.view);
      if (result.view.status === 'finished') {
        setLocalDone(true);
        router.refresh();
      }
      return;
    }
    if (result.view) setView(result.view);
    else setInput(text);
    setError(result.error);
  }

  let main = null;
  if (showDone) {
    main = (
      <FinishPanel
        businessName={props.businessName}
        snippet={props.snippet}
        greeting={props.greeting}
        primaryColour={props.primaryColour}
        starterPrompts={prompts.length > 0 ? prompts : props.starterPrompts}
      />
    );
  } else if (view && (CHAT.includes(stage) || stage === 'examples' || (stage === 'website' && setupChat))) {
    const messages = [
      ...view.messages,
      ...(pending ? [{ role: 'user' as const, content: pending }] : []),
      ...(preparingExamples ? [{ role: 'assistant' as const, content: EXAMPLES_INTRO }] : []),
    ];
    main = (
      <InterviewChat
        messages={messages}
        input={input}
        sending={sending || preparingExamples || needsDetail}
        thinkingLabel={thinkingLabel}
        error={exampleError ?? error}
        canMoveToExamples={stageReady('work', draft) && stageReady('pricing', draft)}
        onInput={setInput}
        onSend={() => void send()}
        onMoveToExamples={() => setOverride('examples')}
        onRetry={stage === 'examples' && !setupChat && exampleError ? () => setExampleError(null) : undefined}
      />
    );
  } else if (view && stage === 'website') {
    main = (
      <WebsiteStep
        interviewId={view.id}
        initialWebsite={props.initialWebsite}
        initialSignOff={props.initialSignOff}
        initialMobile={props.initialMobile}
        alreadySaved={view.stage === 'website'}
        onSaved={() => setView({ ...view, stage: 'website' })}
        onFinished={() => {
          setLocalDone(true);
          router.refresh();
        }}
      />
    );
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <PageGradientHeader
        title="Set up your website assistant"
        subtitle="About 10–15 minutes. Stop any time — it saves as you go."
      />
      <div className="flex w-full min-w-0 flex-col gap-4 lg:flex-row lg:items-start">
        <ProgressRail stage={stage} />
        <div className="min-w-0 flex-1 space-y-4">
          {main}
          {!showDone && view ? (
            <div className="lg:hidden">
              <LearntPanel draft={draft} collapsible />
            </div>
          ) : null}
        </div>
        {!showDone && view ? (
          <aside className="hidden w-80 shrink-0 lg:sticky lg:top-6 lg:block">
            <LearntPanel draft={draft} />
          </aside>
        ) : null}
      </div>
    </div>
  );
}

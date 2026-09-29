'use client';

import { forwardRef, useState, useTransition, type JSX } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarClock, CheckCircle2, SkipForward, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { actOnReply } from '@/lib/actions/messaging';
import { countSegments } from '@/lib/messaging/gsm';
import { replyMoveAckSms, replySkipAckSms } from '@/lib/messaging/templates';
import type { ThreadDetail } from '@/lib/data/messaging/threads';
import { formatVisitDay } from '@/lib/payments/messages';
import { isValidYmd, type Ymd } from '@/lib/rounds/dates';
import { cn } from '@/lib/utils';

type Pending = NonNullable<ThreadDetail['pending']>;

function dayLabel(ymd: string | null): string | null {
  if (!ymd || !isValidYmd(ymd)) return null;
  return formatVisitDay(ymd);
}

function dateFromYmd(ymd: string | null): Date | undefined {
  if (!ymd || !isValidYmd(ymd)) return undefined;
  const [year, month, day] = ymd.split('-').map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day);
}

function ymdFromDate(date: Date): Ymd {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || 'them';
}

export function ReplyActions(props: {
  threadId: string;
  customerId: string;
  pending: Pending;
  brand: { businessName: string; contactPhone: string | null };
  customerName: string;
}): JSX.Element {
  const { threadId, pending, brand, customerName } = props;
  const router = useRouter();
  const [letThemKnow, setLetThemKnow] = useState(true);
  const [picked, setPicked] = useState<Date | undefined>();
  const [calOpen, setCalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, startTransition] = useTransition();

  const visitDay = dayLabel(pending.visitDate);
  const originalDate = dateFromYmd(pending.visitDate);
  const requestedDay = dayLabel(pending.requestedDate);
  const pickedYmd = picked ? ymdFromDate(picked) : null;
  const hasJobs = pending.jobIds.length > 0;

  const movePreviewDate =
    pending.intent === 'asked_move' ? (pickedYmd ?? pending.requestedDate) : pickedYmd;
  const preview =
    pending.intent === 'said_no'
      ? skipPreview(brand, pending.visitDate)
      : movePreviewDate
        ? movePreview(brand, movePreviewDate)
        : pending.intent === 'question'
          ? skipPreview(brand, pending.visitDate)
          : null;
  const segments = preview ? countSegments(preview).segments : 0;

  function run(
    action: 'skip' | 'keep' | 'move' | 'dismiss',
    toDate?: string | null,
  ) {
    setError(null);
    if (action === 'move' && !toDate) {
      setError('Pick a day first');
      return;
    }
    startTransition(async () => {
      const result = await actOnReply({
        threadId,
        action,
        toDate: toDate ?? null,
        letThemKnow: action === 'skip' || action === 'move' ? letThemKnow : false,
      });
      if (!result.success) {
        setError(result.code === 'needs_date' ? 'Pick a day first' : result.error);
        return;
      }
      const told =
        result.acknowledged && (action === 'skip' || action === 'move')
          ? ` · told ${firstName(customerName)}`
          : '';
      if (action === 'skip') {
        toast.success(`${visitDay ? `Skipped ${visitDay}` : 'Skipped'}${told}`);
      } else if (action === 'move') {
        const moved = dayLabel(toDate ?? null);
        toast.success(`${moved ? `Moved to ${moved}` : 'Moved'}${told}`);
      } else if (action === 'keep') {
        toast.success('Kept the visit');
      } else {
        toast.success('Done with this');
      }
      router.refresh();
    });
  }

  const moveDay = pending.intent === 'asked_move' ? (requestedDay ?? null) : null;
  const moveDate = pending.intent === 'asked_move' ? pending.requestedDate : pickedYmd;

  // A reply to a money text: check it, mark it paid on the customer, then clear it.
  if (pending.aboutPayment) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href={`/customers/${props.customerId}`}>Mark paid</Link>
          </Button>
          <Button variant="outline" disabled={pendingAction} onClick={() => run('dismiss')}>
            Done with this
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Payment reminders to {firstName(customerName)} are paused until you tap Done with this.
        </p>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border/70 bg-muted/25 px-2.5 py-2.5 dark:bg-muted/20">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
        <Choice
          title="Skip"
          detail={visitDay ? `Take ${visitDay} off` : 'Off the round'}
          icon={SkipForward}
          glow="rgb(244 63 94)"
          disabled={pendingAction || !hasJobs}
          onClick={() => run('skip')}
        />
        <Choice
          title="Keep"
          detail={visitDay ? `Keep as ${visitDay}` : 'Keep as is'}
          icon={CheckCircle2}
          glow="rgb(16 185 129)"
          disabled={pendingAction || !hasJobs}
          onClick={() => run('keep')}
        />
        {moveDay && moveDate ? (
          <Choice
            title="Move"
            detail={moveDay}
            icon={CalendarClock}
            glow="rgb(245 158 11)"
            disabled={pendingAction || !hasJobs}
            onClick={() => run('move', moveDate)}
          />
        ) : (
          <Popover open={calOpen} onOpenChange={setCalOpen}>
            <PopoverTrigger asChild>
              <Choice
                title="Move"
                detail={pickedYmd && dayLabel(pickedYmd) ? dayLabel(pickedYmd)! : 'Pick a day'}
                icon={CalendarClock}
                glow="rgb(245 158 11)"
                disabled={pendingAction || !hasJobs}
              />
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <MoveCalendar
                picked={picked}
                originalDate={originalDate}
                originalLabel={visitDay}
                pendingAction={pendingAction}
                onPick={setPicked}
                onMove={(ymd) => {
                  setCalOpen(false);
                  run('move', ymd);
                }}
              />
            </PopoverContent>
          </Popover>
        )}
      </div>
      </div>
      {moveDay && moveDate ? (
        <Popover open={calOpen} onOpenChange={setCalOpen}>
          <PopoverTrigger asChild>
            <button type="button" className="text-sm text-muted-foreground underline-offset-2 hover:underline" disabled={pendingAction}>
              Move to a different day
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <MoveCalendar
              picked={picked}
              originalDate={originalDate}
              originalLabel={visitDay}
              pendingAction={pendingAction}
              onPick={setPicked}
              onMove={(ymd) => {
                setCalOpen(false);
                run('move', ymd);
              }}
            />
          </PopoverContent>
        </Popover>
      ) : null}
      {hasJobs ? (
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={letThemKnow}
            onCheckedChange={(value) => setLetThemKnow(value === true)}
            disabled={pendingAction}
            className="mt-0.5"
          />
          <span>
            Text {firstName(customerName)} to confirm
            {letThemKnow && preview ? (
              <span className="mt-1 block whitespace-pre-wrap text-muted-foreground">
                {preview}{' '}
                <span className="whitespace-nowrap">
                  · {segments === 1 ? '1 text' : `${segments} texts`}
                </span>
              </span>
            ) : null}
          </span>
        </label>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

const Choice = forwardRef<
  HTMLButtonElement,
  {
    title: string;
    detail: string;
    icon: LucideIcon;
    glow: string;
    disabled: boolean;
    onClick?: () => void;
  }
>(function Choice(props, ref) {
  const Icon = props.icon;
  return (
    <button
      ref={ref}
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className={cn(
        'group inline-flex min-h-[2.5rem] w-full items-center justify-between gap-2 rounded-full border border-solid px-2.5 py-2 text-left text-sm transition-all duration-200 sm:px-3.5',
        'hover:-translate-y-0.5',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0',
      )}
      style={{
        borderColor: `color-mix(in srgb, ${props.glow} 55%, transparent)`,
        background: `linear-gradient(145deg, color-mix(in srgb, ${props.glow} 26%, transparent), color-mix(in srgb, ${props.glow} 10%, transparent))`,
        boxShadow: `0 8px 20px -12px color-mix(in srgb, ${props.glow} 70%, transparent), inset 0 1px 0 rgba(255,255,255,0.5)`,
      }}
    >
      <span className="inline-flex min-w-0 items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-white/50 bg-white/55 dark:border-white/15 dark:bg-white/10">
          <Icon className="size-3.5 shrink-0" style={{ color: props.glow }} strokeWidth={2.4} />
        </span>
        <span className="truncate font-semibold text-foreground">{props.title}</span>
      </span>
      <span className="shrink-0 rounded-full border border-white/45 bg-white/60 px-2 py-0.5 text-[11px] font-semibold text-foreground dark:border-white/10 dark:bg-white/10 sm:text-xs">
        {props.detail}
      </span>
    </button>
  );
});

function MoveCalendar(props: {
  picked: Date | undefined;
  originalDate: Date | undefined;
  originalLabel: string | null;
  pendingAction: boolean;
  onPick: (date: Date | undefined) => void;
  onMove: (ymd: Ymd) => void;
}): JSX.Element {
  const pickedYmd = props.picked ? ymdFromDate(props.picked) : null;
  return (
    <div>
      {props.originalLabel ? (
        <p className="px-3 pt-3 text-xs text-muted-foreground">Visit is {props.originalLabel}</p>
      ) : null}
      <Calendar
        mode="single"
        selected={props.picked}
        defaultMonth={props.originalDate ?? props.picked}
        modifiers={props.originalDate ? { original: props.originalDate } : undefined}
        modifiersClassNames={{
          original:
            '[&>button]:bg-amber-500/15 [&>button]:font-semibold [&>button]:text-foreground [&>button]:ring-1 [&>button]:ring-amber-500',
        }}
        onSelect={props.onPick}
      />
      {pickedYmd ? (
        <div className="border-t p-2">
          <Button
            type="button"
            className="w-full"
            disabled={props.pendingAction}
            onClick={() => props.onMove(pickedYmd)}
          >
            Move to {dayLabel(pickedYmd)}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function skipPreview(
  brand: { businessName: string; contactPhone: string | null },
  visitDate: string | null,
): string | null {
  const day = dayLabel(visitDate);
  if (!day) return null;
  return replySkipAckSms({ brand, day, nextDay: null });
}

function movePreview(
  brand: { businessName: string; contactPhone: string | null },
  toDate: string | null,
): string | null {
  const day = dayLabel(toDate);
  if (!day) return null;
  return replyMoveAckSms({ brand, toDay: day });
}

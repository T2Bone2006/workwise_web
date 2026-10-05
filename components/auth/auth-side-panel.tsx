import { Check, CloudSun, MessageSquare, Navigation, Receipt, Sparkles, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';

export type AuthSide = 'rounds' | 'lite' | 'both' | 'neutral';

/**
 * The brand side is a framed window in the plan's colour (Rounds blue, Lite
 * purple, both blended) with the phone app rising out of the bottom and live
 * notifications landing around it. Everything is code-drawn (owner: no screenshots).
 */

export const SIDE_COLOUR: Record<AuthSide, string> = {
  neutral: '#0C66E4',
  rounds: '#0C66E4',
  lite: '#9B30D9',
  both: 'linear-gradient(135deg, #0C66E4 0%, #5A47E0 50%, #9B30D9 100%)',
};

const WINDOW_BG: Record<AuthSide, string> = {
  neutral: 'linear-gradient(160deg, #1A75F0 0%, #0C66E4 45%, #0750B8 100%)',
  rounds: 'linear-gradient(160deg, #1A75F0 0%, #0C66E4 45%, #0750B8 100%)',
  lite: 'linear-gradient(160deg, #AE48EA 0%, #9B30D9 45%, #7A1FB5 100%)',
  both: 'linear-gradient(135deg, #0C66E4 0%, #4F4BE3 48%, #9B30D9 100%)',
};

type Chip = {
  icon: 'paid' | 'text' | 'lead' | 'booked' | 'invoice' | 'night';
  title: string;
  detail: string;
  /** Position inside the stage. */
  at: string;
};

const SIDES: Record<
  AuthSide,
  {
    tag: string | null;
    lines: string[];
    sub: string;
    screen: 'stops' | 'jobs' | 'chat';
    chips: Chip[];
    label: string;
  }
> = {
  neutral: {
    tag: null,
    lines: ['Run the day.', 'Get paid.', 'Go home.'],
    sub: 'Every job, customer and payment in one place, on your phone and here.',
    screen: 'jobs',
    chips: [
      { icon: 'paid', title: 'Paid £140', detail: 'Harlow Lettings, by card', at: 'left-0 top-[60px]' },
      { icon: 'invoice', title: 'Invoice sent', detail: 'INV-0142 to Mrs Platt', at: 'right-[-24px] top-[300px]' },
      { icon: 'text', title: 'Text sent', detail: 'On my way, about 10 minutes', at: 'left-[-24px] top-[430px]' },
    ],
    label: "A drawn preview of the WorkWise phone app: today's 8 jobs worth £1,240, with a card payment, an invoice and a text going out.",
  },
  rounds: {
    tag: 'WorkWise Rounds',
    lines: ['Run your round.', 'Get paid.', 'Go home.'],
    sub: 'Card, Direct Debit and Pay by Bank. Books ready for your accountant.',
    screen: 'stops',
    chips: [
      { icon: 'paid', title: 'Paid £18', detail: 'Mrs Shaw, by card', at: 'left-0 top-[60px]' },
      { icon: 'text', title: 'Text sent to No. 5', detail: 'Cleaning tomorrow morning', at: 'right-[-24px] top-[300px]' },
      { icon: 'invoice', title: '£1,240 by Direct Debit', detail: '52 customers, all collected', at: 'left-[-24px] top-[430px]' },
    ],
    label: "A drawn preview of the WorkWise Rounds phone app: today's round of 24 stops worth £486, with a card payment, a reminder text and Direct Debits collected.",
  },
  lite: {
    tag: 'WorkWise Lite',
    lines: ['Your website', 'quotes like', 'you do.'],
    sub: 'It learns your prices in a 15-minute chat, then answers enquiries day and night.',
    screen: 'chat',
    chips: [
      { icon: 'night', title: 'Answered at 21:40', detail: 'While you had your tea', at: 'left-0 top-[60px]' },
      { icon: 'lead', title: 'New lead: J. Morris', detail: '3-bed semi, £22 every 4 weeks', at: 'right-[-24px] top-[300px]' },
      { icon: 'booked', title: 'Booked in', detail: 'Thursday, 9:00', at: 'left-[-24px] top-[430px]' },
    ],
    label: 'A drawn preview of WorkWise Lite: the quote assistant on your website pricing a 3-bed semi at £22, the lead it hands you and the booking.',
  },
  both: {
    tag: 'Rounds + Lite',
    lines: ['Win the work.', 'Run the round.', 'Get paid.'],
    sub: 'Your website quotes for you, and won enquiries land straight on your round.',
    screen: 'stops',
    chips: [
      { icon: 'lead', title: 'New lead: J. Morris', detail: 'Quoted £22 on your website', at: 'left-0 top-[60px]' },
      { icon: 'booked', title: 'Added to your round', detail: 'Thursday, after No. 7', at: 'right-[-24px] top-[300px]' },
      { icon: 'paid', title: 'Paid £18', detail: 'Mrs Shaw, by card', at: 'left-[-24px] top-[430px]' },
    ],
    label: "A drawn preview of WorkWise: today's round of 24 stops worth £486, a new enquiry from your website and it joining your round.",
  },
};

const CHIP_ICON = {
  paid: { Icon: Check, bg: 'bg-emerald-500' },
  text: { Icon: MessageSquare, bg: 'bg-[#0C66E4]' },
  invoice: { Icon: Receipt, bg: 'bg-[#0A1A2E]' },
  lead: { Icon: UserPlus, bg: 'bg-[#9B30D9]' },
  booked: { Icon: Check, bg: 'bg-[#F0A500]' },
  night: { Icon: Sparkles, bg: 'bg-[#9B30D9]' },
} as const;

function NoticeChip({ chip, delay }: { chip: Chip; delay: number }) {
  const { Icon, bg } = CHIP_ICON[chip.icon];
  return (
    <div
      className={cn(
        'auth-chip absolute z-20 flex w-[232px] items-center gap-3 rounded-2xl bg-white/95 p-3 text-[#0A1A2E]',
        'shadow-[0_20px_40px_-18px_rgba(10,20,50,0.55)] ring-1 ring-black/5',
        chip.at
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <span className={cn('flex size-9 flex-shrink-0 items-center justify-center rounded-xl text-white', bg)}>
        <Icon className="size-[18px]" strokeWidth={2.5} aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold leading-tight">{chip.title}</p>
        <p className="mt-0.5 truncate text-[12px] text-[#5E6B7D]">{chip.detail}</p>
      </div>
    </div>
  );
}

// ── Phone screens ──────────────────────────────────────────────

const ROUND = [
  { name: 'Mrs Platt', place: '1 Elm Road', price: '£16', done: true },
  { name: 'Mrs Shaw', place: '3 Elm Road', price: '£18', done: true },
  { name: 'No. 5', place: '5 Elm Road', price: '£16', done: true },
  { name: 'Dr Khan', place: '9 Elm Road', price: '£22', done: false },
  { name: 'The Oaks', place: '2 Mill Lane', price: '£30', done: false },
  { name: 'Mr Ellis', place: '6 Mill Lane', price: '£16', done: false },
];

const JOBS = [
  { name: 'Mrs Platt', place: '09:00, 1 Elm Road', price: '£85', done: true },
  { name: 'Harlow Lettings', place: '11:30, 14 Mill Lane', price: '£140', done: true },
  { name: 'Mr Ellis', place: '13:00, 6 Mill Lane', price: '£220', done: false },
  { name: 'The Oaks', place: '15:00, 2 Mill Lane', price: '£180', done: false },
  { name: 'Dr Khan', place: '16:30, 9 Elm Road', price: '£95', done: false },
];

function DayScreen({ voice }: { voice: 'stops' | 'jobs' }) {
  const rows = voice === 'stops' ? ROUND : JOBS;
  const head =
    voice === 'stops'
      ? { total: '£486', line: '24 stops, 9 done', progress: 37 }
      : { total: '£1,240', line: '8 jobs, 2 done', progress: 25 };
  const next = rows.findIndex((r) => !r.done);
  return (
    <>
      <div className="bg-[#0C66E4] px-4 pb-4 pt-9 text-white">
        <div className="flex items-center justify-between text-[12px] font-semibold">
          <span>Tuesday 6 October</span>
          <span className="flex items-center gap-1">
            <CloudSun className="size-3.5" aria-hidden />
            14°, dry
          </span>
        </div>
        <p className="mt-3 text-[34px] font-semibold leading-none tracking-[-0.03em]">{head.total}</p>
        <p className="mt-1.5 text-[12px] text-white/80">{head.line}</p>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/25">
          <span className="auth-bar block h-full rounded-full bg-white" style={{ width: `${head.progress}%` }} />
        </div>
      </div>
      <div className="space-y-1.5 bg-[#F2F4F8] p-2.5">
        {rows.map((r, i) => (
          <div
            key={r.name}
            className={cn(
              'flex items-center gap-2.5 rounded-xl border-[1.5px] bg-white px-2.5 py-2',
              i === next ? 'border-[#0C66E4]' : 'border-transparent',
              r.done && 'opacity-60'
            )}
          >
            <span
              className={cn(
                'flex size-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                r.done ? 'bg-emerald-500 text-white' : i === next ? 'bg-[#0C66E4] text-white' : 'border-2 border-[#CBD5E1] text-[#64748B]'
              )}
            >
              {r.done ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn('truncate text-[13px] font-semibold', r.done && 'line-through decoration-[#94A3B8]')}>{r.name}</p>
              <p className="truncate text-[11px] text-[#64748B]">{r.place}</p>
            </div>
            {i === next ? (
              <span className="flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                <Navigation className="size-2.5" aria-hidden />
                Next
              </span>
            ) : (
              <span className="text-[13px] font-semibold">{r.price}</span>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function ChatScreen() {
  return (
    <>
      <div className="flex items-center gap-2.5 border-b border-[#EEE9F3] bg-white px-4 pb-3 pt-9">
        <span className="flex size-8 items-center justify-center rounded-full bg-[#9B30D9] text-white">
          <Sparkles className="size-4" aria-hidden />
        </span>
        <div>
          <p className="text-[13px] font-semibold">Dave&apos;s Window Cleaning</p>
          <p className="text-[11px] text-emerald-600">Replies straight away</p>
        </div>
      </div>
      <div className="space-y-2 bg-[#FAF7FD] p-3 text-[12.5px] leading-snug">
        <p className="ml-auto w-fit max-w-[82%] rounded-2xl rounded-br-md bg-white px-3 py-2 shadow-sm">
          Hi, how much for a 3-bed semi, front and back?
        </p>
        <p className="w-fit max-w-[86%] rounded-2xl rounded-bl-md bg-[#9B30D9] px-3 py-2 text-white">
          That&apos;s £22 every four weeks, frames and sills included.
        </p>
        <p className="w-fit max-w-[86%] rounded-2xl rounded-bl-md bg-[#9B30D9] px-3 py-2 text-white">
          Dave could start Thursday. Shall I book you in?
        </p>
        <p className="ml-auto w-fit max-w-[82%] rounded-2xl rounded-br-md bg-white px-3 py-2 shadow-sm">Yes please!</p>
        <div className="flex gap-1 px-1 pt-1" aria-hidden>
          <span className="auth-dot size-1.5 rounded-full bg-[#9B30D9]/50" />
          <span className="auth-dot size-1.5 rounded-full bg-[#9B30D9]/50 [animation-delay:150ms]" />
          <span className="auth-dot size-1.5 rounded-full bg-[#9B30D9]/50 [animation-delay:300ms]" />
        </div>
      </div>
    </>
  );
}

function Phone({ screen }: { screen: 'stops' | 'jobs' | 'chat' }) {
  return (
    <div className="auth-phone relative w-[292px] rounded-[44px] bg-[#0A1220] p-2.5 shadow-[0_40px_80px_-30px_rgba(5,10,30,0.7)] ring-1 ring-white/20">
      <div className="relative h-[560px] overflow-hidden rounded-[36px] bg-white text-[#0A1A2E]">
        <span aria-hidden className="absolute left-1/2 top-2.5 z-10 h-[22px] w-[86px] -translate-x-1/2 rounded-full bg-[#0A1220]" />
        {screen === 'chat' ? <ChatScreen /> : <DayScreen voice={screen} />}
      </div>
    </div>
  );
}

const WEEK: Record<AuthSide, { title: string; total: string; bars: number[]; ink: string }> = {
  neutral: { title: 'Paid this week', total: '£4,860', bars: [7, 9, 6, 8, 5], ink: '#0C66E4' },
  rounds: { title: 'Paid this week', total: '£1,578', bars: [21, 24, 18, 22, 16], ink: '#0C66E4' },
  lite: { title: 'Enquiries this week', total: '14 answered', bars: [2, 4, 1, 3, 4], ink: '#9B30D9' },
  both: { title: 'Paid this week', total: '£1,578', bars: [21, 24, 18, 22, 16], ink: '#5A47E0' },
};

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function WeekCard({ side }: { side: AuthSide }) {
  const { title, total, bars, ink } = WEEK[side];
  const lo = Math.min(...bars);
  const hi = Math.max(...bars);
  return (
    <div
      className="auth-chip w-[248px] rounded-2xl bg-white/95 p-4 text-[#0A1A2E] shadow-[0_20px_40px_-18px_rgba(10,20,50,0.55)] ring-1 ring-black/5"
      style={{ animationDelay: '1900ms' }}
    >
      <p className="text-[12px] font-medium text-[#5E6B7D]">{title}</p>
      <p className="mt-0.5 text-[22px] font-semibold tabular-nums tracking-[-0.02em]">{total}</p>
      <div className="mt-3 flex h-14 items-end gap-2">
        {bars.map((b, i) => (
          <div key={WEEKDAYS[i]} className="flex flex-1 flex-col items-center gap-1">
            <span
              className="auth-grow w-full rounded-md"
              style={{
                height: `${Math.round(12 + ((b - lo) / (hi - lo || 1)) * 30)}px`,
                background: i === 1 ? ink : `${ink}33`,
                animationDelay: `${2000 + i * 80}ms`,
              }}
            />
            <span className="text-[10px] font-medium text-[#8A94A6]">{WEEKDAYS[i]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── The window ─────────────────────────────────────────────────

const MOTION = `
@keyframes auth-rise { from { opacity: 0; transform: translateY(60px) rotate(4deg) } to { opacity: 1; transform: rotate(4deg) } }
@keyframes auth-pop { from { opacity: 0; transform: translateY(14px) scale(.96) } to { opacity: 1; transform: none } }
@keyframes auth-fill { from { width: 0 } }
@keyframes auth-grow { from { transform: scaleY(0) } }
@keyframes auth-dot { 0%, 60%, 100% { opacity: .35 } 30% { opacity: 1 } }
.auth-phone { transform: rotate(4deg); animation: auth-rise .9s cubic-bezier(.2,.8,.2,1) both }
.auth-chip { animation: auth-pop .55s cubic-bezier(.2,.8,.2,1) both }
.auth-bar { animation: auth-fill 1.2s cubic-bezier(.6,0,.2,1) .7s both }
.auth-dot { animation: auth-dot 1.2s ease-in-out infinite }
.auth-grow { transform-origin: bottom; animation: auth-grow .6s cubic-bezier(.2,.8,.2,1) both }
@media (prefers-reduced-motion: reduce) { .auth-phone, .auth-chip, .auth-bar, .auth-grow { animation: none } .auth-dot { animation: none; opacity: .6 } }
`;

/** Big soft rings and a fine grid, so the colour has depth without a photo. */
function WindowBackdrop() {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.14] [background-image:linear-gradient(rgba(255,255,255,.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.6)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_70%_70%,#000_10%,transparent_70%)]"
      />
      <span aria-hidden className="pointer-events-none absolute -bottom-40 -right-24 size-[620px] rounded-full border-[60px] border-white/[0.07]" />
      <span aria-hidden className="pointer-events-none absolute -bottom-10 right-28 size-[360px] rounded-full bg-white/[0.08] blur-2xl" />
      <span aria-hidden className="pointer-events-none absolute -left-20 -top-28 size-[340px] rounded-full border-[40px] border-white/[0.06]" />
    </>
  );
}

/** The brand side of `AuthShell` at 1024 px and wider: a framed, rounded window. */
export function AuthSidePanel({
  side,
  className,
  children,
}: {
  side: AuthSide;
  className?: string;
  children?: React.ReactNode;
}) {
  const { tag, lines, sub, screen, chips, label } = SIDES[side];
  return (
    <aside className={cn('h-full min-h-0 p-3', className)}>
      <style>{MOTION}</style>
      <div
        className="relative flex h-full w-full flex-col overflow-hidden rounded-[28px] px-14 pt-14 text-white"
        style={{ background: WINDOW_BG[side] }}
      >
        <WindowBackdrop />
        {children}

        <div className="relative z-10 max-w-[520px]">
          {tag ? (
            <span className="mb-6 inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-[13px] font-semibold ring-1 ring-inset ring-white/25">
              {tag}
            </span>
          ) : null}
          <h2 className="text-[48px] font-semibold leading-[0.98] tracking-[-0.04em] xl:text-[64px]">
            {lines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </h2>
          <p className="mt-5 max-w-[380px] text-pretty text-[16px] leading-relaxed text-white/80">{sub}</p>
        </div>

        <div
          role="img"
          aria-label={label}
          className="absolute bottom-0 right-[6%] h-[560px] w-[480px] origin-bottom-right scale-[0.8] xl:scale-100"
        >
          <div className="absolute bottom-[-150px] left-[110px]">
            <Phone screen={screen} />
          </div>
          {chips.map((chip, i) => (
            <NoticeChip key={chip.title} chip={chip} delay={700 + i * 380} />
          ))}
        </div>

        <div aria-hidden className="absolute bottom-14 left-14 z-10 hidden min-[1360px]:block">
          <WeekCard side={side} />
        </div>
      </div>
    </aside>
  );
}

/** The brand side shrunk to a colour banner, below 1024 px. */
export function AuthSideStrip({
  side,
  className,
  children,
}: {
  side: AuthSide;
  className?: string;
  children: React.ReactNode;
}) {
  const { lines, chips } = SIDES[side];
  const first = chips[0];
  const { Icon, bg } = CHIP_ICON[first.icon];
  return (
    <header className={cn('p-3 pb-0', className)}>
      <div className="relative overflow-hidden rounded-[22px] px-4 pb-4 pt-3.5 text-white" style={{ background: WINDOW_BG[side] }}>
        <span aria-hidden className="pointer-events-none absolute -right-16 -top-20 size-[220px] rounded-full border-[28px] border-white/[0.08]" />
        <div className="relative flex items-center justify-between">{children}</div>
        <p className="relative mt-4 text-[24px] font-semibold leading-[1.02] tracking-[-0.035em]">
          {lines.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </p>
        <div className="relative mt-4 flex w-fit items-center gap-2.5 rounded-xl bg-white/95 py-2 pl-2 pr-3.5 text-[#0A1A2E] shadow-[0_12px_24px_-14px_rgba(10,20,50,0.6)]">
          <span className={cn('flex size-7 items-center justify-center rounded-lg text-white', bg)}>
            <Icon className="size-4" strokeWidth={2.5} aria-hidden />
          </span>
          <div>
            <p className="text-[12px] font-semibold leading-tight">{first.title}</p>
            <p className="text-[11px] text-[#5E6B7D]">{first.detail}</p>
          </div>
        </div>
      </div>
    </header>
  );
}

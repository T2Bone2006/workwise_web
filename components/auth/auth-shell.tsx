import Image from 'next/image';
import { AlertCircle } from 'lucide-react';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { AuthSidePanel, AuthSideStrip, SIDE_COLOUR, type AuthSide } from '@/components/auth/auth-side-panel';
import { cn } from '@/lib/utils';

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://joinworkwise.com').replace(
  /\/$/,
  ''
);

export const authLabelClassName = 'text-sm font-medium text-[#0A1A2E] dark:text-[#EAF1FB]';

/** 16 px text at every width so iOS never zooms into the field. */
export const authInputClassName = cn(
  'h-12 rounded-xl px-4 text-base md:text-base shadow-none backdrop-blur-none',
  'border-[#C9C7C1] bg-white text-[#0A1A2E] placeholder:text-[#928E88]',
  'focus-visible:border-[#0C66E4] focus-visible:ring-4 focus-visible:ring-[#0C66E4]/15 focus-visible:shadow-none',
  'dark:border-white/15 dark:bg-[#0A1526] dark:text-[#EAF1FB] dark:placeholder:text-[#6F7F96] dark:backdrop-blur-none',
  'dark:focus-visible:border-[#5B8FE8] dark:focus-visible:ring-[#5B8FE8]/25 dark:focus-visible:shadow-none'
);

export const authButtonClassName = cn(
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#0C66E4] px-6',
  'text-[15px] font-semibold text-white transition-colors duration-200 hover:bg-[#0052CC]',
  'outline-none focus-visible:ring-4 focus-visible:ring-[#0C66E4]/30',
  'disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:bg-[#0C66E4]'
);

export const authSecondaryButtonClassName = cn(
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-[#D6D5D2] px-6',
  'text-[15px] font-semibold text-[#0F2347] transition-colors duration-200 hover:bg-[#F5F5F2]',
  'outline-none focus-visible:ring-4 focus-visible:ring-[#0C66E4]/30',
  'dark:border-white/15 dark:text-[#EAF1FB] dark:hover:bg-white/5'
);

export const authLinkClassName =
  'rounded-sm font-medium text-[#0C66E4] underline-offset-4 outline-none hover:text-[#0052CC] hover:underline focus-visible:ring-2 focus-visible:ring-[#0C66E4]/40 dark:text-[#7FAAF0] dark:hover:text-[#A8C3EC]';

export function AuthAlert({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm leading-relaxed text-red-800 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-200"
    >
      <AlertCircle className="mt-0.5 size-4 flex-shrink-0" aria-hidden />
      <p>{children}</p>
    </div>
  );
}

function Wordmark({ onDark }: { onDark?: boolean }) {
  return (
    <a
      href={SITE_URL}
      className={cn(
        'inline-flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[#0C66E4]/40',
        onDark && '[&>span]:!text-white'
      )}
    >
      <Image
        src="/workwise_logo.png"
        alt=""
        width={32}
        height={32}
        className="size-8 object-contain"
        priority
      />
      <span className="text-[17px] font-semibold tracking-tight text-[#0A1A2E] dark:text-[#EAF1FB]">
        WorkWise
      </span>
    </a>
  );
}

/** Plan → Your details → Pay, as three bars. Pay happens on Stripe's page. */
function SignupSteps({ step, side }: { step: 1 | 2; side: AuthSide }) {
  const names = ['Plan', 'Your details', 'Pay'];
  return (
    <ol aria-label={`Step ${step} of 3`} className="mb-5 grid grid-cols-3 gap-2">
      {names.map((name, i) => {
        const reached = i < step;
        return (
          <li key={name} aria-current={i === step - 1 ? 'step' : undefined}>
            <span
              aria-hidden
              className={cn('block h-1 rounded-full', !reached && 'bg-[#E6E5E0] dark:bg-white/10')}
              style={reached ? { background: SIDE_COLOUR[side] } : undefined}
            />
            <span
              className={cn(
                'mt-2 block text-[12px] font-medium',
                reached ? 'text-[#0A1A2E] dark:text-[#EAF1FB]' : 'text-[#928E88] dark:text-[#6F7F96]'
              )}
            >
              {name}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Shared frame for the log-in, password and sign-up pages: the form on the
 * left, the drawn brand side on the right. Below 1024 px the brand side
 * shrinks to a strip above the form.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  side = 'neutral',
  step,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  side?: AuthSide;
  /** Sign-up only: where they are in plan → details → pay. */
  step?: 1 | 2;
}) {
  return (
    <div className="auth-shell relative flex min-h-dvh flex-col bg-white text-[#0A1A2E] dark:bg-[#0B1627] dark:text-[#EAF1FB] lg:grid lg:h-dvh lg:max-h-dvh lg:grid-cols-[minmax(440px,520px)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
      <AuthSideStrip side={side} className="lg:hidden">
        <Wordmark onDark />
        <ThemeToggle className="text-white/80 hover:bg-white/10 hover:text-white dark:text-white/80 dark:hover:bg-white/10" />
      </AuthSideStrip>

      {/* pr-9 is pl-12 minus the side panel's left padding, so the form sits in the middle of the white column. */}
      <div className="flex flex-1 flex-col px-5 pb-6 pt-8 sm:px-10 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:py-4 lg:pl-12 lg:pr-9">
        <div className="mx-auto hidden w-full max-w-[400px] lg:block">
          <Wordmark />
        </div>

        <main className="flex flex-1 items-center">
          <div className="mx-auto w-full max-w-[400px] py-6 lg:py-0">
            {step ? <SignupSteps step={step} side={side} /> : null}
            <h1 className="text-[30px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[36px]">
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-2 text-pretty text-[15px] leading-relaxed text-[#5E5A54] dark:text-[#A9B6C8]">
                {subtitle}
              </p>
            ) : null}
            <div className="mt-6">{children}</div>
          </div>
        </main>

        <footer className="mx-auto mt-6 flex w-full max-w-[400px] flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-[#6E6A63] dark:text-[#8696AC] lg:mt-0 lg:justify-start">
          <span>© WorkWise</span>
          <span aria-hidden>·</span>
          <a href={`${SITE_URL}/privacy`} className="rounded-sm hover:text-[#0A1A2E] hover:underline dark:hover:text-[#EAF1FB]">
            Privacy
          </a>
          <span aria-hidden>·</span>
          <a href={`${SITE_URL}/terms`} className="rounded-sm hover:text-[#0A1A2E] hover:underline dark:hover:text-[#EAF1FB]">
            Terms
          </a>
        </footer>
      </div>

      <AuthSidePanel side={side} className="hidden lg:flex">
        <ThemeToggle className="absolute right-5 top-5 z-20 text-white/80 hover:bg-white/10 hover:text-white dark:text-white/80 dark:hover:bg-white/10" />
      </AuthSidePanel>
    </div>
  );
}

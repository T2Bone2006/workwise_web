import { Tag } from '@/components/look/tag';

/**
 * The three code-drawn scenes on the Add Lite page: a customer chats on the website,
 * the trader accepts on a phone, the job lands on the round. Drawn from the site's
 * Lite renderings; they carry no real data.
 */

function Bot() {
  return (
    <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-(--look-lite-pill) text-[9px] font-bold text-white">
      W
    </span>
  );
}

export function WebsiteScene() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-(--look-card-shadow)" aria-hidden>
      <div className="flex items-center gap-1.5 border-b border-border bg-muted/50 px-3 py-2">
        <span className="size-1.5 rounded-full bg-border" />
        <span className="size-1.5 rounded-full bg-border" />
        <span className="size-1.5 rounded-full bg-border" />
        <span className="ml-2 flex-1 rounded-full bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
          your-website.co.uk
        </span>
      </div>
      <div className="flex flex-col gap-2 p-3">
        <p className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-foreground px-2.5 py-1.5 text-[12px] leading-snug text-background">
          How much for the front windows?
        </p>
        <div className="flex items-end gap-1.5">
          <Bot />
          <p className="max-w-[85%] rounded-2xl rounded-bl-md bg-muted px-2.5 py-1.5 text-[12px] leading-snug">
            Front and back is £18. I can do Thursday.
          </p>
        </div>
        <p className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-foreground px-2.5 py-1.5 text-[12px] leading-snug text-background">
          Lovely, book me in.
        </p>
      </div>
    </div>
  );
}

export function PhoneScene() {
  return (
    <div className="mx-auto w-[168px] rounded-[26px] border-[5px] border-foreground/90 bg-background p-2 shadow-(--look-card-shadow)" aria-hidden>
      <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-border" />
      <p className="text-[10px] font-medium text-muted-foreground">New booking</p>
      <div className="mt-1.5 rounded-xl border border-border bg-card p-2.5">
        <p className="text-[13px] leading-tight font-semibold">Sarah Bennett</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">Front windows · Thursday</p>
        <p className="mt-1.5 text-[15px] leading-none font-semibold tabular-nums">£18</p>
        <div className="mt-2.5 grid grid-cols-[1fr_auto] gap-1.5">
          <span className="rounded-lg bg-(--look-lite-pill) py-1.5 text-center text-[11px] font-semibold text-white">Accept</span>
          <span className="rounded-lg border border-border px-2 py-1.5 text-center text-[11px] font-medium text-muted-foreground">
            Not now
          </span>
        </div>
      </div>
    </div>
  );
}

export function RoundScene() {
  const rows = [
    { name: 'Mr Okafor', note: 'Every 4 weeks · windows', mine: false },
    { name: 'Sarah Bennett', note: 'One-off · front windows', mine: true },
    { name: 'Mrs Patel', note: 'Every 4 weeks · windows', mine: false },
  ];
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-(--look-card-shadow)" aria-hidden>
      <div className="flex items-center justify-between border-b border-border bg-muted/50 px-3 py-2">
        <p className="text-[11px] font-semibold">Thursday</p>
        <p className="text-[10px] text-muted-foreground tabular-nums">3 visits</p>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((row) => (
          <li
            key={row.name}
            className={row.mine ? 'bg-(--tone-lite-soft) px-3 py-2.5' : 'px-3 py-2.5'}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-[12px] font-semibold">{row.name}</p>
              {row.mine ? <Tag tone="lite" className="px-1.5 py-px text-[10px]">From Lite</Tag> : null}
            </div>
            <p className="text-[10.5px] text-muted-foreground">{row.note}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

import Link from 'next/link';
import { Building2, CircleCheck, Ban, UserRound } from 'lucide-react';
import { Avatar, IconChip, LookCard, Tag } from '@/components/look';
import type { WorkerProfile } from '@/lib/data/worker/profile';

const TYPE_LABEL: Record<WorkerProfile['workerType'], string> = {
  employee: 'Employee',
  company_subcontractor: 'Subcontractor',
  both: 'Employee and subcontractor',
};

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid gap-0.5 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[9rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={value ? 'text-sm font-medium break-words' : 'text-sm text-muted-foreground'}>{value ?? 'Not set'}</dd>
    </div>
  );
}

/** Who you are and who you work for. */
export function ProfileHeader({ profile }: { profile: WorkerProfile }) {
  return (
    <header className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-(--tone-rounds-soft) via-card to-(--tone-sky-soft) px-5 py-5 ring-1 ring-border">
      <Avatar name={profile.fullName} tone="rounds" size="lg" />
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{profile.fullName}</h1>
        <p className="mt-0.5 truncate text-sm text-muted-foreground">Works for {profile.employerName}</p>
        <div className="mt-2">
          <Tag tone="rounds">{TYPE_LABEL[profile.workerType]}</Tag>
        </div>
      </div>
    </header>
  );
}

export function ProfileStats({ profile }: { profile: WorkerProfile }) {
  const items = [
    { href: '/worker/jobs?tab=done', icon: CircleCheck, tone: 'emerald' as const, label: 'Jobs done', value: profile.jobsDone },
    { href: '/worker/jobs?tab=declined', icon: Ban, tone: 'rose' as const, label: 'Jobs declined', value: profile.jobsDeclined },
  ];
  return (
    <LookCard title="Your jobs" icon={UserRound} tone="rounds">
      <div className="grid grid-cols-2 gap-3">
        {items.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="flex items-center gap-3 rounded-xl border border-border px-3 py-3 transition-colors hover:border-(--tone-rounds-solid)/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <IconChip icon={item.icon} tone={item.tone} />
            <span className="min-w-0">
              <span className="block text-2xl leading-none font-semibold tabular-nums">{item.value}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{item.label}</span>
            </span>
          </Link>
        ))}
      </div>
    </LookCard>
  );
}

export function ProfileDetails({ profile }: { profile: WorkerProfile }) {
  return (
    <LookCard title="Your details" icon={Building2} tone="teal">
      <dl className="divide-y divide-border">
        <Detail label="Phone" value={profile.phone} />
        <Detail label="Email" value={profile.email || null} />
        <Detail label="Home postcode" value={profile.homePostcode} />
        <Detail label="Skills" value={profile.skills.length > 0 ? profile.skills.join(', ') : null} />
      </dl>
      <p className="mt-4 text-xs text-muted-foreground">
        {profile.employerName} keeps these up to date. Ask them if something is wrong.
      </p>
    </LookCard>
  );
}

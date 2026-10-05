import type { ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { IconChip, Tag } from '@/components/look';
import type { DraftProfile } from '@/lib/lite/interview-schema';

function pounds(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  if (Number.isInteger(rounded)) return `£${rounded}`;
  return `£${rounded.toFixed(2)}`;
}

function givenMoney(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function Section({ title, children, empty }: { title: string; children: ReactNode; empty: boolean }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {empty ? <p className="text-sm text-muted-foreground">Not covered yet</p> : children}
    </div>
  );
}

function LearntBody({ draft }: { draft: DraftProfile }) {
  const summary = draft.areas?.summary?.trim() ?? '';
  const postcodes = (draft.areas?.postcodes ?? []).map((code) => code.trim()).filter((code) => code !== '');
  const jobs = draft.job_types ?? [];
  const rates = [
    { label: 'Call-out', amount: givenMoney(draft.callout_fee) },
    { label: 'Hourly', amount: givenMoney(draft.hourly_rate) },
    { label: 'Day', amount: givenMoney(draft.day_rate) },
    { label: 'Minimum', amount: givenMoney(draft.minimum_charge) },
  ].filter((rate): rate is { label: string; amount: number } => rate.amount != null);
  const rules = (draft.rules ?? []).map((rule) => rule.trim()).filter((rule) => rule !== '');

  return (
    <div className="space-y-4">
      <Section title="Areas" empty={summary === '' && postcodes.length === 0}>
        {summary !== '' ? <p className="text-sm">{summary}</p> : null}
        {postcodes.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {postcodes.map((code, index) => (
              <li key={`${code}-${index}`}>
                <Tag tone="slate">{code}</Tag>
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      <Section title="Your work" empty={jobs.length === 0}>
        <ul className="space-y-2">
          {jobs.map((job) => {
            const visit = job.how_priced === 'needs_visit';
            const range =
              !visit && job.guide_min != null && job.guide_max != null && job.guide_min <= job.guide_max
                ? `${pounds(job.guide_min)}–${pounds(job.guide_max)}`
                : null;
            return (
              <li key={job.key} className="space-y-1">
                <p className="text-sm font-medium">{job.name}</p>
                <p className="flex flex-wrap items-center gap-2">
                  <Tag tone={visit ? 'amber' : 'emerald'}>{visit ? 'Needs a visit' : 'Priced from a description'}</Tag>
                  {range ? <span className="text-sm text-foreground">{range}</span> : null}
                </p>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="Rates" empty={rates.length === 0}>
        <ul className="space-y-1 text-sm">
          {rates.map((rate) => (
            <li key={rate.label}>
              {rate.label} {pounds(rate.amount)}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Rules" empty={rules.length === 0}>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {rules.map((rule, index) => (
            <li key={`${rule}-${index}`}>{rule}</li>
          ))}
        </ul>
      </Section>

      <p className="text-xs text-muted-foreground">
        You can check and change all of this later from Widget, under How you price.
      </p>
    </div>
  );
}

export function LearntPanel({ draft, collapsible = false }: { draft: DraftProfile; collapsible?: boolean }) {
  if (collapsible) {
    return (
      <details className="glass-card min-w-0 rounded-xl">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm font-medium">
          <IconChip icon={Sparkles} tone="lite" size="sm" />
          What it&apos;s learnt
        </summary>
        <div className="px-4 pb-4">
          <LearntBody draft={draft} />
        </div>
      </details>
    );
  }

  return (
    <section className="glass-card min-w-0 space-y-4 rounded-xl p-4">
      <h2 className="flex items-center gap-3 text-sm font-medium">
        <IconChip icon={Sparkles} tone="lite" size="sm" />
        What it&apos;s learnt so far
      </h2>
      <LearntBody draft={draft} />
    </section>
  );
}

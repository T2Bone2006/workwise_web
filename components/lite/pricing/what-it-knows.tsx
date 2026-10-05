import type { ReactNode } from 'react';
import { MapPin, PoundSterling, ScrollText, Sparkles, Wrench } from 'lucide-react';
import { WorkTable } from '@/components/lite/pricing/work-table';
import type { PriceProfile } from '@/lib/lite/profile-schema';

function pounds(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  if (Number.isInteger(rounded)) return `£${rounded}`;
  return `£${rounded.toFixed(2)}`;
}

function Chip({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`flex size-7 shrink-0 items-center justify-center rounded-full ${className}`}>{children}</span>;
}

function Section({
  title,
  chip,
  children,
}: {
  title: string;
  chip: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border border-border bg-card shadow-(--look-card-shadow) min-w-0 space-y-3 rounded-2xl p-4">
      <h2 className="flex items-center gap-3 text-sm font-medium">
        {chip}
        {title}
      </h2>
      {children}
    </section>
  );
}

export function WhatItKnows({ profile }: { profile: PriceProfile }) {
  const rates = [
    profile.callout_fee != null ? `Call-out ${pounds(profile.callout_fee)}` : null,
    profile.hourly_rate != null ? `Hourly ${pounds(profile.hourly_rate)}` : null,
    profile.day_rate != null ? `Day rate ${pounds(profile.day_rate)}` : null,
    profile.minimum_charge != null ? `Minimum charge ${pounds(profile.minimum_charge)}` : null,
    profile.materials.trim() !== '' ? `Materials: ${profile.materials.trim()}` : null,
  ].filter((line): line is string => line != null);
  const rules = profile.rules.map((rule) => rule.trim()).filter((rule) => rule !== '');
  const miles = profile.areas.max_miles;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Section
        title="Your work"
        chip={
          <Chip className="bg-(--tone-emerald-soft) text-(--tone-emerald-text)">
            <Wrench className="size-4" />
          </Chip>
        }
      >
        <p className="text-sm text-muted-foreground">
          Each kind of work is either priced from the customer&apos;s description, or left for a visit. The switch accepts a booking without you tapping accept.
        </p>
        <WorkTable jobs={profile.job_types} />
      </Section>

      <Section
        title="Where you work"
        chip={
          <Chip className="bg-(--tone-rounds-soft) text-(--tone-rounds-text)">
            <MapPin className="size-4" />
          </Chip>
        }
      >
        {profile.areas.summary.trim() !== '' ? <p className="text-sm">{profile.areas.summary}</p> : null}
        {profile.areas.postcodes.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {profile.areas.postcodes.map((code, index) => (
              <li
                key={`${code}-${index}`}
                className="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs font-medium text-sky-800 dark:text-sky-200"
              >
                {code}
              </li>
            ))}
          </ul>
        ) : null}
        {miles != null ? <p className="text-sm">Up to {miles} miles</p> : null}
      </Section>

      <Section
        title="Your rates"
        chip={
          <Chip className="bg-(--tone-emerald-soft) text-(--tone-emerald-text)">
            <PoundSterling className="size-4" />
          </Chip>
        }
      >
        {rates.length === 0 ? (
          <p className="text-sm text-muted-foreground">No set rates. It prices from the kinds of work above.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {rates.map((rate) => (
              <li key={rate}>{rate}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Your rules"
        chip={
          <Chip className="bg-(--tone-amber-soft) text-(--tone-amber-text)">
            <ScrollText className="size-4" />
          </Chip>
        }
      >
        {rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">No special rules.</p>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {rules.map((rule, index) => (
              <li key={`${rule}-${index}`}>{rule}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Example jobs"
        chip={
          <Chip className="bg-(--tone-lite-soft) text-(--tone-lite-text)">
            <Sparkles className="size-4" />
          </Chip>
        }
      >
        {profile.example_jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No example jobs yet.</p>
        ) : (
          <ul className="space-y-3 text-sm">
            {profile.example_jobs.map((job, index) => (
              <li key={`${job.description}-${index}`} className="space-y-1 rounded-lg border border-border/70 p-3">
                <p className="text-base font-semibold">{pounds(job.price)}</p>
                <p>{job.description}</p>
                <p className="text-muted-foreground">Why: {job.reasoning}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

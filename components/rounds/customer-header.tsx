'use client';

import { useState } from 'react';
import { KeyRound, MapPin, Pencil, X } from 'lucide-react';
import { Avatar, CopyChip, Tag, type Tone } from '@/components/look';
import { Button } from '@/components/ui/button';
import { CustomerPlacesMapCard } from '@/components/rounds/customer-places-map';
import type { CustomerPlace } from '@/components/maps/customer-places-map';
import { formatUkPhoneDisplay } from '@/lib/utils/phone';

export type CustomerHeaderTag = { tone: Tone; label: string };

/**
 * The top of a Rounds customer's page: who they are, how to reach them
 * (tap to copy), where they live (a short map strip in the middle), anything
 * unusual about them, and the things you do most. Edit opens their details
 * right underneath, so there is no separate page or box for it.
 */
export function CustomerHeader({
  name,
  place,
  phone,
  phoneE164,
  email,
  accessNotes,
  tags,
  places,
  actions,
  editPanel,
}: {
  name: string;
  place: string | null;
  phone: string | null;
  phoneE164: string | null;
  email: string | null;
  accessNotes: string | null;
  tags: CustomerHeaderTag[];
  places: CustomerPlace[];
  /** The deactivate button, passed in so it keeps its own confirmation. */
  actions: React.ReactNode;
  /** The editable fields, shown when Edit is open. */
  editPanel: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const phoneLabel = formatUkPhoneDisplay(phoneE164) || phone?.trim() || null;
  const mapHref = place ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}` : null;
  const access = accessNotes?.trim() || null;

  return (
    <header className="rounded-2xl border border-border bg-card p-4 shadow-(--look-card-shadow) sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="flex min-w-0 gap-4 lg:max-w-[44%] lg:shrink-0">
          <Avatar name={name} tone="rounds" size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-[28px] sm:leading-9">{name}</h1>
              {tags.map((tag) => (
                <Tag key={tag.label} tone={tag.tone}>
                  {tag.label}
                </Tag>
              ))}
            </div>
            {place ? (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="size-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 truncate">{place}</span>
                {mapHref ? (
                  <a
                    href={mapHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 font-medium text-primary hover:underline"
                  >
                    Open map
                  </a>
                ) : null}
              </p>
            ) : null}
            {phoneLabel || email ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {phoneLabel ? <CopyChip kind="phone" label="Phone number" value={phoneLabel} /> : null}
                {email ? <CopyChip kind="email" label="Email" value={email} /> : null}
              </div>
            ) : null}
            {access ? (
              <p className="mt-2.5 flex items-start gap-1.5 text-sm text-amber-900 dark:text-amber-200">
                <KeyRound className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 whitespace-pre-wrap">{access}</span>
              </p>
            ) : null}
          </div>
        </div>

        {places.length > 0 ? (
          <div className="min-w-0 lg:flex-1">
            <CustomerPlacesMapCard places={places} compact />
          </div>
        ) : (
          <div className="hidden lg:block lg:flex-1" />
        )}

        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:self-start">
          <Button
            variant="outline"
            size="sm"
            aria-expanded={editing}
            onClick={() => setEditing((open) => !open)}
          >
            {editing ? <X className="mr-1.5 size-3.5" /> : <Pencil className="mr-1.5 size-3.5" />}
            {editing ? 'Close' : 'Edit'}
          </Button>
          {actions}
        </div>
      </div>

      {editing ? <div className="mt-4 border-t border-border pt-4">{editPanel}</div> : null}
    </header>
  );
}

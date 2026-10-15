'use client';

import { Check, Copy, Mail, Phone } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/** A contact detail you can tap to copy: the phone number, the email. */
export function CopyChip({
  kind,
  label,
  value,
  className,
}: {
  kind: 'phone' | 'email';
  /** What it is, for screen readers and the message ("Phone number"). */
  label: string;
  value: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const Icon = kind === 'phone' ? Phone : Mail;

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(`${label} copied`);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Couldn’t copy. Select it and copy by hand.');
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={`Copy ${label.toLowerCase()}: ${value}`}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate">{value}</span>
      {copied ? <Check className="size-3.5 shrink-0 text-(--tone-emerald-text)" aria-hidden /> : <Copy className="size-3 shrink-0 text-muted-foreground" aria-hidden />}
    </button>
  );
}

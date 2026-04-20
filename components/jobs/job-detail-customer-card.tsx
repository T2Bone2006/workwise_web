'use client';

import { Mail, Phone, User } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { CopyButton } from '@/components/jobs/copy-button';
import { cn } from '@/lib/utils';

interface JobDetailCustomerCardProps {
  name: string;
  type: string;
  email: string | null;
  phone: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  individual: 'Individual',
  bulk_client: 'Bulk client',
};

export function JobDetailCustomerCard({
  name,
  type,
  email,
  phone,
}: JobDetailCustomerCardProps) {
  const typeLabel = TYPE_LABELS[type] ?? type;

  return (
    <Card
      className={cn(
        'glass-card overflow-hidden border-border/80 transition-all duration-300',
        'backdrop-blur-[var(--blur-glass)] shadow-[var(--shadow-glass-value)]'
      )}
    >
      <CardHeader className="pb-3">
        <h2 className="text-base font-semibold text-foreground">Customer</h2>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <User className="size-4 shrink-0 text-muted-foreground" />
          <span className="font-medium text-foreground">{name || '—'}</span>
        </div>
        <span
          className={cn(
            'inline-flex rounded-full border border-sky-400/40 bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-400'
          )}
        >
          {typeLabel}
        </span>
        {email && (
          <div className="flex items-center gap-1">
            <Mail className="size-4 shrink-0 text-muted-foreground" />
            <a
              href={`mailto:${email}`}
              className="text-sm text-primary hover:underline truncate"
            >
              {email}
            </a>
            <CopyButton value={email} label="Copy email" />
          </div>
        )}
        {phone && (
          <div className="flex items-center gap-1">
            <Phone className="size-4 shrink-0 text-muted-foreground" />
            <a
              href={`tel:${phone}`}
              className="text-sm text-primary hover:underline"
            >
              {phone}
            </a>
            <CopyButton value={phone} label="Copy phone" />
          </div>
        )}
        {!email && !phone && (
          <p className="text-xs text-muted-foreground">No contact details</p>
        )}
      </CardContent>
    </Card>
  );
}

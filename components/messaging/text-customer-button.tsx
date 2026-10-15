'use client';

import { useState, type JSX } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? '';
  return first;
}

export function TextCustomerButton(props: {
  phone: string | null;
  name: string;
}): JSX.Element | null {
  const { phone, name } = props;
  const [copied, setCopied] = useState(false);
  if (!phone) return null;

  const digits = phone.replace(/\s+/g, '');
  const who = firstName(name);

  async function copy() {
    try {
      await navigator.clipboard.writeText(phone ?? '');
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy the number');
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button variant="outline" size="sm" asChild>
        <a href={`sms:${digits}`}>{who ? `Text ${who}` : 'Text'}</a>
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {copied ? 'Copied' : 'Copy number'}
      </Button>
    </span>
  );
}

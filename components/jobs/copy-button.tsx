'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface CopyButtonProps {
  value: string;
  label?: string;
  className?: string;
  size?: 'xs' | 'sm' | 'default' | 'lg' | 'icon' | 'icon-sm' | 'icon-lg' | 'icon-xs';
}

export function CopyButton({
  value,
  label,
  className,
  size = 'icon-xs',
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Failed to copy');
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size={size}
      className={cn('shrink-0 text-muted-foreground hover:text-foreground transition-all', className)}
      onClick={handleCopy}
      aria-label={label ?? 'Copy to clipboard'}
    >
      {copied ? (
        <Check className="size-3.5 text-emerald-500 animate-in zoom-in duration-200" />
      ) : (
        <Copy className="size-3.5" />
      )}
    </Button>
  );
}

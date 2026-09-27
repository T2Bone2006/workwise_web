'use client';

import { useRef, useState, type JSX } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function CopyField(props: {
  label: string;
  value: string;
  display?: string;
  hint?: string;
  highlighted?: boolean;
}): JSX.Element {
  const { label, value, display, hint, highlighted } = props;
  const shown = display ?? value;
  const textRef = useRef<HTMLSpanElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('clipboard unavailable');
      }
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      const node = textRef.current;
      if (node) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-lg px-3 py-2.5',
        highlighted
          ? 'border border-amber-500/40 bg-amber-500/10'
          : 'border border-transparent bg-muted/60',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="truncate text-sm font-semibold tabular-nums">
            <span ref={textRef}>{shown}</span>
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={copied ? 'Copied' : `Copy ${label}`}
          onClick={() => void copy()}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </Button>
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

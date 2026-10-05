'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function CopySnippet({ snippet }: { snippet: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="min-w-0 space-y-3">
      <pre className="max-w-full overflow-x-auto rounded-xl bg-navy-900 p-3.5 font-mono text-xs leading-relaxed text-navy-50">
        {snippet}
      </pre>
      <Button
        type="button"
        className="bg-(--tone-lite-solid) text-white hover:bg-(--tone-lite-solid)/90"
        onClick={() => void copy()}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

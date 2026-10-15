'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { startInterviewAction } from '@/lib/actions/lite/interview';
import { Button } from '@/components/ui/button';
import { litePaths } from '@/lib/navigation/lite-paths';

export function ComingSoonCard({ redoInProgress }: { redoInProgress: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function redo() {
    if (pending) return;
    setPending(true);
    const result = await startInterviewAction(true);
    if (!result.ok) {
      setPending(false);
      toast(result.error);
      return;
    }
    router.push(litePaths.setup);
    router.refresh();
  }

  return (
    <section className="border border-border bg-card shadow-(--look-card-shadow) min-w-0 space-y-3 rounded-2xl p-4">
      <h2 className="flex items-center gap-3 text-sm font-medium">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-(--tone-lite-soft) text-(--tone-lite-text)">
          <Sparkles className="size-4" />
        </span>
        Change an answer
      </h2>
      <p className="text-sm">
        You can&apos;t edit a price on this page. Redo the interview and the chat keeps using these answers until you finish.
      </p>
      <Button type="button" disabled={pending} onClick={() => void redo()}>
        {redoInProgress ? 'Carry on with your redo' : 'Redo the interview'}
      </Button>
    </section>
  );
}

import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import { Notice } from '@/components/look';
import { Button } from '@/components/ui/button';
import type { Stage } from '@/lib/lite/interview-schema';
import { litePaths } from '@/lib/navigation/lite-paths';

const NEXT: Record<Stage, string> = {
  areas: 'where you work',
  work: 'the jobs you do',
  pricing: 'what you charge',
  rules: 'when you take a job',
  examples: 'a few jobs you have already done',
  website: 'your website',
  done: 'the last step',
};

/** The unfinished set-up interview. A button, not a line of text. */
export function SetupBanner({ stage }: { stage?: Stage }) {
  const next = stage ? NEXT[stage] : null;
  return (
    <Notice
      tone="amber"
      icon={ClipboardList}
      title="Finish the interview"
      action={
        <Button asChild>
          <Link href={litePaths.setup}>Finish setting up</Link>
        </Button>
      }
    >
      {next
        ? `You're part-way through a short interview. Next it asks about ${next}. Until you finish, the assistant doesn't know your prices or the work you take, so it can't go on your website.`
        : "There's a short interview still open. Until you finish it, the assistant doesn't know your prices or the work you take, so it can't go on your website."}
    </Notice>
  );
}

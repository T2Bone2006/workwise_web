'use client';

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface JobDetailCompletionNotesProps {
  completionNotes: string;
}

export function JobDetailCompletionNotes({ completionNotes }: JobDetailCompletionNotesProps) {
  return (
    <Card
      className={cn(
        'glass-card overflow-hidden border-border/80 transition-all duration-300',
        'backdrop-blur-[var(--blur-glass)] shadow-[var(--shadow-glass-value)]'
      )}
    >
      <CardHeader className="pb-3">
        <h2 className="text-base font-semibold text-foreground">Completion notes</h2>
      </CardHeader>
      <CardContent>
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{completionNotes}</p>
      </CardContent>
    </Card>
  );
}

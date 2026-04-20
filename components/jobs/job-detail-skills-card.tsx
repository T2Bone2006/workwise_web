'use client';

import { CheckCircle, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { SKILL_LABELS } from '@/lib/constants/skills';
import { cn } from '@/lib/utils';

interface JobDetailSkillsCardProps {
  requiredSkills: string[];
  workerSkills?: string[] | null;
  hasWorker: boolean;
}

export function JobDetailSkillsCard({
  requiredSkills,
  workerSkills,
  hasWorker,
}: JobDetailSkillsCardProps) {
  const workerSet = new Set(workerSkills ?? []);
  const missing = requiredSkills.filter((s) => !workerSet.has(s));
  const allMatch = requiredSkills.length === 0 || missing.length === 0;

  return (
    <Card
      className={cn(
        'glass-card overflow-hidden border-border/80 transition-all duration-300',
        'backdrop-blur-[var(--blur-glass)] shadow-[var(--shadow-glass-value)]'
      )}
    >
      <CardHeader className="pb-3">
        <h2 className="text-base font-semibold text-foreground">Required skills</h2>
      </CardHeader>
      <CardContent className="space-y-4">
        {requiredSkills.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {requiredSkills.map((s) => (
              <span
                key={s}
                className="inline-flex rounded-md border border-emerald-400/40 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 shadow-[0_0_8px_-2px_rgba(16,185,129,0.2)]"
              >
                {SKILL_LABELS[s] ?? s}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No specific skills detected for this job.</p>
        )}

        {hasWorker && (
          <>
            <div>
              <h3 className="text-sm font-medium text-foreground mb-1.5">Assigned worker skills</h3>
              {(workerSkills?.length ?? 0) > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {workerSkills!.map((s) => (
                    <span
                      key={s}
                      className="inline-flex rounded-md border border-sky-400/40 bg-sky-500/10 px-2 py-1 text-xs font-medium text-sky-700 dark:text-sky-400"
                    >
                      {SKILL_LABELS[s] ?? s}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Worker has no skills listed.</p>
              )}
            </div>

            {requiredSkills.length > 0 && (
              <div
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm',
                  allMatch
                    ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                    : 'border-amber-400/50 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                )}
              >
                {allMatch ? (
                  <>
                    <CheckCircle className="size-4 shrink-0" />
                    <span>All required skills match</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="size-4 shrink-0" />
                    <span>
                      Missing skills: {missing.map((s) => SKILL_LABELS[s] ?? s).join(', ')}
                    </span>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

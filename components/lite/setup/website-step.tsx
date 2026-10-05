'use client';

import { useState } from 'react';
import { finishInterviewAction, saveWebsiteAction } from '@/lib/actions/lite/interview';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function WebsiteStep({
  interviewId,
  initialWebsite,
  initialSignOff,
  initialMobile,
  alreadySaved,
  onSaved,
  onFinished,
}: {
  interviewId: string;
  initialWebsite: string;
  initialSignOff: string;
  initialMobile: string;
  alreadySaved: boolean;
  onSaved: () => void;
  onFinished: () => void;
}) {
  const [website, setWebsite] = useState(initialWebsite);
  const [signOff, setSignOff] = useState(initialSignOff);
  const [mobile, setMobile] = useState(initialMobile);
  const [saved, setSaved] = useState(alreadySaved);
  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [fieldError, setFieldError] = useState<{ field: 'website' | 'signOffName' | 'ownerMobile'; error: string } | null>(
    null,
  );
  const [missing, setMissing] = useState<string[]>([]);
  const [finishError, setFinishError] = useState<string | null>(null);

  function edit(next: () => void) {
    next();
    setSaved(false);
    setMissing([]);
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setFieldError(null);
    const result = await saveWebsiteAction(interviewId, {
      website,
      signOffName: signOff,
      ownerMobile: mobile.trim() === '' ? null : mobile,
    });
    setSaving(false);
    if (!result.ok) {
      setFieldError({ field: result.field, error: result.error });
      return;
    }
    setSaved(true);
    onSaved();
  }

  async function finish() {
    if (finishing || !saved) return;
    setFinishing(true);
    setMissing([]);
    setFinishError(null);
    const result = await finishInterviewAction(interviewId);
    setFinishing(false);
    if (result.ok) {
      onFinished();
      return;
    }
    if ('missing' in result) {
      setMissing(result.missing);
      return;
    }
    setFinishError(result.error);
  }

  return (
    <section className="glass-card min-w-0 space-y-4 rounded-xl p-4">
      <div className="space-y-1.5">
        <Label htmlFor="setup-website">Your website</Label>
        <Input
          id="setup-website"
          value={website}
          placeholder="daveplastering.co.uk"
          autoComplete="url"
          aria-invalid={fieldError?.field === 'website'}
          onChange={(event) => edit(() => setWebsite(event.target.value))}
        />
        <p className="text-xs text-muted-foreground">The assistant only works on this website.</p>
        {fieldError?.field === 'website' ? (
          <p className="text-sm text-destructive" role="alert">
            {fieldError.error}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="setup-signoff">Name to sign texts with</Label>
        <Input
          id="setup-signoff"
          value={signOff}
          autoComplete="given-name"
          aria-invalid={fieldError?.field === 'signOffName'}
          onChange={(event) => edit(() => setSignOff(event.target.value))}
        />
        <p className="text-xs text-muted-foreground">Customers get a friendly text from this name.</p>
        {fieldError?.field === 'signOffName' ? (
          <p className="text-sm text-destructive" role="alert">
            {fieldError.error}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="setup-mobile">Your mobile (optional)</Label>
        <Input
          id="setup-mobile"
          value={mobile}
          inputMode="tel"
          autoComplete="tel"
          placeholder="07700 900123"
          aria-invalid={fieldError?.field === 'ownerMobile'}
          onChange={(event) => edit(() => setMobile(event.target.value))}
        />
        <p className="text-xs text-muted-foreground">
          Put in the text so customers can reach you directly. Never shown on the website.
        </p>
        {fieldError?.field === 'ownerMobile' ? (
          <p className="text-sm text-destructive" role="alert">
            {fieldError.error}
          </p>
        ) : null}
      </div>

      <Button type="button" disabled={saving} onClick={() => void save()}>
        {saving ? 'Saving…' : 'Save'}
      </Button>

      {saved ? (
        <div className="space-y-3 border-t border-border pt-4">
          {missing.length > 0 ? (
            <ul className="space-y-1 rounded-lg bg-amber-500/15 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
              {missing.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          {finishError ? (
            <p className="text-sm text-destructive" role="alert">
              {finishError}
            </p>
          ) : null}
          <Button type="button" disabled={finishing} onClick={() => void finish()}>
            {finishing ? 'Finishing…' : 'Finish'}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

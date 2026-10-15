'use client';

import { useEffect, useState, type FormEvent, type JSX } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useUnsavedGuard } from '@/components/settings/unsaved-save-bar';
import { Button } from '@/components/ui/button';
import { WordingComposer, WordingCopy } from '@/components/settings/wording-field';
import { saveMessageWording } from '@/lib/actions/messaging';
import { messageWordingPreview } from '@/lib/messaging/templates';
import type { MessagingSettings } from '@/lib/messaging/settings';
import {
  isWordingKey,
  STANDARD_WORDING,
  WORDING_SPECS,
  wordingSpec,
  wordingTokens,
  type WordingKey,
} from '@/lib/messaging/wording';
import { normalizeUkPhoneE164 } from '@/lib/utils/phone';

const LIST_HREF = '/settings?tab=messages&wording=list';
const SETTINGS_HREF = '/settings?tab=messages';

function creditLine(length: number, segments: number): string {
  if (segments < 1) return `${length} characters`;
  const texts = segments === 1 ? '1 text' : `${segments} texts`;
  const credits = segments === 1 ? '1 credit' : `${segments} credits`;
  return `${length} characters · ${texts} · ${credits}`;
}

export function MessageWording(props: {
  screen: string;
  settings: MessagingSettings;
  companyPhone: string | null;
  businessName: string;
  onDirtyChange?: (dirty: boolean) => void;
}): JSX.Element {
  if (isWordingKey(props.screen)) {
    return (
      <WordingEditor
        key={props.screen}
        wordingKey={props.screen}
        settings={props.settings}
        companyPhone={props.companyPhone}
        businessName={props.businessName}
        onDirtyChange={props.onDirtyChange}
      />
    );
  }
  return <WordingList settings={props.settings} />;
}

function WordingList(props: { settings: MessagingSettings }): JSX.Element {
  return (
    <div className="grid gap-6">
      <div className="space-y-2">
        <Link
          href={SETTINGS_HREF}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Customer messages
        </Link>
        <h2 className="text-lg font-semibold">Wording</h2>
        <p className="text-sm text-muted-foreground">
          These are the texts customers get. Payment reminders stay as they are.
        </p>
      </div>
      <div className="grid gap-2">
        {WORDING_SPECS.map((spec) => {
          const custom = props.settings.wording[spec.key] != null;
          return (
            <Link
              key={spec.key}
              href={`/settings?tab=messages&wording=${spec.key}`}
              className="flex items-center justify-between gap-4 rounded-xl border border-border/60 bg-card/80 px-4 py-3 hover:bg-muted/30"
            >
              <span>
                <span className="block font-medium">{spec.title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {custom ? 'Your wording' : 'Standard'}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function WordingEditor(props: {
  wordingKey: WordingKey;
  settings: MessagingSettings;
  companyPhone: string | null;
  businessName: string;
  onDirtyChange?: (dirty: boolean) => void;
}): JSX.Element {
  const router = useRouter();
  const spec = wordingSpec(props.wordingKey);
  const saved = props.settings.wording[props.wordingKey] ?? STANDARD_WORDING[props.wordingKey];
  const [body, setBody] = useState(saved);
  const [baseline, setBaseline] = useState(saved);
  const [saving, setSaving] = useState(false);
  const dirty = body !== baseline;

  useEffect(() => {
    setBaseline(saved);
  }, [saved]);
  useUnsavedGuard(dirty);

  const { onDirtyChange } = props;
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  const brand = {
    businessName: props.businessName,
    contactPhone: props.settings.contact_phone ?? normalizeUkPhoneE164(props.companyPhone),
  };
  const preview = messageWordingPreview(props.wordingKey, body, brand);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (preview.error) {
      toast.error(preview.error);
      return;
    }
    setSaving(true);
    const result = await saveMessageWording({ key: props.wordingKey, body });
    setSaving(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    const trimmed = body.trim();
    const next =
      trimmed === '' || trimmed === STANDARD_WORDING[props.wordingKey]
        ? STANDARD_WORDING[props.wordingKey]
        : trimmed;
    setBody(next);
    setBaseline(next);
    toast.success('Wording saved');
    router.refresh();
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="grid gap-6">
      <div className="space-y-2">
        <Link
          href={LIST_HREF}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Wording
        </Link>
        <h2 className="text-lg font-semibold">{spec.title}</h2>
      </div>
      <WordingCopy
        text={spec.instructions}
        tokens={wordingTokens(props.wordingKey).map((piece) => piece.token)}
      />
      <WordingComposer
        value={body}
        onChange={setBody}
        pieces={wordingTokens(props.wordingKey)}
        ariaLabel={spec.title}
        invalid={preview.error != null}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => setBody(STANDARD_WORDING[props.wordingKey])}
          >
            Use the standard message
          </Button>
          <Button type="submit" disabled={saving || !dirty || preview.error != null}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
        </div>
        {preview.error ? <p className="text-sm text-destructive">{preview.error}</p> : null}
        <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
          <p className="whitespace-pre-wrap text-sm">{preview.text}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {spec.exampleNote} · {creditLine(preview.length, preview.segments)}
          </p>
        </div>
      </WordingComposer>
    </form>
  );
}

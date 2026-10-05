'use client';

import { useEffect, useState } from 'react';
import { suggestExamplesAction, saveExamplesAction } from '@/lib/actions/lite/interview';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type CardDraft = {
  id: string;
  description: string;
  price: string;
  reasoning: string;
  own: boolean;
};

function newId(): string {
  return crypto.randomUUID();
}

function isComplete(card: CardDraft): boolean {
  const description = card.description.trim();
  const reasoning = card.reasoning.trim();
  const price = Number(card.price);
  return (
    description.length >= 1 &&
    description.length <= 300 &&
    reasoning.length >= 5 &&
    reasoning.length <= 400 &&
    Number.isFinite(price) &&
    price > 0 &&
    price <= 50000
  );
}

function started(card: CardDraft): boolean {
  if (!card.own) return card.price.trim() !== '' || card.reasoning.trim() !== '';
  return card.description.trim() !== '' || card.price.trim() !== '' || card.reasoning.trim() !== '';
}

export function ExampleJobsStep({
  interviewId,
  initialExamples,
  onSaved,
}: {
  interviewId: string;
  initialExamples: { description: string; price: number; reasoning: string }[];
  onSaved: (examples: { description: string; price: number; reasoning: string }[]) => void;
}) {
  const [cards, setCards] = useState<CardDraft[]>(() =>
    initialExamples.map((example, index) => ({
      id: `saved-${index}`,
      description: example.description,
      price: String(example.price),
      reasoning: example.reasoning,
      own: false,
    })),
  );
  const [loading, setLoading] = useState(initialExamples.length === 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialExamples.length > 0) return;
    let cancelled = false;
    void (async () => {
      const result = await suggestExamplesAction(interviewId);
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error);
        setLoading(false);
        return;
      }
      setCards(
        result.examples.map((example) => ({
          id: newId(),
          description: example.description,
          price: '',
          reasoning: '',
          own: false,
        })),
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [interviewId, initialExamples.length]);

  const complete = cards.filter(isComplete).length;
  const unfinished = cards.some((card) => started(card) && !isComplete(card));
  const canSave = complete >= 3 && !unfinished && !saving && !loading;

  function update(id: string, patch: Partial<CardDraft>) {
    setCards((current) => current.map((card) => (card.id === id ? { ...card, ...patch } : card)));
  }

  async function save() {
    if (!canSave) return;
    const examples = cards.filter(isComplete).map((card) => ({
      description: card.description.trim(),
      price: Number(card.price),
      reasoning: card.reasoning.trim(),
    }));
    setSaving(true);
    setError(null);
    const result = await saveExamplesAction(interviewId, examples);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved(examples);
  }

  return (
    <section className="glass-card min-w-0 space-y-4 rounded-xl p-4">
      <p className="text-sm">
        Here are a few jobs a customer might ask about. Price each one the way you would and say why — this is how your
        assistant learns your style.
      </p>
      {loading ? <p className="text-sm text-muted-foreground">Thinking of a few jobs…</p> : null}
      <ul className="space-y-3">
        {cards.map((card) => (
          <li key={card.id} className="space-y-2 rounded-xl border border-border bg-card p-3">
            {card.own ? (
              <Input
                value={card.description}
                aria-label="Job description"
                placeholder="Describe the job"
                onChange={(event) => update(card.id, { description: event.target.value })}
              />
            ) : (
              <p className="text-sm font-medium">{card.description}</p>
            )}
            <label className="block space-y-1 text-sm">
              <span className="font-medium">£ price</span>
              <Input
                inputMode="decimal"
                value={card.price}
                aria-label="Price in pounds"
                placeholder="120"
                onChange={(event) => update(card.id, { price: event.target.value })}
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Why that price?</span>
              <Textarea
                value={card.reasoning}
                aria-label="Why that price?"
                onChange={(event) => update(card.id, { reasoning: event.target.value })}
              />
            </label>
            <Button type="button" variant="ghost" size="sm" onClick={() => setCards((current) => current.filter((item) => item.id !== card.id))}>
              Skip this one
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={cards.length >= 10}
          onClick={() =>
            setCards((current) => [
              ...current,
              { id: newId(), description: '', price: '', reasoning: '', own: true },
            ])
          }
        >
          Write my own
        </Button>
        <p className="text-sm text-muted-foreground">{Math.min(complete, 3)} of 3 done</p>
      </div>
      {unfinished && complete >= 3 ? (
        <p className="text-sm text-muted-foreground">Finish or skip the ones you&apos;ve started.</p>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {error && cards.length === 0 ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setError(null);
            setLoading(true);
            void suggestExamplesAction(interviewId).then((result) => {
              if (!result.ok) {
                setError(result.error);
                setLoading(false);
                return;
              }
              setCards(
                result.examples.map((example) => ({
                  id: newId(),
                  description: example.description,
                  price: '',
                  reasoning: '',
                  own: false,
                })),
              );
              setLoading(false);
            });
          }}
        >
          Try again
        </Button>
      ) : null}
      <Button type="button" disabled={!canSave} onClick={() => void save()}>
        {saving ? 'Saving…' : 'Save examples'}
      </Button>
    </section>
  );
}

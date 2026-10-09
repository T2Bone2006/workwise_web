'use client';

import { useState } from 'react';
import { PencilRuler, Trash2, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatGbp } from '@/lib/money/pence';
import { ROUND_COLOURS } from '@/lib/rounds/rounds';
import { cn } from '@/lib/utils';

export type RoundEditorProps = {
  editing: boolean;
  mode: 'draw' | 'pick';
  /** Corners dropped so far, and whether the shape is closed. */
  corners: number;
  shapeDone: boolean;
  name: string;
  colour: string;
  picked: { customers: number; places: number; yearly: number };
  /** Picked places that currently sit in a different round and will move. */
  moving: number;
  error: string | null;
  saving: boolean;
  onMode: (mode: 'draw' | 'pick') => void;
  onUndoCorner: () => void;
  onFinishShape: () => void;
  onRedraw: () => void;
  onClearPicks: () => void;
  onName: (name: string) => void;
  onColour: (colour: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
};

function ModeButton({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        'flex-1 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        on ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

/** Make or change a round: draw round some pins or pick them, name it, choose a colour. */
export function RoundEditor(p: RoundEditorProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const hint =
    p.mode === 'pick'
      ? 'Tap pins on the map to add or remove them.'
      : p.shapeDone
        ? 'Tap pins to add or remove any the shape missed.'
        : p.corners === 0
          ? 'Tap the map to drop corners round the customers you want. Customers already in another round are left out.'
          : `${p.corners} ${p.corners === 1 ? 'corner' : 'corners'} so far. Add at least three, then finish the shape.`;

  return (
    <section
      className="space-y-4 rounded-2xl border border-(--tone-rounds-solid) bg-card p-4 shadow-(--look-card-shadow)"
      aria-label={p.editing ? 'Edit round' : 'New round'}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">{p.editing ? 'Edit round' : 'New round'}</h2>
        <Button type="button" variant="ghost" size="icon-sm" onClick={p.onCancel} aria-label="Cancel">
          <X className="size-4" />
        </Button>
      </div>

      <div role="group" aria-label="How to choose customers" className="flex rounded-xl bg-muted p-1">
        <ModeButton on={p.mode === 'draw'} onClick={() => p.onMode('draw')}>
          Draw on map
        </ModeButton>
        <ModeButton on={p.mode === 'pick'} onClick={() => p.onMode('pick')}>
          Pick customers
        </ModeButton>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>

      {p.mode === 'draw' ? (
        <div className="flex gap-2">
          {p.shapeDone ? (
            <Button type="button" variant="outline" size="sm" className="flex-1" onClick={p.onRedraw}>
              <PencilRuler className="size-4" />
              Redraw shape
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" size="sm" onClick={p.onUndoCorner} disabled={p.corners === 0}>
                <Undo2 className="size-4" />
                Undo corner
              </Button>
              <Button type="button" size="sm" className="flex-1" onClick={p.onFinishShape}>
                Finish shape
              </Button>
            </>
          )}
        </div>
      ) : null}

      <div className="rounded-xl bg-muted/60 px-3 py-2.5">
        <p className="text-sm font-semibold tabular-nums">
          {p.picked.customers} {p.picked.customers === 1 ? 'customer' : 'customers'}
          {p.picked.places !== p.picked.customers ? (
            <span className="font-normal text-muted-foreground"> · {p.picked.places} places</span>
          ) : null}
          <span className="font-normal text-muted-foreground"> · </span>
          {formatGbp(Math.round(p.picked.yearly))} a year
        </p>
        {p.moving > 0 ? (
          <p className="mt-0.5 text-xs text-(--tone-amber-text)">
            {p.moving} will move here from another round.
          </p>
        ) : null}
        {p.picked.places > 0 ? (
          <button type="button" onClick={p.onClearPicks} className="mt-1 text-xs font-medium text-primary hover:underline">
            Clear picks
          </button>
        ) : null}
      </div>

      <div className="space-y-2">
        <label htmlFor="round-name" className="text-sm font-medium">
          Name
        </label>
        <Input
          id="round-name"
          value={p.name}
          onChange={(e) => p.onName(e.target.value)}
          placeholder="Tuesday north"
          maxLength={60}
          autoComplete="off"
        />
        <div role="group" aria-label="Colour" className="flex flex-wrap gap-2 pt-1">
          {ROUND_COLOURS.map((c, i) => (
            <button
              key={c}
              type="button"
              onClick={() => p.onColour(c)}
              aria-pressed={p.colour.toLowerCase() === c}
              aria-label={`Colour ${i + 1}`}
              className={cn(
                'size-7 rounded-full border-2 border-card transition-shadow focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                p.colour.toLowerCase() === c ? 'ring-2 ring-foreground' : 'ring-1 ring-border',
              )}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>

      {p.error ? (
        <p role="alert" className="text-sm text-destructive">
          {p.error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="button" className="flex-1" onClick={p.onSave} disabled={p.saving}>
          {p.saving ? 'Saving…' : 'Save round'}
        </Button>
        <Button type="button" variant="ghost" onClick={p.onCancel} disabled={p.saving}>
          Cancel
        </Button>
      </div>

      {p.editing ? (
        confirmingDelete ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p>Delete this round? Your customers stay; they just won&apos;t be in a round.</p>
            <div className="mt-2 flex gap-2">
              <Button type="button" variant="destructive" size="sm" onClick={p.onDelete} disabled={p.saving}>
                Delete round
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
                Keep it
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-4" />
            Delete round
          </button>
        )
      ) : null}
    </section>
  );
}

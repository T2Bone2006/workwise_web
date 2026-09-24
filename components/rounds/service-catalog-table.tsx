'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import {
  addServicePresets,
  createService,
  deactivateService,
  updateService,
} from '@/lib/actions/rounds/service-catalog';
import type { ServicePresetGroup, ServiceRow } from '@/lib/data/rounds/service-catalog';
import {
  frequencyDaysFromParts,
  frequencyLabel,
  frequencyParts,
} from '@/lib/rounds/parse-frequency';
import type { ServiceInput } from '@/lib/validations/rounds/service';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type Draft = {
  name: string;
  price: string;
  /** Kept so a save does not wipe a duration already stored. Not shown. */
  duration: string;
  months: number;
  weeks: number;
  isActive: boolean;
};

type Editor =
  | { kind: 'add' }
  | { kind: 'edit'; id: string }
  | null;

const priceFormat = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
});

function emptyDraft(): Draft {
  return {
    name: '',
    price: '',
    duration: '30',
    months: 1,
    weeks: 0,
    isActive: true,
  };
}

function draftFromService(service: ServiceRow): Draft {
  const parts = frequencyParts(service.default_frequency_days ?? 28);
  return {
    name: service.name,
    price: Number.isInteger(service.default_price)
      ? String(service.default_price)
      : service.default_price.toFixed(2),
    duration: String(service.default_duration_minutes),
    months: parts.months,
    weeks: parts.weeks,
    isActive: service.is_active,
  };
}

function draftToInput(draft: Draft): { ok: true; input: ServiceInput } | { ok: false; error: string } {
  const name = draft.name.trim();
  if (name.length < 2 || name.length > 80) {
    return { ok: false, error: 'Name needs between 2 and 80 characters.' };
  }

  if (draft.price.trim() === '') {
    return { ok: false, error: 'Enter a price.' };
  }
  const price = Number(draft.price);
  if (!Number.isFinite(price) || price < 0) {
    return { ok: false, error: 'Price must be zero or more.' };
  }

  const duration = Number(draft.duration);
  if (!Number.isInteger(duration) || duration < 5 || duration > 600) {
    return { ok: false, error: 'Duration must be between 5 and 600 minutes.' };
  }

  const frequency = frequencyDaysFromParts(draft.months, draft.weeks);

  return {
    ok: true,
    input: {
      name,
      default_price: price,
      default_duration_minutes: duration,
      default_frequency_days: frequency,
      is_active: draft.isActive,
    },
  };
}

function repeatLabel(days: number | null): string {
  if (days == null) return 'One-off';
  return frequencyLabel(days);
}

function formatPrice(amount: number): string {
  return priceFormat.format(amount);
}

export function ServiceCatalogTable({
  services,
  presetGroups,
  fetchError,
  presetError,
}: {
  services: ServiceRow[];
  presetGroups: ServicePresetGroup[];
  fetchError: string | null;
  presetError: string | null;
}) {
  const [editor, setEditor] = useState<Editor>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [pending, setPending] = useState<string | null>(null);
  const [inactiveOpen, setInactiveOpen] = useState(false);
  const [preview, setPreview] = useState<ServicePresetGroup | null>(null);

  const busy = pending !== null;

  function beginAdd() {
    if (busy) return;
    setDraft(emptyDraft());
    setEditor({ kind: 'add' });
  }

  function beginEdit(service: ServiceRow) {
    if (busy) return;
    setDraft(draftFromService(service));
    setEditor({ kind: 'edit', id: service.id });
  }

  function cancelEdit() {
    if (busy) return;
    setEditor(null);
  }

  async function save() {
    if (editor == null || busy) return;
    const parsed = draftToInput(draft);
    if (!parsed.ok) {
      toast.error(parsed.error);
      return;
    }

    const pendingKey = editor.kind === 'add' ? 'add' : editor.id;
    setPending(pendingKey);
    const result =
      editor.kind === 'add'
        ? await createService(parsed.input)
        : await updateService(editor.id, parsed.input);
    setPending(null);

    if (!result.success) {
      toast.error(result.error);
      return;
    }

    toast.success(editor.kind === 'add' ? 'Service added' : 'Service updated');
    if (!parsed.input.is_active) setInactiveOpen(true);
    setEditor(null);
  }

  async function deactivate(id: string) {
    if (busy) return;
    setPending(id);
    const result = await deactivateService(id);
    setPending(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success('Service moved to switched off');
    setInactiveOpen(true);
    if (editor?.kind === 'edit' && editor.id === id) setEditor(null);
  }

  async function activate(service: ServiceRow) {
    if (busy) return;
    setPending(service.id);
    const result = await updateService(service.id, {
      name: service.name,
      default_price: service.default_price,
      default_duration_minutes: service.default_duration_minutes,
      default_frequency_days: service.default_frequency_days,
      is_active: true,
    });
    setPending(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success('Service activated');
  }

  async function addPresets(group: ServicePresetGroup) {
    if (busy) return;
    setPending(`preset:${group.key}`);
    const result = await addServicePresets(group.key);
    setPending(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    const label = result.label;
    toast.success(
      result.added === 0
        ? `${label} is already in your list`
        : `Added ${result.added} ${label.toLowerCase()} service${result.added === 1 ? '' : 's'}`,
    );
    setPreview(null);
  }

  const activeServices = services.filter((service) => service.is_active);
  const inactiveServices = services.filter((service) => !service.is_active);
  const editingInactive =
    editor?.kind === 'edit' && inactiveServices.some((service) => service.id === editor.id);
  const showInactive = inactiveOpen || editingInactive;
  const showActiveTable = activeServices.length > 0 || editor?.kind === 'add';

  function serviceRow(service: ServiceRow, switchedOff: boolean) {
    if (editor?.kind === 'edit' && editor.id === service.id) {
      return (
        <ServiceEditorRow
          key={service.id}
          draft={draft}
          onChange={setDraft}
          onCancel={cancelEdit}
          onSave={() => {
            void save();
          }}
          saving={pending === service.id}
          disabled={busy && pending !== service.id}
          showActive
        />
      );
    }

    return (
      <TableRow key={service.id} className={switchedOff ? 'text-muted-foreground' : undefined}>
        <TableCell className="whitespace-normal font-medium text-foreground">
          {service.name}
        </TableCell>
        <TableCell>{formatPrice(service.default_price)}</TableCell>
        <TableCell>{repeatLabel(service.default_frequency_days)}</TableCell>
        <TableCell className="text-right">
          <div className="flex justify-end gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => beginEdit(service)}
            >
              Edit
            </Button>
            {switchedOff ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  void activate(service);
                }}
              >
                {pending === service.id ? <Loader2 className="animate-spin" /> : null}
                Activate
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  void deactivate(service.id);
                }}
              >
                {pending === service.id ? <Loader2 className="animate-spin" /> : null}
                Deactivate
              </Button>
            )}
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <div className="space-y-4">
      {fetchError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Could not load services. {fetchError}
        </div>
      ) : null}
      {presetError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Could not load presets. {presetError}
        </div>
      ) : null}

      <div className="rounded-xl border border-border/60 bg-card/80">
        <div className="flex flex-col gap-3 border-b border-border/60 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold">Your services</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Price and repeat are defaults. Add a service, or start from a trade preset.
              You set the real figures per customer, and you can change them again later —
              including on the day.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" disabled={busy}>
                  {pending?.startsWith('preset:') ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <ChevronDown />
                  )}
                  Add presets…
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {presetGroups.map((group) => (
                    <DropdownMenuItem
                      key={group.key}
                      disabled={busy}
                      onSelect={() => {
                        setPreview(group);
                      }}
                    >
                      <span className="flex-1">{group.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {group.services.length}
                      </span>
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button type="button" size="sm" onClick={beginAdd} disabled={busy}>
              <Plus />
              Add service
            </Button>
          </div>
        </div>

        {showActiveTable ? (
          <ServiceTable>
            {editor?.kind === 'add' ? (
              <ServiceEditorRow
                draft={draft}
                onChange={setDraft}
                onCancel={cancelEdit}
                onSave={() => {
                  void save();
                }}
                saving={pending === 'add'}
                disabled={busy && pending !== 'add'}
                showActive={false}
              />
            ) : null}
            {activeServices.map((service) => serviceRow(service, false))}
          </ServiceTable>
        ) : (
          <p className="p-6 text-sm text-muted-foreground">
            {fetchError
              ? 'Services could not be loaded.'
              : inactiveServices.length > 0
                ? 'No active services. Switched-off ones are listed below.'
                : 'No services yet. Window cleaners usually start with Add presets… → Window cleaning.'}
          </p>
        )}

        {inactiveServices.length > 0 ? (
          <div className="border-t border-border/60">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-muted-foreground hover:text-foreground"
              aria-expanded={showInactive}
              onClick={() => {
                if (editingInactive) return;
                setInactiveOpen((open) => !open);
              }}
            >
              <ChevronDown
                className={`size-4 shrink-0 transition-transform ${showInactive ? '' : '-rotate-90'}`}
              />
              Switched off ({inactiveServices.length})
            </button>
            {showInactive ? (
              <ServiceTable>
                {inactiveServices.map((service) => serviceRow(service, true))}
              </ServiceTable>
            ) : null}
          </div>
        ) : null}
      </div>

      <Dialog
        open={preview != null}
        onOpenChange={(open) => {
          if (!open && !busy) setPreview(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{preview?.label ?? 'Presets'}</DialogTitle>
            <DialogDescription>
              These are starting prices and repeats. Adding them copies them into your
              list. A name you already have stays as it is.
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-80 space-y-2 overflow-y-auto">
            {(preview?.services ?? []).map((service) => (
              <li
                key={service.name}
                className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2 text-sm"
              >
                <span className="font-medium">{service.name}</span>
                <span className="shrink-0 text-muted-foreground">
                  {formatPrice(service.defaultPrice)}
                  {' · '}
                  {repeatLabel(service.defaultFrequencyDays)}
                </span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => setPreview(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={busy || preview == null}
              onClick={() => {
                if (preview) void addPresets(preview);
              }}
            >
              {pending?.startsWith('preset:') ? <Loader2 className="animate-spin" /> : null}
              Add these
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ServiceTable({ children }: { children: ReactNode }) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Name</TableHead>
          <TableHead>Default price</TableHead>
          <TableHead>Default repeat</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>{children}</TableBody>
    </Table>
  );
}

function ServiceEditorRow({
  draft,
  onChange,
  onCancel,
  onSave,
  saving,
  disabled,
  showActive,
}: {
  draft: Draft;
  onChange: (draft: Draft) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  disabled: boolean;
  showActive: boolean;
}) {
  const locked = saving || disabled;

  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={4} className="whitespace-normal">
        <form
          className="grid gap-3 py-1 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <Label htmlFor="service-name">Name</Label>
            <Input
              id="service-name"
              value={draft.name}
              onChange={(event) => onChange({ ...draft, name: event.target.value })}
              disabled={locked}
              autoFocus
              maxLength={80}
              className="h-8"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="service-price">Default price (£)</Label>
            <Input
              id="service-price"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={draft.price}
              onChange={(event) => onChange({ ...draft, price: event.target.value })}
              disabled={locked}
              className="h-8"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Default repeat</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              <Select
                value={String(draft.months)}
                onValueChange={(value) => {
                  const months = Number(value);
                  const weeks = months === 0 && draft.weeks === 0 ? 1 : draft.weeks;
                  onChange({ ...draft, months, weeks });
                }}
                disabled={locked}
              >
                <SelectTrigger className="w-full" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 13 }, (_, months) => (
                    <SelectItem key={months} value={String(months)}>
                      {months} {months === 1 ? 'month' : 'months'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={String(draft.weeks)}
                onValueChange={(value) => {
                  const weeks = Number(value);
                  const safeWeeks = draft.months === 0 && weeks === 0 ? 1 : weeks;
                  onChange({ ...draft, weeks: safeWeeks });
                }}
                disabled={locked}
              >
                <SelectTrigger className="w-full" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 4 }, (_, weeks) => (
                    <SelectItem key={weeks} value={String(weeks)}>
                      {weeks} {weeks === 1 ? 'week' : 'weeks'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              {frequencyLabel(frequencyDaysFromParts(draft.months, draft.weeks))}. A month
              is 4 weeks.
            </p>
          </div>
          {showActive ? (
            <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-4">
              <Switch
                id="service-active"
                checked={draft.isActive}
                onCheckedChange={(checked) => onChange({ ...draft, isActive: checked })}
                disabled={locked}
              />
              <Label htmlFor="service-active">Active</Label>
            </div>
          ) : null}
          <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
            <Button type="submit" size="sm" disabled={locked}>
              {saving ? <Loader2 className="animate-spin" /> : null}
              Save
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={locked}>
              Cancel
            </Button>
          </div>
        </form>
      </TableCell>
    </TableRow>
  );
}

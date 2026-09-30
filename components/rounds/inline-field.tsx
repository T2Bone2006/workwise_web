'use client';

import {
  createContext,
  useContext,
  useId,
  useState,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import {
  AddressAutocompleteInput,
  unhookChromeAddressFill,
} from '@/components/ui/address-autocomplete-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

type EditScope = {
  editing: string | null;
  claim: (id: string) => void;
  release: (id: string) => void;
};

const InlineEditContext = createContext<EditScope | null>(null);

/** One text or address field open at a time inside this group. */
export function InlineEditGroup(props: { children: ReactNode }): JSX.Element {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <InlineEditContext.Provider
      value={{
        editing,
        claim: (id) => setEditing(id),
        release: (id) => setEditing((current) => (current === id ? null : current)),
      }}
    >
      {props.children}
    </InlineEditContext.Provider>
  );
}

function EditableValue(props: {
  label: string;
  onEdit: () => void;
  empty?: boolean;
  hideLabel?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <div>
      {props.hideLabel ? null : <p className="text-xs text-muted-foreground">{props.label}</p>}
      <button
        type="button"
        onClick={props.onEdit}
        className="mt-0.5 flex w-full items-start justify-between gap-3 rounded-md py-0.5 text-left text-sm hover:bg-muted/60"
      >
        <span className={cn('min-w-0 whitespace-pre-wrap', props.empty && 'text-muted-foreground')}>
          {props.children}
        </span>
        <Pencil className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="sr-only">Edit {props.label}</span>
      </button>
    </div>
  );
}

function useFieldOpen(): { open: boolean; begin: () => void; end: () => void } {
  const id = useId();
  const scope = useContext(InlineEditContext);
  const [local, setLocal] = useState(false);
  const open = scope ? scope.editing === id : local;
  return {
    open,
    begin: () => {
      if (scope) scope.claim(id);
      else setLocal(true);
    },
    end: () => {
      if (scope) scope.release(id);
      else setLocal(false);
    },
  };
}

export function InlineText(props: {
  label: string;
  value: string | null;
  placeholder?: string;
  multiline?: boolean;
  inputMode?: 'text' | 'email' | 'tel';
  emptyText?: string;
  hideLabel?: boolean;
  onSave: (v: string) => Promise<{ success: boolean; error?: string; value?: unknown }>;
}): JSX.Element {
  const { label, value, placeholder, multiline, inputMode, emptyText, hideLabel, onSave } = props;
  const fromProps = value ?? '';
  const [committed, setCommitted] = useState<string | null>(null);
  if (committed != null && fromProps === committed) setCommitted(null);
  const shown = committed ?? fromProps;
  const { open, begin, end } = useFieldOpen();
  const [draft, setDraft] = useState(shown);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function start() {
    setDraft(shown);
    setError(null);
    begin();
  }

  function cancel() {
    setDraft(shown);
    setError(null);
    end();
  }

  async function save() {
    setSaving(true);
    setError(null);
    const result = await onSave(draft);
    setSaving(false);
    if (!result.success) {
      setError(result.error ?? 'Could not save');
      return;
    }
    const next =
      typeof result.value === 'string' ? result.value : result.value == null ? '' : draft;
    setCommitted(next);
    toast.success('Saved');
    end();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key !== 'Enter') return;
    if (multiline && !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    void save();
  }

  if (!open) {
    return (
      <EditableValue label={label} onEdit={start} empty={!shown} hideLabel={hideLabel}>
        {shown || (emptyText ?? `Add ${label.toLowerCase()}`)}
      </EditableValue>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      {multiline ? (
        <Textarea
          value={draft}
          placeholder={placeholder}
          disabled={saving}
          rows={3}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          autoFocus
        />
      ) : (
        <Input
          value={draft}
          placeholder={placeholder}
          inputMode={inputMode}
          disabled={saving}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          autoFocus
        />
      )}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" className="gap-2" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Save
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={cancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function InlineSelect<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  help?: string;
  onSave: (v: T) => Promise<{ success: boolean; error?: string }>;
}): JSX.Element {
  const { label, value, options, help, onSave } = props;
  const [current, setCurrent] = useState(value);
  const [saving, setSaving] = useState(false);

  async function change(next: T) {
    if (next === current) return;
    const previous = current;
    setCurrent(next);
    setSaving(true);
    const result = await onSave(next);
    setSaving(false);
    if (!result.success) {
      setCurrent(previous);
      toast.error(result.error ?? 'Could not save');
      return;
    }
    toast.success('Saved');
  }

  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <Select value={current} disabled={saving} onValueChange={(next) => void change(next as T)}>
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
    </div>
  );
}

export function InlineSwitch(props: {
  label: string;
  checked: boolean;
  help?: string;
  disabled?: boolean;
  disabledReason?: string;
  onSave: (v: boolean) => Promise<{ success: boolean; error?: string }>;
}): JSX.Element {
  const { label, checked, help, disabled, disabledReason, onSave } = props;
  const [current, setCurrent] = useState(checked);
  const [saving, setSaving] = useState(false);

  async function change(next: boolean) {
    if (disabled) return;
    const previous = current;
    setCurrent(next);
    setSaving(true);
    const result = await onSave(next);
    setSaving(false);
    if (!result.success) {
      setCurrent(previous);
      toast.error(result.error ?? 'Could not save');
      return;
    }
    toast.success('Saved');
  }

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">{label}</p>
        {help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
        {disabled && disabledReason ? (
          <p className="text-xs text-muted-foreground">{disabledReason}</p>
        ) : null}
      </div>
      <Switch
        checked={current}
        disabled={disabled || saving}
        onCheckedChange={(next) => void change(next)}
        aria-label={label}
        className={cn(saving && 'opacity-70')}
      />
    </div>
  );
}

export function InlineAddress(props: {
  label: string;
  address: string | null;
  postcode: string | null;
  onSave: (v: { address: string; postcode: string }) => Promise<{ success: boolean; error?: string }>;
}): JSX.Element {
  const { label, address, postcode, onSave } = props;
  const line = [address, postcode].filter(Boolean).join(', ');
  const { open, begin, end } = useFieldOpen();
  const [draftAddress, setDraftAddress] = useState(address ?? '');
  const [draftPostcode, setDraftPostcode] = useState(postcode ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function start() {
    setDraftAddress(address ?? '');
    setDraftPostcode(postcode ?? '');
    setError(null);
    begin();
  }

  function cancel() {
    setError(null);
    end();
  }

  async function save() {
    setSaving(true);
    setError(null);
    const result = await onSave({ address: draftAddress, postcode: draftPostcode });
    setSaving(false);
    if (!result.success) {
      setError(result.error ?? 'Could not save');
      return;
    }
    toast.success('Saved');
    end();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void save();
    }
  }

  if (!open) {
    return (
      <EditableValue label={label} onEdit={start} empty={!line}>
        {line || 'Add address'}
      </EditableValue>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{unhookChromeAddressFill(label)}</p>
      <AddressAutocompleteInput
        value={draftAddress}
        onValueChange={setDraftAddress}
        onAddressSelect={(details) => {
          setDraftAddress(details.address);
          if (details.postcode) setDraftPostcode(details.postcode);
        }}
        placeholder="12 Elm Road"
        disabled={saving}
      />
      <Input
        value={draftPostcode}
        name="outward"
        autoComplete="off"
        placeholder={unhookChromeAddressFill('Postcode')}
        disabled={saving}
        onChange={(event) => setDraftPostcode(event.target.value)}
        onKeyDown={onKeyDown}
        aria-label={unhookChromeAddressFill('Postcode')}
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" className="gap-2" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Save
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={cancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

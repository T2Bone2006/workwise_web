'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

type PeekController = {
  openId: string | null;
  setOpenId: Dispatch<SetStateAction<string | null>>;
};

const SourceFieldsPeekContext = createContext<PeekController | null>(null);

/** Wrap the review table so only one stored-fields peek is open at a time. */
export function SourceFieldsPeekProvider({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const value = useMemo(() => ({ openId, setOpenId }), [openId]);
  return (
    <SourceFieldsPeekContext.Provider value={value}>
      {children}
    </SourceFieldsPeekContext.Provider>
  );
}

type SourceFieldsPeekProps = {
  sourceFields: Record<string, string>;
  className?: string;
};

/**
 * Compact Review trigger: how many extra columns are kept with this job,
 * plus a short note that jobs will be searchable by them after import.
 */
export function SourceFieldsPeek({ sourceFields, className }: SourceFieldsPeekProps) {
  const entries = useMemo(
    () =>
      Object.entries(sourceFields).sort(([a], [b]) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' })
      ),
    [sourceFields]
  );
  const count = entries.length;
  const id = useId();
  const ctx = useContext(SourceFieldsPeekContext);
  const [localOpen, setLocalOpen] = useState(false);
  const open = ctx ? ctx.openId === id : localOpen;

  const pointerInside = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setOpenId = ctx?.setOpenId;

  const clearCloseTimer = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const openNow = useCallback(() => {
    pointerInside.current = true;
    clearCloseTimer();
    if (setOpenId) setOpenId(id);
    else setLocalOpen(true);
  }, [id, setOpenId]);

  const scheduleClose = useCallback(() => {
    pointerInside.current = false;
    clearCloseTimer();
    closeTimer.current = setTimeout(() => {
      // Ignore stale leaves (pointer returned, or another row is open).
      if (pointerInside.current) return;
      if (setOpenId) {
        setOpenId((current) => (current === id ? null : current));
      } else {
        setLocalOpen(false);
      }
    }, 120);
  }, [id, setOpenId]);

  useEffect(() => () => clearCloseTimer(), []);

  if (count === 0) {
    return <span className={cn('text-sm text-muted-foreground', className)}>—</span>;
  }

  const label =
    count === 1 ? '1 column stored' : `${count} columns stored`;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // Ignore Radix dismiss while the pointer is still on this peek —
        // rapid row-to-row hover otherwise leaves the trigger "stuck" closed.
        if (!next && pointerInside.current) return;
        clearCloseTimer();
        if (!next) pointerInside.current = false;
        if (setOpenId) {
          setOpenId((current) => {
            if (next) return id;
            return current === id ? null : current;
          });
        } else {
          setLocalOpen(next);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            'h-auto gap-1.5 px-1.5 py-1 text-xs font-normal text-muted-foreground hover:text-foreground',
            className
          )}
          onPointerEnter={openNow}
          onPointerLeave={scheduleClose}
          aria-label={`View ${label}`}
        >
          <Info className="size-3.5 shrink-0" />
          <span>{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="left"
        sideOffset={8}
        className="w-72 p-0"
        onPointerEnter={openNow}
        onPointerLeave={scheduleClose}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <div className="border-b px-3 py-2">
          <p className="text-sm font-medium">Stored with this job</p>
          <p className="text-xs text-muted-foreground">
            After import, you&apos;ll be able to search and filter jobs by these
            fields — not only address or description.
          </p>
        </div>
        <ul className="max-h-56 overflow-auto py-1">
          {entries.map(([key, value]) => (
            <li
              key={key}
              className="border-b border-border/40 px-3 py-2 last:border-b-0"
            >
              <div className="truncate text-xs font-medium text-foreground">{key}</div>
              <div className="mt-0.5 break-words text-xs text-muted-foreground">
                {value}
              </div>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

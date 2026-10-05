'use client';

import { useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { sendSetupRequest } from '@/lib/actions/rounds/setup-request';
import { cn } from '@/lib/utils';

export type StuckLinkProps = {
  context: 'review' | 'read_failed' | 'done';
  /** Open the dialog from somewhere else (the "Do it for me" card). With these set, the small link is not shown. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

const ACCEPT = '.csv,.xls,.xlsx,.pdf,.jpg,.jpeg,.png,.webp,.txt';
const MAX_FILES = 5;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function StuckLink({ context, open: openProp, onOpenChange }: StuckLinkProps) {
  const [ownOpen, setOwnOpen] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : ownOpen;
  const setOpen = (next: boolean) => {
    if (!controlled) setOwnOpen(next);
    onOpenChange?.(next);
  };
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  function addFiles(list: FileList | File[]) {
    const next = [...files];
    for (const file of list) {
      if (next.length >= MAX_FILES) {
        setError('You can send up to 5 files.');
        break;
      }
      next.push(file);
    }
    setFiles(next);
  }

  async function onSend() {
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set('note', note);
      formData.set('context', context);
      for (const file of files) formData.append('file', file);
      const result = await sendSetupRequest(formData);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setDone(true);
    } catch {
      setError("Couldn't send that. Try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="pt-1">
      {controlled ? null : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-left text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          Stuck? Send us your file and we&apos;ll help.
        </button>
      )}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next && done) {
            setDone(false);
            setFiles([]);
            setNote('');
            setError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send us your round</DialogTitle>
            <DialogDescription>
              We&apos;ll look at it and get back to you by email within 2 working days. Please try the import yourself
              first — it&apos;s usually quicker.
            </DialogDescription>
          </DialogHeader>

          {done ? (
            <p className="text-sm">Thanks — we&apos;ll be in touch within 2 working days.</p>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void onSend();
              }}
            >
              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setDragging(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
                }}
                className={cn(
                  'flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-4 text-center',
                  dragging ? 'border-sky-500 bg-sky-500/10' : 'border-muted-foreground/25 hover:border-sky-500/50',
                )}
              >
                <input
                  id="setup-request-files"
                  type="file"
                  multiple
                  accept={ACCEPT}
                  className="sr-only"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) addFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
                <Upload className="size-6 text-muted-foreground" aria-hidden="true" />
                <p className="mt-2 text-sm font-medium">Drop files here or click to browse</p>
                <p className="mt-1 text-xs text-muted-foreground">Up to 5 files, 10 MB each. Spreadsheet, PDF, photo or text.</p>
              </label>

              {files.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {files.map((file, index) => (
                    <li key={`${file.name}-${file.size}-${index}`} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">
                        {file.name} <span className="text-muted-foreground">({formatBytes(file.size)})</span>
                      </span>
                      <button
                        type="button"
                        className="shrink-0 text-xs text-muted-foreground underline-offset-4 hover:underline"
                        onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="space-y-2">
                <label htmlFor="setup-request-note" className="text-sm font-medium">
                  Anything we should know?
                </label>
                <Textarea
                  id="setup-request-note"
                  value={note}
                  maxLength={2000}
                  rows={4}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              {error && (
                <p className="text-sm text-rose-700 dark:text-rose-300" role="alert">
                  {error}
                </p>
              )}

              <DialogFooter>
                <Button type="submit" disabled={sending}>
                  {sending ? 'Sending…' : 'Send'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

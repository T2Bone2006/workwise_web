'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { FileSpreadsheet, ImagePlus, NotebookPen, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { SpreadsheetDropzone } from '@/components/import/spreadsheet-dropzone';
import { IconChip } from '@/components/rounds/overview/shared';
import { MAX_ROUND_BOOK_TEXT_CHARS } from '@/lib/import/round-book-limits';
import { cn } from '@/lib/utils';

const MAX_PHOTOS = 10;
const PHOTO_ACCEPT = '.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf';

/**
 * The first screen: two ways in. A spreadsheet (read as soon as it is dropped),
 * or a round book (photos you add and then read, or a list you type or paste).
 * Photos and text can't be mixed; the card switches cleanly between them.
 */
export function ChooseSource({
  onSpreadsheet,
  onPhotos,
  onText,
}: {
  onSpreadsheet: (file: File) => void;
  onPhotos: (files: File[]) => void;
  onText: (text: string) => void;
}) {
  const [mode, setMode] = useState<'photos' | 'text'>('photos');
  const [photos, setPhotos] = useState<File[]>([]);
  const [text, setText] = useState('');
  const [dragging, setDragging] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);

  const previews = useMemo(
    () => photos.map((file) => ({ file, url: file.type.startsWith('image/') && !/heic|heif/.test(file.type) ? URL.createObjectURL(file) : null })),
    [photos]
  );

  // Let go of the preview URLs when the photo list changes or this screen goes away.
  useEffect(() => () => previews.forEach((p) => p.url && URL.revokeObjectURL(p.url)), [previews]);

  const addPhotos = (incoming: FileList | File[]) => {
    setPhotos((prev) => [...prev, ...Array.from(incoming)].slice(0, MAX_PHOTOS));
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="glass-card gap-4 border-sky-500/25 p-5">
          <div className="flex items-start gap-3">
            <IconChip icon={FileSpreadsheet} tone="sky" />
            <div>
              <h2 className="text-base font-semibold">Spreadsheet</h2>
              <p className="text-sm text-muted-foreground">
                CSV or Excel from Squeegee, CleanerPlanner or your own sheet. Any layout — we work out the columns.
              </p>
            </div>
          </div>
          <SpreadsheetDropzone
            file={null}
            onFile={onSpreadsheet}
            inputId="rounds-import-sheet"
            hint=".csv or .xlsx · we read it as soon as you drop it"
          />
        </Card>

        <Card className="glass-card gap-4 border-violet-500/25 p-5">
          <div className="flex items-start gap-3">
            <IconChip icon={NotebookPen} tone="violet" />
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold">Round book</h2>
              <p className="text-sm text-muted-foreground">
                Photos of your paper round book, or a list you type in. Handwriting is fine.
              </p>
            </div>
          </div>

          <div className="inline-flex w-fit rounded-lg bg-muted p-0.5 text-sm" role="tablist" aria-label="Round book input">
            {(['photos', 'text'] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  'rounded-md px-3 py-1 font-medium transition-colors',
                  mode === m ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {m === 'photos' ? 'Photos' : 'Type or paste'}
              </button>
            ))}
          </div>

          {mode === 'photos' ? (
            <div className="space-y-3">
              <div
                role="button"
                tabIndex={0}
                onClick={() => photoInput.current?.click()}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && photoInput.current?.click()}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  addPhotos(e.dataTransfer.files);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                className={cn(
                  'flex min-h-[110px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-4 text-center',
                  dragging ? 'border-violet-500 bg-violet-500/10' : 'border-muted-foreground/25 hover:border-violet-500/50'
                )}
              >
                <ImagePlus className="size-8 text-muted-foreground" />
                <p className="mt-1 text-sm font-medium">Add photos of your round book</p>
                <p className="text-xs text-muted-foreground">Up to {MAX_PHOTOS} · JPG, PNG, iPhone photos or a PDF</p>
                <input
                  ref={photoInput}
                  type="file"
                  accept={PHOTO_ACCEPT}
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) addPhotos(e.target.files);
                    e.target.value = '';
                  }}
                />
              </div>

              {previews.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {previews.map(({ file, url }, i) => (
                    <li key={`${file.name}-${i}`} className="relative">
                      {url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url} alt={file.name} className="size-16 rounded-lg border object-cover" />
                      ) : (
                        <span className="flex size-16 items-center justify-center rounded-lg border bg-muted px-1 text-center text-[10px] text-muted-foreground">
                          {file.name.slice(0, 18)}
                        </span>
                      )}
                      <button
                        type="button"
                        aria-label={`Remove ${file.name}`}
                        onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                        className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border bg-background shadow-sm"
                      >
                        <X className="size-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <Button disabled={photos.length === 0} onClick={() => onPhotos(photos)} className="w-full sm:w-auto">
                {photos.length === 0 ? 'Read my photos' : `Read ${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}`}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, MAX_ROUND_BOOK_TEXT_CHARS))}
                rows={7}
                placeholder={'Maple Close TN23 4AB\n14 Henderson 15 4w\n16 Mrs Patel £12 8wk'}
                aria-label="Type or paste your list"
              />
              <div className="flex items-center justify-between gap-3">
                <Button disabled={text.trim().length === 0} onClick={() => onText(text)}>
                  Read my list
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {text.length.toLocaleString('en-GB')} / {MAX_ROUND_BOOK_TEXT_CHARS.toLocaleString('en-GB')}
                </span>
              </div>
            </div>
          )}
        </Card>
      </div>

      <p className="text-center text-sm text-muted-foreground">Nothing is saved until you press Import.</p>
    </div>
  );
}

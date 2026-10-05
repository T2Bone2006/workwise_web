'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRightLeft, Camera, FileSpreadsheet, ImagePlus, LifeBuoy, X, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LookCard, IconChip, type Tone } from '@/components/look';
import { StuckLink } from '@/components/import/rounds/stuck-link';
import { Textarea } from '@/components/ui/textarea';
import { SpreadsheetDropzone } from '@/components/import/spreadsheet-dropzone';
import { MAX_ROUND_BOOK_TEXT_CHARS } from '@/lib/import/round-book-limits';
import { cn } from '@/lib/utils';

const MAX_PHOTOS = 10;
const PHOTO_ACCEPT = '.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf';

type Source = 'sheet' | 'app' | 'book' | 'help';

const SOURCES: { key: Source; title: string; line: string; icon: LucideIcon; tone: Tone }[] = [
  { key: 'sheet', title: 'A spreadsheet', line: 'CSV or Excel, any layout. We work out the columns.', icon: FileSpreadsheet, tone: 'rounds' },
  { key: 'app', title: 'Squeegee or CleanerPlanner', line: 'Use the customer export from your old app.', icon: ArrowRightLeft, tone: 'indigo' },
  { key: 'book', title: 'Photos of my round book', line: 'Our AI reads it, then you check it.', icon: Camera, tone: 'violet' },
  { key: 'help', title: 'Do it for me', line: "Send us your file and we'll set it up.", icon: LifeBuoy, tone: 'teal' },
];

/**
 * The first screen: four ways in. A spreadsheet (read as soon as it is dropped),
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
  const [source, setSource] = useState<Source>('sheet');
  const [helpOpen, setHelpOpen] = useState(false);
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

  const picked = SOURCES.find((item) => item.key === source) ?? SOURCES[0]!;

  return (
    <div className="space-y-5">
      <div role="radiogroup" aria-label="Where is your round now?" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {SOURCES.map((item) => {
          const active = item.key === source;
          return (
            <button
              key={item.key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setSource(item.key)}
              className={cn(
                'flex flex-col items-start gap-3 rounded-2xl border bg-card p-4 text-left shadow-(--look-card-shadow) transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                active ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-(--tone-slate-solid)/40',
              )}
            >
              <IconChip icon={item.icon} tone={item.tone} />
              <span>
                <span className="block text-[15px] font-semibold">{item.title}</span>
                <span className="mt-0.5 block text-sm text-muted-foreground">{item.line}</span>
              </span>
            </button>
          );
        })}
      </div>

      <LookCard title={picked.title} icon={picked.icon} tone={picked.tone}>
        {source === 'sheet' || source === 'app' ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {source === 'app'
                ? 'Export your customers from the app as a CSV or Excel file, then drop it here. We match their columns to ours.'
                : 'CSV or Excel from your own sheet. Any layout. We work out the columns, and you check them before anything is saved.'}
            </p>
            <SpreadsheetDropzone
              file={null}
              onFile={onSpreadsheet}
              inputId="rounds-import-sheet"
              hint=".csv or .xlsx · we read it as soon as you drop it"
            />
          </div>
        ) : null}

        {source === 'book' ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Photos of your paper round book, or a list you type in. Handwriting is fine.
            </p>
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
          </div>
        ) : null}

        {source === 'help' ? (
          <div className="space-y-3">
            <p className="text-sm">
              Got a file, a pile of photos or just a messy list? Send it to us and we&apos;ll get your round set up for you.
            </p>
            <Button onClick={() => setHelpOpen(true)}>Send us my file</Button>
            <p className="text-xs text-muted-foreground">
              We&apos;ll email you within 2 working days. Trying the import yourself first is usually quicker.
            </p>
            <StuckLink context="review" open={helpOpen} onOpenChange={setHelpOpen} />
          </div>
        ) : null}
      </LookCard>

      <p className="text-center text-sm text-muted-foreground">Nothing is saved until you press Import.</p>
    </div>
  );
}

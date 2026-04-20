'use client';

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { JobAttachmentRow } from '@/lib/utils/job-attachments';

interface JobDetailPhotosCardProps {
  beforePhotos: JobAttachmentRow[];
  afterPhotos: JobAttachmentRow[];
}

function PhotoGrid({
  items,
  onOpen,
}: {
  items: JobAttachmentRow[];
  onOpen: (url: string, label: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {items.map((att) => (
        <button
          key={att.id}
          type="button"
          onClick={() => onOpen(att.file_url, att.file_name)}
          className="group relative aspect-square overflow-hidden rounded-md border border-border/80 bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- remote Supabase URLs; avoid remotePatterns setup */}
          <img
            src={att.file_url}
            alt={att.file_name}
            className="size-full object-cover transition-transform group-hover:scale-[1.02]"
            loading="lazy"
          />
        </button>
      ))}
    </div>
  );
}

export function JobDetailPhotosCard({ beforePhotos, afterPhotos }: JobDetailPhotosCardProps) {
  const [lightbox, setLightbox] = React.useState<{ url: string; label: string } | null>(null);

  return (
    <>
      <Card
        className={cn(
          'glass-card overflow-hidden border-border/80 transition-all duration-300',
          'backdrop-blur-[var(--blur-glass)] shadow-[var(--shadow-glass-value)]'
        )}
      >
        <CardHeader className="pb-3">
          <h2 className="text-base font-semibold text-foreground">Photos</h2>
        </CardHeader>
        <CardContent className="space-y-6">
          {beforePhotos.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-foreground">Before photos</h3>
              <PhotoGrid items={beforePhotos} onOpen={(url, label) => setLightbox({ url, label })} />
            </div>
          )}
          {afterPhotos.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-foreground">After photos</h3>
              <PhotoGrid items={afterPhotos} onOpen={(url, label) => setLightbox({ url, label })} />
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={lightbox != null} onOpenChange={(open) => !open && setLightbox(null)}>
        <DialogContent
          className="max-h-[min(90vh,900px)] max-w-[min(96vw,1100px)] border-none bg-transparent p-2 shadow-none sm:max-w-[min(96vw,1100px)]"
          showCloseButton
        >
          <DialogTitle className="sr-only">{lightbox?.label ?? 'Photo'}</DialogTitle>
          {lightbox && (
            <div className="flex max-h-[min(85vh,860px)] flex-col items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={lightbox.url}
                alt={lightbox.label}
                className="max-h-[min(80vh,820px)] w-auto max-w-full rounded-md object-contain"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

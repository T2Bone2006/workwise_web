'use client';

import { useState } from 'react';
import { Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

type SpreadsheetDropzoneProps = {
  file: File | null;
  onFile: (file: File) => void;
  inputId?: string;
  disabled?: boolean;
  hint?: string;
};

/** Drop-or-browse box for a .csv / .xlsx file. Shared by the Pro and Rounds importers. */
export function SpreadsheetDropzone({
  file,
  onFile,
  inputId = 'csv-file-input',
  disabled = false,
  hint,
}: SpreadsheetDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  return (
    <div
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        if (disabled) return;
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setIsDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setIsDragging(false);
      }}
      className={cn(
        'flex min-h-[200px] flex-col items-center justify-center rounded-xl border-2 border-dashed p-8',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        isDragging
          ? 'border-brand-primary bg-brand-primary/10'
          : 'border-muted-foreground/25 hover:border-brand-primary/50'
      )}
      onClick={() => {
        if (!disabled) document.getElementById(inputId)?.click();
      }}
    >
      <input
        id={inputId}
        type="file"
        accept=".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          // Same file picked again after a failure should still fire onChange.
          e.target.value = '';
        }}
      />
      <Upload className="size-10 text-muted-foreground" />
      <p className="mt-2 text-sm font-medium">
        {file ? file.name : 'Drop file here or click to browse'}
      </p>
      {hint ? <p className="mt-1 text-center text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

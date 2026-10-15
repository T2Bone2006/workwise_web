'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { setCompanyLogo } from '@/lib/actions/payment-settings';
import { BUSINESS_ASSETS_BUCKET, logoObjectPath } from '@/lib/business/logo';
import { createBrowserClient } from '@/lib/supabase/client';

const MAX_BYTES = 2 * 1024 * 1024;

export function CompanyLogoUpload({
  tenantId,
  logoUrl,
}: {
  tenantId: string;
  logoUrl: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(logoUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);

    const isPng = file.type === 'image/png';
    const isJpeg = file.type === 'image/jpeg';
    if (!isPng && !isJpeg) {
      setError('Use a PNG or JPG');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('Logo must be under 2 MB');
      return;
    }

    setBusy(true);
    const path = logoObjectPath(tenantId, isPng ? 'png' : 'jpg');
    const supabase = createBrowserClient();
    const { error: uploadError } = await supabase.storage
      .from(BUSINESS_ASSETS_BUCKET)
      .upload(path, file, { upsert: false, contentType: file.type });

    if (uploadError) {
      setBusy(false);
      setError(uploadError.message || 'Could not upload the logo.');
      return;
    }

    const result = await setCompanyLogo(path);
    setBusy(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setCurrentUrl(result.logoUrl ?? null);
    toast.success('Logo updated');
  }

  async function onRemove() {
    setError(null);
    setBusy(true);
    const result = await setCompanyLogo(null);
    setBusy(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setCurrentUrl(null);
    toast.success('Logo removed');
  }

  return (
    <div className="space-y-3">
      <div className="flex h-20 w-[200px] items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-muted/30">
        {currentUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentUrl}
            alt="Business logo"
            className="max-h-20 max-w-[200px] object-contain"
          />
        ) : (
          <span className="text-sm text-muted-foreground">No logo yet</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Square or wide logos work best. It appears on invoices, your pay page and emails.
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            void onFile(file);
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          Upload logo
        </Button>
        {currentUrl ? (
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void onRemove()}>
            Remove
          </Button>
        ) : null}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

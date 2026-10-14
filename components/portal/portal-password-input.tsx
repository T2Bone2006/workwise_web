'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authInputClassName, authLabelClassName } from '@/components/auth/auth-shell';
import { cn } from '@/lib/utils';

export function PortalPasswordInput({
  id,
  label,
  value,
  onChange,
  disabled,
  autoComplete,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoComplete: string;
  error?: string | null;
}) {
  const [show, setShow] = useState(false);

  return (
    <div className="grid gap-2">
      <Label htmlFor={id} className={authLabelClassName}>
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          type={show ? 'text' : 'password'}
          placeholder="••••••••"
          autoComplete={autoComplete}
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(authInputClassName, 'pr-12')}
        />
        <button
          type="button"
          className="absolute right-1.5 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-[#6E6A63] hover:bg-black/5 hover:text-[#0A1A2E] dark:text-[#93A3BA] dark:hover:bg-white/10 dark:hover:text-[#EAF1FB]"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? 'Hide password' : 'Show password'}
          tabIndex={-1}
        >
          {show ? <EyeOff className="size-[18px]" aria-hidden /> : <Eye className="size-[18px]" aria-hidden />}
        </button>
      </div>
      {error ? <p className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
    </div>
  );
}

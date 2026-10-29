'use client';

import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Opens the browser's print window. Choosing "Save as PDF" there makes the file. */
export function PortalPrintButton() {
  return (
    <Button type="button" size="sm" className="gap-2" onClick={() => window.print()}>
      <Printer className="size-4" aria-hidden />
      Save as PDF
    </Button>
  );
}

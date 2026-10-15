'use client';

import { useEffect } from 'react';
import { Toaster, toast } from 'sonner';
import { floatingMessage } from '@/components/look/floating-message';
import { FloatingMessageHost } from '@/components/look/floating-message';

type ToastOptions = {
  description?: unknown;
  duration?: number;
  action?: { label?: unknown; onClick?: (event: unknown) => void } | unknown;
};

/** The new look (Rounds and Lite logins) sets data-look="new" on <html>; Pro and the portal never do. */
function isNewLook(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.look === 'new';
}

let patched = false;

/**
 * In the new look every `toast.success / info / message / warning / error` call shows the floating
 * message instead (same words, same call shape). In the classic look, and for anything that is not
 * plain text, sonner shows its own toast exactly as before.
 */
function routeToastsToFloatingMessage(): void {
  if (patched) return;
  patched = true;
  const methods = ['success', 'info', 'message', 'warning', 'error'] as const;
  for (const method of methods) {
    const original = toast[method].bind(toast) as (message: unknown, options?: ToastOptions) => string | number;
    (toast as unknown as Record<string, unknown>)[method] = (message: unknown, options?: ToastOptions) => {
      if (!isNewLook() || typeof message !== 'string') return original(message, options);
      const action = options?.action as { label?: unknown; onClick?: (event: unknown) => void } | undefined;
      const label = action && typeof action.label === 'string' ? action.label : null;
      floatingMessage({
        title: message,
        body: typeof options?.description === 'string' ? options.description : undefined,
        tone: method === 'error' ? 'error' : method === 'success' ? 'success' : 'default',
        durationMs: options?.duration,
        actions: label && action?.onClick ? [{ label, onClick: () => action.onClick?.(undefined) }] : [],
      });
      return 0;
    };
  }
}

export function AppToaster() {
  useEffect(() => {
    routeToastsToFloatingMessage();
  }, []);
  return (
    <>
      <Toaster richColors position="top-center" />
      <FloatingMessageHost />
    </>
  );
}

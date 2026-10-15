'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAssistantChat } from '@/components/assistant/use-assistant-chat';
import type { PageContext } from '@/lib/assistant/shared';
import { formatBoardDay } from '@/lib/rounds/week-board';

type Chat = ReturnType<typeof useAssistantChat>;

type AskContextValue = {
  /** Your assistant (the page): carries on its own chat. */
  pageChat: Chat;
  /** Quick ask (the docked panel on other pages): fresh each time it opens. */
  quickChat: Chat;
  quickOpen: boolean;
  openQuick: () => void;
  closeQuick: () => void;
  /** The sidebar Ask bar and ⌘K: go to the Your assistant page (or jump to its box when already there). */
  ask: () => void;
  hasRounds: boolean;
  hasLite: boolean;
  hasPro: boolean;
  /** Brand blue (Rounds and Pro); Lite on its own is purple. */
  blue: boolean;
};

const AskContext = createContext<AskContextValue | null>(null);

/** Null when the login has no assistant. */
export function useAsk(): AskContextValue | null {
  return useContext(AskContext);
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

const SECTIONS: Record<string, string> = {
  dashboard: 'Dashboard',
  customers: 'Customers',
  calendar: 'Calendar',
  services: 'Services',
  payments: 'Payments',
  messages: 'Messages',
  expenses: 'Expenses',
  settings: 'Settings',
  import: 'Import',
  lite: 'Leads',
  jobs: 'Jobs',
  workers: 'Workers',
  network: 'Network',
  monitor: 'Monitor',
  refer: 'Refer a friend',
};

/** What "this" means on the page they're on: sent with each question and shown by the box. */
export function pageContext(pathname: string, params: URLSearchParams): PageContext {
  const customer = pathname.match(new RegExp(`^/customers/(${UUID})`, 'i'));
  if (customer) return { path: pathname, customerId: customer[1], label: 'This customer' };
  const job = pathname.match(new RegExp(`^/jobs/(${UUID})`, 'i'));
  if (job) return { path: pathname, jobId: job[1], label: 'This job' };
  const worker = pathname.match(new RegExp(`^/workers/(${UUID})`, 'i'));
  if (worker) return { path: pathname, workerId: worker[1], label: 'This worker' };
  const lead = pathname.match(new RegExp(`^/lite/leads/(${UUID})`, 'i'));
  if (lead) return { path: pathname, leadId: lead[1], label: 'This lead' };
  if (pathname.startsWith('/lite/conversations')) return { path: pathname, label: 'Website chats' };
  if (pathname.startsWith('/lite/widget')) return { path: pathname, label: 'Website chat settings' };
  if (pathname.startsWith('/calendar')) {
    const date = params.get('date');
    const valid = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
    const view = params.get('view') === 'day' ? 'day' : params.get('view') === 'month' ? 'month' : 'week';
    return { path: pathname, label: valid ? `Calendar, ${formatBoardDay(valid)}` : `Calendar, ${view} view`, ...(valid ? { date: valid } : {}) };
  }
  const section = SECTIONS[pathname.split('/')[1] ?? ''];
  return { path: pathname, ...(section ? { label: section } : {}) };
}

/**
 * The assistant for the whole dashboard. Two chats: the Your assistant page
 * (carries on until 45 quiet minutes or Clear) and quick ask, a panel docked
 * beside whatever page you're on, which starts fresh every time it opens.
 * Neither keeps a list of old chats.
 */
export function AskProvider({ hasRounds, hasLite, hasPro, children }: { hasRounds: boolean; hasLite: boolean; hasPro: boolean; children: React.ReactNode }) {
  const router = useRouter();
  const onChanged = useCallback(() => router.refresh(), [router]);
  const pageChat = useAssistantChat({ mode: 'page', onChanged });
  const quickChat = useAssistantChat({ mode: 'quick', onChanged });
  const [quickOpen, setQuickOpen] = useState(false);
  const refreshQuick = quickChat.refresh;

  const openQuick = useCallback(() => {
    setQuickOpen(true);
    void refreshQuick();
  }, [refreshQuick]);
  const closeQuick = useCallback(() => setQuickOpen(false), []);

  // The sidebar Ask bar and ⌘K: the full Your assistant page (focus its box if already there).
  const ask = useCallback(() => {
    if (window.location.pathname.startsWith('/assistant')) {
      document.getElementById('ask-input')?.focus();
      return;
    }
    router.push('/assistant');
  }, [router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ask();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ask]);

  const value = useMemo(
    () => ({ pageChat, quickChat, quickOpen, openQuick, closeQuick, ask, hasRounds, hasLite, hasPro, blue: hasRounds || hasPro }),
    [pageChat, quickChat, quickOpen, openQuick, closeQuick, ask, hasRounds, hasLite, hasPro],
  );

  return <AskContext.Provider value={value}>{children}</AskContext.Provider>;
}

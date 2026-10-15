'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type {
  AssistantAction,
  AssistantPart,
  AssistantSession,
  AssistantTurn,
  PageContext,
  StreamEvent,
} from '@/lib/assistant/shared';

export type ChatState = {
  conversationId: string | null;
  turns: AssistantTurn[];
  /** Changes made today, newest first, each with Undo while it's allowed. */
  doneToday: AssistantAction[];
  busy: boolean;
  /** What a tool is doing right now, e.g. "Looking at your calendar". */
  status: string | null;
  error: string | null;
  questionsLeft: number | null;
  /** The session has been fetched at least once. */
  loaded: boolean;
};

const EMPTY: ChatState = {
  conversationId: null,
  turns: [],
  doneToday: [],
  busy: false,
  status: null,
  error: null,
  questionsLeft: null,
  loaded: false,
};

function appendPart(turns: AssistantTurn[], part: AssistantPart): AssistantTurn[] {
  const last = turns[turns.length - 1];
  if (!last || last.role !== 'assistant') return turns;
  const parts = [...last.parts];
  const tail = parts[parts.length - 1];
  if (part.type === 'text' && tail?.type === 'text') parts[parts.length - 1] = { type: 'text', text: tail.text + part.text };
  else parts.push(part);
  return [...turns.slice(0, -1), { ...last, parts }];
}

function mapAction(turns: AssistantTurn[], id: string, fn: (a: AssistantAction) => AssistantAction): AssistantTurn[] {
  return turns.map((t) => ({
    ...t,
    parts: t.parts.map((p) => (p.type === 'action' && p.action.id === id ? { type: 'action', action: fn(p.action) } : p)),
  }));
}

function upsertDone(list: AssistantAction[], action: AssistantAction): AssistantAction[] {
  if (action.status !== 'done' && action.status !== 'undone') return list;
  const rest = list.filter((a) => a.id !== action.id);
  return list.some((a) => a.id === action.id) ? list.map((a) => (a.id === action.id ? action : a)) : [action, ...rest];
}

const PAGE_CHAT_KEY = 'workwise.assistant.pageChat';

function readPageChat(): string | null {
  try {
    return localStorage.getItem(PAGE_CHAT_KEY);
  } catch {
    return null;
  }
}

function writePageChat(id: string | null) {
  try {
    if (id) localStorage.setItem(PAGE_CHAT_KEY, id);
    else localStorage.removeItem(PAGE_CHAT_KEY);
  } catch {
    // Private window: the page just starts fresh next time.
  }
}

/**
 * One assistant chat. There is no list of old chats.
 * - 'page' (Your assistant): carries on the chat it was in, which the server
 *   ends after 45 quiet minutes or on Clear. The id lives in this browser.
 * - 'quick' (the panel on other pages): starts fresh every time it opens.
 * Answers stream in as NDJSON.
 */
export function useAssistantChat(opts: { mode: 'page' | 'quick'; onChanged?: () => void }) {
  const { mode } = opts;
  const [state, setState] = useState<ChatState>(EMPTY);
  const abortRef = useRef<AbortController | null>(null);
  const convRef = useRef<string | null>(null);
  const onChangedRef = useRef(opts.onChanged);
  onChangedRef.current = opts.onChanged;

  /**
   * Page: picks up where they left off (or a fresh start). Quick: always a fresh
   * start. Both fetch today's changes and the questions left.
   */
  const refresh = useCallback(async () => {
    if (abortRef.current) return; // never swap the thread out under an answer that's still coming in
    const id = mode === 'page' ? readPageChat() : null;
    if (mode === 'quick') {
      convRef.current = null;
      setState((s) => ({ ...EMPTY, doneToday: s.doneToday, questionsLeft: s.questionsLeft }));
    }
    try {
      const res = await fetch(`/api/assistant/session${id ? `?conversation=${encodeURIComponent(id)}` : ''}`, { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const session = (await res.json()) as AssistantSession;
      if (mode === 'page') {
        convRef.current = session.conversationId;
        if (!session.conversationId) writePageChat(null);
      }
      setState((s) => ({
        ...s,
        ...(mode === 'page' ? { conversationId: session.conversationId, turns: session.turns } : {}),
        doneToday: session.doneToday,
        questionsLeft: session.questionsLeft,
        loaded: true,
        error: null,
      }));
    } catch {
      setState((s) => ({ ...s, loaded: true }));
    }
  }, [mode]);

  const clear = useCallback(async () => {
    abortRef.current?.abort();
    const id = convRef.current;
    convRef.current = null;
    if (mode === 'page') writePageChat(null);
    setState((s) => ({ ...EMPTY, doneToday: s.doneToday, questionsLeft: s.questionsLeft, loaded: true }));
    if (id) await fetch(`/api/assistant/session?conversation=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => undefined);
  }, [mode]);

  const send = useCallback(async (message: string, page?: PageContext | null) => {
    const text = message.trim();
    if (!text || abortRef.current) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const conversationId = convRef.current;
    const now = new Date().toISOString();
    setState((s) => ({
      ...s,
      busy: true,
      status: null,
      error: null,
      turns: [
        ...s.turns,
        { id: `q-${now}`, role: 'user', parts: [{ type: 'text', text }], createdAt: now },
        { id: `a-${now}`, role: 'assistant', parts: [], createdAt: now },
      ],
    }));

    const apply = (event: StreamEvent) => {
      if (event.type === 'conversation') {
        const restarted = event.fresh && conversationId != null;
        convRef.current = event.id;
        if (mode === 'page') writePageChat(event.id);
        // The old chat went quiet: keep only this question on screen.
        setState((s) => ({ ...s, conversationId: event.id, turns: restarted ? s.turns.slice(-2) : s.turns }));
      } else if (event.type === 'text') {
        setState((s) => ({ ...s, status: null, turns: appendPart(s.turns, { type: 'text', text: event.delta }) }));
      } else if (event.type === 'status') {
        setState((s) => ({ ...s, status: event.label }));
      } else if (event.type === 'card') {
        setState((s) => ({ ...s, status: null, turns: appendPart(s.turns, { type: 'card', card: event.card }) }));
      } else if (event.type === 'action') {
        setState((s) => ({ ...s, status: null, turns: appendPart(s.turns, { type: 'action', action: event.action }) }));
      } else if (event.type === 'done') {
        setState((s) => ({ ...s, questionsLeft: event.questionsLeft }));
      } else if (event.type === 'error') {
        setState((s) => ({ ...s, error: event.message }));
      }
    };

    try {
      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, message: text, page: page ?? null }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error && body.error.length < 120 ? body.error : 'failed');
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl = buffer.indexOf('\n');
        while (nl >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line) {
            try {
              apply(JSON.parse(line) as StreamEvent);
            } catch {
              // A broken line is skipped; the rest of the answer still shows.
            }
          }
          nl = buffer.indexOf('\n');
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        const msg = err instanceof Error && err.message !== 'failed' ? err.message : "Couldn't reach the assistant. Check your connection and try again.";
        setState((s) => ({ ...s, error: msg }));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setState((s) => ({
        ...s,
        busy: false,
        status: null,
        turns: s.turns.filter((t, i) => !(i === s.turns.length - 1 && t.role === 'assistant' && t.parts.length === 0)),
      }));
    }
  }, [mode]);

  const decide = useCallback(async (actionId: string, decision: 'confirm' | 'cancel' | 'undo') => {
    const running = (a: AssistantAction): AssistantAction => ({ ...a, status: 'running', error: undefined });
    if (decision !== 'cancel') {
      setState((s) => ({ ...s, turns: mapAction(s.turns, actionId, running), doneToday: s.doneToday.map((a) => (a.id === actionId ? running(a) : a)) }));
    }
    try {
      const res = await fetch(`/api/assistant/actions/${actionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      const body = (await res.json().catch(() => null)) as { action?: AssistantAction; error?: string } | null;
      if (!body?.action) throw new Error(body?.error ?? 'failed');
      const action = body.error ? { ...body.action, error: body.error } : body.action;
      setState((s) => ({
        ...s,
        turns: mapAction(s.turns, actionId, () => action),
        doneToday: upsertDone(s.doneToday, action),
      }));
      if (action.status === 'done' || action.status === 'undone') onChangedRef.current?.();
    } catch {
      const back = (a: AssistantAction): AssistantAction => ({
        ...a,
        status: decision === 'undo' ? 'done' : 'pending',
        error: "Couldn't reach WorkWise. Try again.",
      });
      setState((s) => ({ ...s, turns: mapAction(s.turns, actionId, back), doneToday: s.doneToday.map((a) => (a.id === actionId ? back(a) : a)) }));
    }
  }, []);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  return useMemo(() => ({ state, send, decide, refresh, clear, stop }), [state, send, decide, refresh, clear, stop]);
}

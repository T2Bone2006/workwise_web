// No 'server-only': the web chat imports these, and the phone keeps a copy
// (workwise-mobile/src/lib/assistant/types.ts). Change both together.

/** A colour with one meaning (docs/DASHBOARD-LOOK.md tones). */
export type CardTone = 'sky' | 'emerald' | 'rose' | 'amber' | 'indigo' | 'teal' | 'violet' | 'slate' | 'lite';

export type StatsCard = {
  type: 'stats';
  title?: string;
  items: Array<{ label: string; value: string; tone?: CardTone; hint?: string }>;
};

export type BarChartCard = {
  type: 'bar_chart';
  title: string;
  /** Each series is drawn in its tone and named in the legend. */
  series: Array<{ key: string; label: string; tone: CardTone }>;
  points: Array<{ label: string; values: Record<string, number> }>;
};

export type ListCard = {
  type: 'list';
  title: string;
  /** Rows are people (customers, leads): shown with their initials. Otherwise a small coloured dot. */
  people?: boolean;
  items: Array<{
    id?: string;
    title: string;
    subtitle?: string;
    /** Already formatted, e.g. "£45". */
    amount?: string;
    tone?: CardTone;
    tag?: string;
    /** Web path; the phone ignores it. */
    href?: string;
  }>;
  /** Shown under the list, e.g. "12 more not shown". */
  footer?: string;
  total?: { label: string; value: string; tone?: CardTone };
};

export type ScheduleStop = {
  id: string;
  customer: string;
  address: string;
  service: string;
  amount: string | null;
  status: 'to_do' | 'done' | 'skipped' | 'other';
  time?: string | null;
};

export type ScheduleCard = {
  type: 'schedule';
  title: string;
  days: Array<{ date: string; label: string; total: string; stops: ScheduleStop[]; href?: string }>;
  footer?: string;
};

export type MapCard = {
  type: 'map';
  title: string;
  /** Set for a day's round (numbered pins in round order); absent for a set of customers. */
  date?: string;
  stops: Array<{ id: string; order: number; customer: string; address: string; lat: number; lng: number; status: ScheduleStop['status'] }>;
  /** Stops with no map position, listed under the map. */
  missing: number;
  /** Stops placed by their postcode area only (the full postcode wasn't found). */
  approximate?: number;
};

export type CustomerCard = {
  type: 'customer';
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  active: boolean;
  owed: string | null;
  credit: string | null;
  services: Array<{ title: string; price: string; often: string; status: 'active' | 'paused' | 'ended'; next: string | null }>;
  lastVisit: string | null;
  nextVisit: string | null;
  href: string;
};

export type AssistantCard = StatsCard | BarChartCard | ListCard | ScheduleCard | MapCard | CustomerCard;

export type ActionStatus = 'pending' | 'running' | 'done' | 'cancelled' | 'failed' | 'undone' | 'expired';

/** The Do it / Cancel card. Nothing changes until the trader taps Do it. */
export type AssistantAction = {
  id: string;
  kind: string;
  status: ActionStatus;
  title: string;
  lines: string[];
  /** Wording on the main button, e.g. "Move them". */
  confirmLabel: string;
  tone: CardTone;
  /** Small print under the lines, e.g. "Customers aren't told." */
  note?: string;
  /** After Do it: what happened, in a sentence. */
  result?: string;
  error?: string;
  canUndo: boolean;
  /** Web path to look at the result. */
  href?: string;
};

export type AssistantPart =
  | { type: 'text'; text: string }
  | { type: 'card'; card: AssistantCard }
  | { type: 'action'; action: AssistantAction };

export type AssistantTurn = {
  id: string;
  role: 'user' | 'assistant';
  parts: AssistantPart[];
  createdAt: string;
};

/** What the Ask panel opens with: the chat still in progress (if any) and today's changes. */
export type AssistantSession = {
  conversationId: string | null;
  turns: AssistantTurn[];
  doneToday: AssistantAction[];
  questionsLeft: number | null;
};

/** Where the trader is when they ask (sent with each question). */
export type PageContext = {
  path?: string;
  customerId?: string;
  date?: string;
  leadId?: string;
  /** Pro: the job or worker page they are on. */
  jobId?: string;
  workerId?: string;
  label?: string;
};

/** One line of the chat route's NDJSON stream. */
export type StreamEvent =
  /** fresh = a new chat was started (the old one was cleared or went quiet), so drop earlier turns. */
  | { type: 'conversation'; id: string; title: string; fresh: boolean }
  | { type: 'text'; delta: string }
  | { type: 'status'; label: string }
  | { type: 'card'; card: AssistantCard }
  | { type: 'action'; action: AssistantAction }
  | { type: 'done'; questionsLeft: number | null }
  | { type: 'error'; code: 'limit' | 'failed' | 'not_found'; message: string };

export const ASSISTANT_MONTHLY_QUESTIONS = 150;

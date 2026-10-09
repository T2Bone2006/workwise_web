/**
 * Questions a window cleaner might ask, across everything the assistant does.
 * `expect` says what a good answer needs: the cards that should appear and
 * the Do it cards it should prepare (none are ever tapped).
 */
export type EvalQuestion = {
  q: string;
  page?: { path?: string; label?: string; date?: string };
  expect?: { cards?: string[]; actions?: string[]; noAction?: boolean };
};

export const QUESTIONS: EvalQuestion[] = [
  { q: "What's left to do today?" },
  { q: "Show today's round on a map", expect: { cards: ['map'] } },
  { q: 'Show tomorrow on a map', expect: { cards: ['map'] } },
  { q: 'Where am I working on Thursday? Map it please', expect: { cards: ['map'] } },
  { q: "What's on this week?", expect: { cards: ['schedule'] } },
  { q: 'Who owes me money?', expect: { cards: ['list'] } },
  { q: 'Show me a chart of money in and out for the last 6 months', expect: { cards: ['bar_chart'] } },
  { q: 'How much did I make last month?' },
  { q: 'How did last month compare with the month before?' },
  { q: 'How much have I spent on fuel this tax year?' },
  { q: 'Where could I fit a new customer?' },
  { q: "Who's due a price rise?" },
  { q: 'Which areas are my customers in? Show me', expect: { cards: ['bar_chart'] } },
  { q: 'Tell me about Raj Patel', expect: { cards: ['customer'] } },
  { q: 'Tell me about Mrs Smith' },
  { q: 'When did I last do anyone on Lapwing Lane?' },
  { q: 'List my paused customers', expect: { cards: ['list'] } },
  { q: 'What are my services and prices?' },
  { q: "It's raining. Move today's round to my next free day", expect: { actions: ['move_day'] } },
  { q: 'Skip the first stop tomorrow, no access', expect: { actions: ['skip_visits'] } },
  { q: 'I spent £48 on diesel today', expect: { actions: ['add_expense'] } },
  { q: 'Someone paid me £20 cash just now, the first person who owes me', expect: { actions: ['record_payment'] } },
  { q: 'Add a new customer: Jo Bloggs, 12 High Street, BS7 8AA, windows every 4 weeks at £18 starting next Monday', expect: { actions: ['add_customer'] } },
  { q: 'Email pay links to the two people who owe the most', expect: { actions: ['send_pay_link'] } },
  { q: 'Text all my customers that I am off next week', expect: { noAction: true } },
  { q: 'Delete all my customers', expect: { noAction: true } },
  { q: 'How do I set up Direct Debit?' },
  { q: 'What do they owe?', page: { path: '/customers/__FIRST_CUSTOMER__', label: 'This customer' } },
  { q: 'Show this day on a map', page: { path: '/calendar', label: 'Calendar', date: '__TOMORROW__' }, expect: { cards: ['map'] } },
  { q: 'Any new leads this week?' },
  { q: "My callout's gone up to £60" },
  { q: 'Show me a map of all my customers', expect: { cards: ['map'] } },
  { q: 'Chart my spending by category this tax year', expect: { cards: ['bar_chart'] } },
  { q: 'How do people pay me? Show me a chart for last month', expect: { cards: ['bar_chart'] } },
  { q: "Who's on Mauldeth Road?" },
  { q: 'How many customers do I have?' },
  { q: "Who hasn't paid in over a month?" },
  { q: 'Show me Friday', expect: { cards: ['schedule'] } },
  { q: 'What did Arjun Mehta pay last time?' },
  { q: "Pause Raj Patel's windows for 2 weeks", expect: { actions: ['pause_service'] } },
  { q: "Put Raj Patel's price up to £20", expect: { actions: ['change_price'] } },
  { q: "Move Raj Patel's next visit to the Friday after", expect: { actions: ['move_visits'] } },
  { q: "Mark Gemma Holt's lead as contacted", expect: { actions: ['set_lead_status'] } },
  { q: "What's my busiest day next week?" },
  { q: 'Where are the people who owe me money? Map them', expect: { cards: ['map'] } },
  { q: 'how much did i earn in august' },
];

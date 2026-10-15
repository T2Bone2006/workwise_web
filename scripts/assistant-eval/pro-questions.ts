import type { EvalQuestion } from './questions';

/**
 * Questions a dispatcher at a field-service office might ask Lily, run as the
 * "Pro Test" business (references PT-00xx, workers Dave Mercer, Tom Kowalski,
 * Priya Shah, Sean Fitzgerald). `expect` says what a good answer needs; Do it is never tapped.
 */
export const QUESTIONS: EvalQuestion[] = [
  { q: 'What needs me today?', expect: { cards: ['list'] } },
  { q: 'Which jobs were declined, and why?', expect: { cards: ['list'] } },
  { q: 'Which jobs were not completed in the last week, and why?', expect: { cards: ['list'] } },
  { q: 'Show me the jobs with no worker', expect: { cards: ['list'] } },
  { q: "Who's free tomorrow?", expect: { cards: ['list'] } },
  { q: 'What is everyone on today?' },
  { q: "What's Dave Mercer got on this week?" },
  { q: 'How many jobs did we finish this month?' },
  { q: 'Show me jobs per week for the last 6 weeks', expect: { cards: ['bar_chart'] } },
  { q: 'Which worker has finished the most jobs this month?' },
  { q: 'Tell me about PT-0040' },
  { q: 'What happened with PT-0036?' },
  { q: 'Show me all the jobs for Hartley', expect: { cards: ['list'] } },
  { q: 'Which customers have open jobs?', expect: { cards: ['list'] } },
  { q: 'Show me my team', expect: { cards: ['list'] } },
  { q: 'Give PT-0027 to Tom Kowalski', expect: { actions: ['assign_jobs'] } },
  { q: 'Give the jobs with no worker tomorrow to whoever is free', expect: { actions: ['assign_jobs'] } },
  { q: 'Move PT-0033 to Monday at 10am', expect: { actions: ['reschedule_jobs'] } },
  { q: 'Make PT-0040 an emergency', expect: { actions: ['set_job_priority'] } },
  { q: 'Email the summary of PT-0036 to the customer', expect: { actions: ['email_job_outcome'] } },
  { q: 'Send out all the jobs that are ready', expect: { noAction: true } },
  { q: 'Delete PT-0018', expect: { noAction: true } },
  { q: 'Create a new job for a lock change at 5 Mill Lane tomorrow', expect: { noAction: true } },
  { q: 'Invite a new worker called Sam', expect: { noAction: true } },
  { q: 'How do I send jobs out to my workers?' },
  { q: 'What happened with this job?', page: { path: '/jobs/__FIRST_JOB__', label: 'This job' } },
  { q: "What's on for them this week?", page: { path: '/workers/__FIRST_WORKER__', label: 'This worker' } },
  { q: 'whos got the most on tomorrow' },
];

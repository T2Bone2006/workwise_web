import { groupHouseStops } from '@/lib/rounds/house-stops';

/** Same visits the day plan still shows as to do. */
const SETTLED = new Set(['completed', 'cancelled', 'declined', 'incomplete']);

export function isRemainingVisit(status: string): boolean {
  return !SETTLED.has(status);
}

export type RemainingChoice = {
  jobId: string;
  customerId: string | null;
  address: string;
  postcode: string;
  sendMessage: boolean;
  sendInvoice: boolean;
};

export type NoticePlan = {
  /** One visit per house that should get the "we've been" message. */
  messages: { jobId: string; customerId: string | null; sendInvoice: boolean }[];
  /** Houses with an invoice and no message. */
  invoiceOnly: { customerId: string; jobIds: string[] }[];
};

/** After the visits are done: who gets a message, and who only gets an invoice. */
export function noticePlan(rows: RemainingChoice[]): NoticePlan {
  const groups = groupHouseStops(
    rows.map((row) => ({
      id: row.jobId,
      customer_id: row.customerId,
      address: row.address,
      postcode: row.postcode,
      sendMessage: row.sendMessage,
      sendInvoice: row.sendInvoice,
    })),
  );

  const messages: NoticePlan['messages'] = [];
  const invoiceOnly: NoticePlan['invoiceOnly'] = [];
  for (const group of groups) {
    const customerId = group.find((row) => row.customer_id)?.customer_id ?? null;
    if (group.some((row) => row.sendMessage)) {
      const first = group[0];
      if (first) {
        messages.push({
          jobId: first.id,
          customerId,
          sendInvoice: group.some((row) => row.sendInvoice),
        });
      }
      continue;
    }
    const billable = group.filter((row) => row.sendInvoice);
    if (!customerId || billable.length === 0) continue;
    invoiceOnly.push({
      customerId,
      jobIds: billable.map((row) => row.id),
    });
  }
  return { messages, invoiceOnly };
}

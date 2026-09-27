import type { ComposedMessage } from '@/lib/payments/messages';
import { emailDocument } from '@/lib/emails/visit-done';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** '8 Oct 2026' from a Ymd. */
export function formatInvoiceDueDate(ymd: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!match) return ymd;
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return ymd;
  return `${Number(match[3])} ${month} ${match[1]}`;
}

export function buildInvoiceEmail(p: {
  brand: { businessName: string; logoUrl: string | null };
  invoice: {
    number: string;
    total: string;
    balanceDue: string;
    dueDate: string;
    isPaid: boolean;
  };
  invoiceUrl: string;
  visitMessage: ComposedMessage | null;
}): { subject: string; html: string; text: string } {
  const subject = `Invoice ${p.invoice.number} from ${p.brand.businessName}`;
  const button = p.invoice.isPaid ? 'View invoice' : 'View and pay invoice';

  if (!p.visitMessage) {
    const balanceLine = p.invoice.isPaid
      ? 'This invoice is paid — thank you!'
      : `There's ${p.invoice.balanceDue} to pay by ${p.invoice.dueDate}.`;
    const paragraphs = [
      `Invoice ${p.invoice.number} is attached for you. ${balanceLine}`,
    ];
    const text = `${paragraphs[0]}\n\n${p.invoiceUrl}`;
    return {
      subject,
      text,
      html: emailDocument({
        subject,
        brand: p.brand,
        greeting: 'Hello,',
        paragraphs,
        payUrl: p.invoiceUrl,
        payLabel: button,
        bankLine: null,
        signOff: `Thanks,\n${p.brand.businessName}`,
      }),
    };
  }

  const text = `${p.visitMessage.text}\n\n${p.invoiceUrl}`;
  return {
    subject,
    text,
    html: emailDocument({
      subject,
      brand: p.brand,
      greeting: p.visitMessage.greeting,
      paragraphs: p.visitMessage.paragraphs,
      payUrl: p.invoiceUrl,
      payLabel: button,
      bankLine: p.visitMessage.bankLine,
      signOff: p.visitMessage.signOff,
    }),
  };
}

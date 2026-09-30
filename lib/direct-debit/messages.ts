import { directDebitFailedSms, directDebitInviteSms } from '@/lib/messaging/templates';
import { formatGbp } from '@/lib/money/pence';
import { firstNameForGreeting } from '@/lib/payments/messages';

/**
 * The Direct Debit invitation (D4, D3). Pure. The email button ("Set up
 * Direct Debit") goes after the first two emailParagraphs.
 */
export function composeDirectDebitInvite(p: {
  businessName: string;
  customerName: string;
  url: string;
  contactPhone: string | null;
  owedNow: number;
}): {
  subject: string;
  greeting: string;
  emailParagraphs: string[];
  sms: string;
  share: string;
} {
  const first = firstNameForGreeting(p.customerName);
  const emailParagraphs = [
    `${p.businessName} can now take payment by Direct Debit after each visit, so there's nothing to remember.`,
    "Setting it up takes 2 minutes on GoCardless's secure page:",
  ];
  if (p.owedNow > 0) {
    emailParagraphs.push(
      `The ${formatGbp(p.owedNow, { always2dp: true })} you owe now will be collected first.`,
    );
  }
  emailParagraphs.push(
    "You'll get an email before every payment, and you're protected by the Direct Debit Guarantee — you can cancel any time with your bank.",
  );

  return {
    subject: `${p.businessName}: pay by Direct Debit`,
    greeting: first ? `Hi ${first},` : 'Hello,',
    emailParagraphs,
    sms: directDebitInviteSms({
      brand: { businessName: p.businessName, contactPhone: p.contactPhone },
      url: p.url,
    }),
    share: `Hi ${first ?? 'there'}, you can now pay ${p.businessName} by Direct Debit after each visit — set it up here: ${p.url}`,
  };
}

/**
 * The "we couldn't collect it" message (D6). Pure. The email button
 * ("Pay £15.00") goes after emailParagraphs; afterButton goes under it.
 */
export function composeDirectDebitFailed(p: {
  businessName: string;
  customerName: string;
  amount: number;
  payUrl: string;
  contactPhone: string | null;
  stillActive: boolean;
}): {
  subject: string;
  greeting: string;
  emailParagraphs: string[];
  afterButton: string[];
  sms: string;
} {
  const first = firstNameForGreeting(p.customerName);
  const amount = formatGbp(p.amount, { always2dp: true });
  const afterButton: string[] = [];
  if (!p.stillActive) {
    afterButton.push(
      `Your Direct Debit with ${p.businessName} is no longer active. You can set it up again from the same page.`,
    );
  }
  afterButton.push("If you've already paid, thank you — please ignore this.");

  return {
    subject: `${p.businessName}: payment not collected`,
    greeting: first ? `Hi ${first},` : 'Hello,',
    emailParagraphs: [
      `We tried to collect ${amount} by Direct Debit, but your bank didn't pay it.`,
      'You can pay here instead:',
    ],
    afterButton,
    sms: directDebitFailedSms({
      brand: { businessName: p.businessName, contactPhone: p.contactPhone },
      amount: p.amount,
      url: p.payUrl,
    }),
  };
}

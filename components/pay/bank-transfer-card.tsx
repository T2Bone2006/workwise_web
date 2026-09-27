import type { JSX } from 'react';
import { Landmark } from 'lucide-react';
import { CopyField } from '@/components/pay/copy-field';
import type { PublicBank } from '@/lib/data/payments/public-pay';
import { formatGbp } from '@/lib/money/pence';
import { formatSortCode } from '@/lib/payments/bank-format';

export function BankTransferCard(props: {
  bank: NonNullable<PublicBank>;
  reference: string | null;
  amount: number | null;
  businessName: string;
  heading?: string;
}): JSX.Element {
  const { bank, reference, amount, businessName, heading = 'Pay by bank transfer' } = props;
  const sortDisplay = formatSortCode(bank.sortCode);

  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <span className="flex size-7 items-center justify-center rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-300">
          <Landmark className="size-3.5" />
        </span>
        {heading}
      </h2>
      <div className="space-y-2">
        <CopyField label="Name" value={bank.accountName} />
        <CopyField label="Sort code" value={bank.sortCode} display={sortDisplay || bank.sortCode} />
        <CopyField label="Account number" value={bank.accountNumber} />
        {reference ? (
          <CopyField
            label="Reference"
            value={reference}
            highlighted
            hint={`Please use this so ${businessName} knows it's you`}
          />
        ) : null}
        {amount != null && amount > 0 ? (
          <CopyField label="Amount" value={amount.toFixed(2)} display={formatGbp(amount)} />
        ) : null}
      </div>
    </section>
  );
}

import { CircleAlert } from 'lucide-react';
import { EmptyState } from '@/components/look';
import { PayPageFrame } from '@/components/pay/pay-shell';

export default function InvoiceLinkNotFound() {
  return (
    <PayPageFrame>
      <EmptyState
        icon={CircleAlert}
        title="This invoice link isn't valid"
        body="Ask whoever sent it for a new one."
      />
    </PayPageFrame>
  );
}

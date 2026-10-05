import { CircleAlert } from 'lucide-react';
import { EmptyState } from '@/components/look';

export default function AccountantLinkNotFound() {
  return (
    <EmptyState
      icon={CircleAlert}
      title="This link no longer works"
      body="Ask the business that invited you to send a new one."
    />
  );
}

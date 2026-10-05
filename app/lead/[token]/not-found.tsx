import { LeadLinkMessage, LeadPageFrame } from '@/components/lite/lead-decision-form';

export default function LeadLinkNotFound() {
  return (
    <LeadPageFrame>
      <LeadLinkMessage title="This link doesn't work. It may have been copied wrongly." />
    </LeadPageFrame>
  );
}

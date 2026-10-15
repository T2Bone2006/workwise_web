import { LiteOfferCard } from '@/components/worker/lite-offer-card';
import { getWorkerLiteOffer } from '@/lib/data/worker-lite-offer';

/**
 * Where the Lite offer sits on the worker pages. Shows for a self-employed worker who has not added Lite and is
 * still connected to a Pro business; for an employee, or anyone else, it renders nothing.
 */
export async function LiteOfferSlot() {
  const offer = await getWorkerLiteOffer();
  if (!offer) return null;
  return <LiteOfferCard employerName={offer.employerName} />;
}

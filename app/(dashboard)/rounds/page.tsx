import { redirect } from 'next/navigation';

/** /rounds is an alias for the dashboard home while the tenant's primary product is Rounds. */
export default function RoundsIndexPage() {
  redirect('/dashboard');
}

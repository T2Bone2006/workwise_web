import { redirect } from 'next/navigation';

/** The customer portal no longer sells Pro. Old links land on the jobs home. */
export default function PortalProPage() {
  redirect('/portal');
}

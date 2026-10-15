import { redirect } from 'next/navigation';

/** Old customer sign-in. Everyone uses /login; a customer is sent on to /portal. */
export default function PortalLoginPage() {
  redirect('/login');
}

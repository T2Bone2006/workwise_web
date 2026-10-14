import { redirect } from 'next/navigation';

/** Old customer reset form. /forgot-password already covers portal accounts. */
export default function PortalForgotPasswordPage() {
  redirect('/forgot-password');
}

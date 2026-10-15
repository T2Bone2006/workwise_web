/** The invite page is a full-screen AuthShell (like log in and sign up), so it needs no frame of its own. */
export default function AcceptInviteLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

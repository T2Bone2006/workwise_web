/**
 * Rules for worker invites that do not need a database, kept apart so they can be tested.
 *
 * An Employee gets the plain invite (set a password, work for the employer). A Subcontractor is
 * self-employed and gets the set-up invite, which also creates their own business.
 */

export type InviteKind = 'employee' | 'business';

/** The Subcontractor type means the set-up invite; every other type is a plain invite. */
export function inviteKindFor(workerType: string | null | undefined): InviteKind {
  return workerType === 'company_subcontractor' ? 'business' : 'employee';
}

/** Anything that is not exactly 'business' is a plain invite (old rows have no kind at all). */
export function parseInviteKind(value: unknown): InviteKind {
  return value === 'business' ? 'business' : 'employee';
}

export const EMAIL_EXISTS_MESSAGE =
  "That email address already has a WorkWise login, so it can't be invited. Ask them to use a different email address.";

/** Supabase refuses to invite an address that already has a login. Recognised by code or by message. */
export function isEmailExistsError(error: { code?: string | null; message?: string | null; status?: number | null } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'email_exists' || error.code === 'user_already_exists') return true;
  return /already (been )?registered|already exists/i.test(error.message ?? '');
}

export const INVITE_INVALID_MESSAGE = 'This invite link has already been used or has expired';
export const BUSINESS_NAME_MESSAGE = 'Please enter your business name (at least 2 letters).';
export const LOGIN_EMAIL_MISMATCH_MESSAGE =
  "This invitation doesn't match the email on the login. Ask your manager to send it again.";
export const EMAIL_REQUIRED_FOR_LOGIN_MESSAGE =
  "This worker signs in with their email, so it can't be removed.";

export type ExistingLoginEmailPlan = 'unchanged' | 'rename' | 'blocked';

/** A worker has one login. The same address keeps it. A new address renames it, unless another account has it. */
export function existingLoginEmailPlan(
  loginEmail: string | null | undefined,
  nextEmail: string,
  nextEmailOwnerId: string | null,
  loginUserId: string,
): ExistingLoginEmailPlan {
  const current = (loginEmail ?? '').trim().toLowerCase();
  const next = nextEmail.trim().toLowerCase();
  if (current === next) return 'unchanged';
  if (nextEmailOwnerId && nextEmailOwnerId !== loginUserId) return 'blocked';
  return 'rename';
}

export type WorkerEmailChangeFollowUp = 'invite' | 'notice';

/** Pending workers still need the invite. Anyone already signed up is told the address changed. */
export function workerEmailChangeFollowUp(
  inviteStatus: string | null | undefined,
): WorkerEmailChangeFollowUp {
  return inviteStatus === 'pending' ? 'invite' : 'notice';
}

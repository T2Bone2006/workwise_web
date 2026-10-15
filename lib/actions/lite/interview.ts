'use server';

import { revalidatePath } from 'next/cache';
import { interviewMessageError } from '@/lib/lite/interview-schema';
import {
  finishInterview,
  beginExampleChat,
  fillExampleDetail,
  getOrStartInterview,
  interviewTurn,
  saveExampleJobs,
  saveWebsiteStep,
  setAutoAccept,
  suggestExampleJobs,
  type InterviewView,
} from '@/lib/lite/interview';
import { requireLite } from '@/lib/lite/require-lite';
import { createAdminClient } from '@/lib/supabase/admin';

function refreshLite() {
  revalidatePath('/lite/setup');
  revalidatePath('/lite/widget/pricing');
  revalidatePath('/lite');
}

export async function startInterviewAction(
  redo?: boolean,
): Promise<{ ok: true; view: InterviewView } | { ok: false; error: string }> {
  const auth = await requireLite();
  if (!auth.ok) return { ok: false, error: auth.error };
  const view = await getOrStartInterview(createAdminClient(), auth.ctx, { redo });
  refreshLite();
  return { ok: true, view };
}

export async function sendInterviewMessageAction(
  interviewId: string,
  message: string,
): Promise<{ ok: true; view: InterviewView } | { ok: false; error: string; view?: InterviewView }> {
  const auth = await requireLite();
  if (!auth.ok) return { ok: false, error: auth.error };
  const problem = interviewMessageError(message);
  if (problem) return { ok: false, error: problem };
  const result = await interviewTurn(createAdminClient(), auth.ctx, { interviewId, message });
  refreshLite();
  return result;
}

export async function beginExampleChatAction(
  interviewId: string,
): Promise<{ ok: true; view: InterviewView } | { ok: false; error: string }> {
  const auth = await requireLite();
  if (!auth.ok) return { ok: false, error: auth.error };
  const result = await beginExampleChat(createAdminClient(), auth.ctx, interviewId);
  refreshLite();
  return result;
}

export async function fillExampleDetailAction(
  interviewId: string,
): Promise<{ ok: true; view: InterviewView } | { ok: false; error: string }> {
  const auth = await requireLite();
  if (!auth.ok) return { ok: false, error: auth.error };
  const result = await fillExampleDetail(createAdminClient(), auth.ctx, interviewId);
  refreshLite();
  return result;
}

export async function suggestExamplesAction(
  interviewId: string,
): Promise<{ ok: true; examples: { description: string; job_type_key: string }[] } | { ok: false; error: string }> {
  const auth = await requireLite();
  if (!auth.ok) return { ok: false, error: auth.error };
  const result = await suggestExampleJobs(createAdminClient(), auth.ctx, interviewId);
  refreshLite();
  return result;
}

export async function saveExamplesAction(
  interviewId: string,
  examples: { description: string; price: number; reasoning: string }[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireLite();
  if (!auth.ok) return { ok: false, error: auth.error };
  const result = await saveExampleJobs(createAdminClient(), auth.ctx, { interviewId, examples });
  refreshLite();
  return result;
}

export async function saveWebsiteAction(
  interviewId: string,
  values: { website: string; signOffName: string; ownerMobile: string | null },
): Promise<{ ok: true } | { ok: false; field: 'website' | 'signOffName' | 'ownerMobile'; error: string }> {
  const auth = await requireLite();
  if (!auth.ok) return { ok: false, field: 'website', error: auth.error };
  const result = await saveWebsiteStep(createAdminClient(), auth.ctx, { interviewId, ...values });
  refreshLite();
  return result;
}

export async function finishInterviewAction(
  interviewId: string,
): Promise<{ ok: true; version: number } | { ok: false; missing: string[] } | { ok: false; error: string }> {
  const auth = await requireLite();
  if (!auth.ok) return { ok: false, error: auth.error };
  const result = await finishInterview(createAdminClient(), auth.ctx, interviewId);
  refreshLite();
  return result;
}

const AUTO_ACCEPT_ERROR = {
  no_profile: "How you price isn't set up yet.",
  no_such_work: "That kind of work isn't on your list.",
  needs_visit: 'Only for work priced from a description',
  save_failed: "Couldn't save that. Try again.",
} as const;

export async function setAutoAcceptAction(
  key: string,
  on: boolean,
): Promise<{ success: true } | { success: false; error: string }> {
  const auth = await requireLite();
  if (!auth.ok) return { success: false, error: auth.error };
  const result = await setAutoAccept(createAdminClient(), auth.ctx, { key, on });
  if (!result.ok) return { success: false, error: AUTO_ACCEPT_ERROR[result.error] };
  refreshLite();
  return { success: true };
}

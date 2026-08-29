import type { JobOutcomeSummary, LabelledValue } from '@/lib/jobs/job-outcome-summary';
import { resolveJobAttachmentUrl } from '@/lib/utils/job-attachments';

const OUTCOME_COPY: Record<
  JobOutcomeSummary['outcome'],
  { word: string; accent: string; tint: string; line: string }
> = {
  declined: {
    word: 'Declined',
    accent: '#b91c1c',
    tint: '#fef2f2',
    line: 'The engineer declined this job, so it has not been attended.',
  },
  incomplete: {
    word: 'Not completed',
    accent: '#c2410c',
    tint: '#fff7ed',
    line: 'The engineer attended but the work was not completed.',
  },
  completed: {
    word: 'Completed',
    accent: '#047857',
    tint: '#ecfdf5',
    line: 'The work was completed.',
  },
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function detailRow(label: string, value: string | null): string {
  if (!value) return '';
  return `<tr>
    <td style="padding:7px 16px 7px 0;color:#64748b;font-size:13px;vertical-align:top;white-space:nowrap;">${escapeHtml(label)}</td>
    <td style="padding:7px 0;color:#0f172a;font-size:14px;vertical-align:top;">${escapeHtml(value)}</td>
  </tr>`;
}

function section(title: string, rows: LabelledValue[]): string {
  if (rows.length === 0) return '';
  return `
  <h2 style="margin:28px 0 8px;color:#0f172a;font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">${escapeHtml(title)}</h2>
  <table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border-collapse:collapse;">
    ${rows.map((row) => detailRow(row.label, row.value)).join('')}
  </table>`;
}

/**
 * Written to be forwarded on to the end customer, so it carries nothing
 * internal — no pay, no margins, no WorkWise account details. Plain table
 * layout with inline styles, which is what survives Outlook and Gmail.
 */
export function buildJobOutcomeEmail({
  summary,
  note,
}: {
  summary: JobOutcomeSummary;
  note?: string | null;
}): { subject: string; html: string } {
  const copy = OUTCOME_COPY[summary.outcome];
  const location = [summary.address, summary.postcode].filter(Boolean).join(', ');
  const subject = `${copy.word} — job ${summary.reference}${location ? `, ${summary.postcode || summary.address}` : ''}`;

  const photos = summary.photoUrls.map(resolveJobAttachmentUrl).filter(Boolean);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f4f6f8;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08);">
          <tr>
            <td style="background-color:${copy.tint};border-bottom:1px solid #e2e8f0;padding:24px 28px;">
              <p style="margin:0 0 6px;color:${copy.accent};font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">${escapeHtml(copy.word)}</p>
              <h1 style="margin:0;color:#0f172a;font-size:20px;font-weight:600;letter-spacing:-0.01em;">Job ${escapeHtml(summary.reference)}</h1>
              <p style="margin:8px 0 0;color:#475569;font-size:14px;line-height:1.5;">${escapeHtml(copy.line)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px;color:#334155;font-size:14px;line-height:1.6;">
              ${
                note
                  ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;background-color:#f8fafc;border-left:3px solid #94a3b8;border-radius:4px;">
                      <tr><td style="padding:12px 16px;color:#334155;font-size:14px;line-height:1.6;">${escapeHtml(note)}</td></tr>
                    </table>`
                  : ''
              }
              ${
                summary.reason
                  ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;background-color:${copy.tint};border-radius:6px;">
                      <tr><td style="padding:14px 16px;">
                        <p style="margin:0 0 4px;color:${copy.accent};font-size:12px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;">Reason</p>
                        <p style="margin:0;color:#0f172a;font-size:15px;line-height:1.5;">${escapeHtml(summary.reason)}</p>
                      </td></tr>
                    </table>`
                  : ''
              }

              <table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border-collapse:collapse;">
                ${detailRow('Customer', summary.customerName)}
                ${detailRow('Address', location || null)}
                ${detailRow('Scheduled', summary.scheduled)}
                ${detailRow('Engineer', summary.workerName)}
                ${detailRow('Started', summary.startedAt)}
                ${detailRow(summary.outcome === 'completed' ? 'Finished' : 'Report submitted', summary.endedAt)}
              </table>

              ${section('Job details', summary.jobSheetFields)}
              ${section('Engineer report', summary.reportAnswers)}

              ${
                photos.length > 0
                  ? `<h2 style="margin:28px 0 8px;color:#0f172a;font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Photos</h2>
                     <p style="margin:0;font-size:14px;line-height:2;">
                       ${photos
                         .map(
                           (url, i) =>
                             `<a href="${escapeHtml(url)}" style="color:#2563eb;text-decoration:none;">Photo ${i + 1}</a>`
                         )
                         .join('<span style="color:#cbd5e1;"> &middot; </span>')}
                     </p>`
                  : ''
              }
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px;background-color:#f8fafc;border-top:1px solid #e2e8f0;">
              <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.5;">
                Sent by ${escapeHtml(summary.tenantName)}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html };
}

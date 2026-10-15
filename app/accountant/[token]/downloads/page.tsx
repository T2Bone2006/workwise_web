import { FileSpreadsheet, FileText, Image as ImageIcon } from 'lucide-react';
import { PageHeader } from '@/components/accountant/page-header';
import { TaxYearDownload } from '@/components/downloads/tax-year-download';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireAccountantPage } from '@/lib/accountant/context';
import { taxYearFor } from '@/lib/books/periods';
import { accountantEarliestTaxYear } from '@/lib/data/accountant';
import { todayInLondon } from '@/lib/rounds/dates';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const PACK = [
  { icon: FileText, text: 'A plain-English README: how the numbers are counted, and what each file is' },
  { icon: FileSpreadsheet, text: 'summary.csv and expenses-by-hmrc-heading.csv: the figures you file from, with VAT' },
  { icon: FileSpreadsheet, text: 'in-and-out.csv: money in and out, month by month' },
  { icon: FileSpreadsheet, text: 'payments.csv, expenses.csv, invoices.csv and other-amounts-owed.csv: every line behind the figures' },
  { icon: ImageIcon, text: 'receipts/: the photo or PDF of every receipt, named by date and supplier, matched to expenses.csv' },
  { icon: FileText, text: 'invoices/: every invoice as a PDF' },
];

export default async function AccountantDownloadsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ctx = await requireAccountantPage(token);
  const latest = taxYearFor(todayInLondon());
  const earliest = await accountantEarliestTaxYear(createAdminClient(), ctx.tenantId).catch(() => latest - 1);
  const years = Array.from({ length: Math.max(1, latest - Math.min(earliest, latest) + 1) }, (_, i) => latest - i);
  const base = `/accountant/${token}/download`;

  return (
    <div className="space-y-5">
      <PageHeader title="Downloads" periodLabel="Everything for a tax year, to keep" businessName={ctx.businessName} print={false} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Year-end pack</CardTitle>
          <CardDescription>
            One file for a tax year: the spreadsheets, the receipt photos and the invoice PDFs, ready to file from.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <TaxYearDownload
            years={years}
            defaultYear={years[0]}
            actions={[
              {
                key: 'pack',
                label: 'Year-end pack',
                primary: true,
                url: `${base}?kind=pack`,
              },
              {
                key: 'spreadsheets',
                label: 'Spreadsheets only',
                url: `${base}?kind=spreadsheets`,
              },
            ]}
          />
          <div>
            <p className="mb-2 text-sm font-medium">What’s inside</p>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              {PACK.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-start gap-2">
                  <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-muted-foreground">
            “Spreadsheets only” is the same files without the photos and PDFs, so it’s quick. The pack has no customer
            list or contact details beyond what’s printed on the invoices.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

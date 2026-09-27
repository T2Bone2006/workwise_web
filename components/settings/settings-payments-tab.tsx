'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { CardPaymentsPanel } from '@/components/payments/card-payments-panel';
import { savePaymentSettings } from '@/lib/actions/payment-settings';
import type { CardPanelData } from '@/lib/data/payments/card-panel';
import type { PaymentSettings } from '@/lib/data/payments/settings';
import { formatSortCode } from '@/lib/payments/bank-format';
import { paymentSettingsSchema } from '@/lib/validations/payments';
import { UnsavedSaveBar } from '@/components/settings/unsaved-save-bar';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

type Field =
  | 'bankAccountName'
  | 'bankSortCode'
  | 'bankAccountNumber'
  | 'vatNumber'
  | 'invoiceDueDays'
  | 'invoicePrefix'
  | 'invoiceFooter';

function formatSortCodeTyping(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 6);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`;
}

function nextInvoiceLabel(prefix: string, seq: number): string {
  const clean = prefix.trim().toUpperCase() || 'INV';
  return `${clean}-${String(seq).padStart(4, '0')}`;
}

function fieldForMessage(message: string): Field | 'form' {
  if (/sort code/i.test(message)) return 'bankSortCode';
  if (/account number/i.test(message)) return 'bankAccountNumber';
  if (/vat/i.test(message)) return 'vatNumber';
  if (/together/i.test(message)) return 'bankAccountName';
  if (/prefix|invoice number/i.test(message)) return 'invoicePrefix';
  if (/footer/i.test(message)) return 'invoiceFooter';
  if (/pay within|days/i.test(message)) return 'invoiceDueDays';
  return 'form';
}

function savedSnapshot(settings: PaymentSettings) {
  return {
    bankAccountName: settings.bankAccountName ?? '',
    bankSortCode: formatSortCode(settings.bankSortCode),
    bankAccountNumber: settings.bankAccountNumber ?? '',
    vatRegistered: settings.vatRegistered,
    vatNumber: settings.vatNumber ?? '',
    invoiceDueDays: String(settings.invoiceDueDays),
    invoicePrefix: settings.invoicePrefix || 'INV',
    invoiceFooter: settings.invoiceFooter ?? '',
  };
}

export function SettingsPaymentsTab({
  settings,
  cardPanel,
  onSaved,
  onDirtyChange,
}: {
  settings: PaymentSettings;
  cardPanel: CardPanelData;
  onSaved: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const [baseline, setBaseline] = useState(() => savedSnapshot(settings));
  const [bankAccountName, setBankAccountName] = useState(settings.bankAccountName ?? '');
  const [bankSortCode, setBankSortCode] = useState(formatSortCode(settings.bankSortCode));
  const [bankAccountNumber, setBankAccountNumber] = useState(settings.bankAccountNumber ?? '');
  const [vatRegistered, setVatRegistered] = useState(settings.vatRegistered);
  const [vatNumber, setVatNumber] = useState(settings.vatNumber ?? '');
  const [invoiceDueDays, setInvoiceDueDays] = useState(String(settings.invoiceDueDays));
  const [invoicePrefix, setInvoicePrefix] = useState(settings.invoicePrefix || 'INV');
  const [invoiceFooter, setInvoiceFooter] = useState(settings.invoiceFooter ?? '');
  const [errors, setErrors] = useState<Partial<Record<Field | 'form', string>>>({});

  const dirty =
    bankAccountName !== baseline.bankAccountName ||
    bankSortCode !== baseline.bankSortCode ||
    bankAccountNumber !== baseline.bankAccountNumber ||
    vatRegistered !== baseline.vatRegistered ||
    vatNumber !== baseline.vatNumber ||
    invoiceDueDays !== baseline.invoiceDueDays ||
    invoicePrefix !== baseline.invoicePrefix ||
    invoiceFooter !== baseline.invoiceFooter;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const previewName = bankAccountName.trim() || 'your account name';
  const previewSort = bankSortCode.trim() || 'sort code';
  const previewAccount = bankAccountNumber.trim() || 'account number';

  function setFieldError(field: Field | 'form', message: string) {
    setErrors({ [field]: message });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrors({});

    const input = {
      bankAccountName,
      bankSortCode,
      bankAccountNumber,
      vatRegistered,
      vatNumber,
      invoiceDueDays,
      invoicePrefix,
      invoiceFooter,
    };
    const parsed = paymentSettingsSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path[0];
      const field = typeof path === 'string' ? (path as Field) : 'form';
      setFieldError(field, issue?.message ?? 'Check the form and try again.');
      return;
    }

    setSaving(true);
    const result = await savePaymentSettings(input);
    setSaving(false);
    if (!result.success) {
      setFieldError(fieldForMessage(result.error), result.error);
      return;
    }
    setBaseline({
      bankAccountName,
      bankSortCode,
      bankAccountNumber,
      vatRegistered,
      vatNumber,
      invoiceDueDays,
      invoicePrefix,
      invoiceFooter,
    });
    setSavedAt(Date.now());
    toast.success('Saved');
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card className="glass-card rounded-xl border border-border/60 bg-card/80">
        <CardHeader>
          <CardTitle>Bank details</CardTitle>
          <CardDescription>
            Shown on your pay page and invoices so customers can pay by bank transfer. Use the
            account you want customers to pay into.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="bank-account-name">Account name</Label>
            <Input
              id="bank-account-name"
              value={bankAccountName}
              onChange={(e) => setBankAccountName(e.target.value)}
              maxLength={70}
              aria-invalid={Boolean(errors.bankAccountName)}
            />
            {errors.bankAccountName ? (
              <p className="text-sm text-destructive">{errors.bankAccountName}</p>
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="bank-sort-code">Sort code</Label>
              <Input
                id="bank-sort-code"
                inputMode="numeric"
                autoComplete="off"
                placeholder="12-34-56"
                value={bankSortCode}
                onChange={(e) => setBankSortCode(formatSortCodeTyping(e.target.value))}
                aria-invalid={Boolean(errors.bankSortCode)}
              />
              {errors.bankSortCode ? (
                <p className="text-sm text-destructive">{errors.bankSortCode}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="bank-account-number">Account number</Label>
              <Input
                id="bank-account-number"
                inputMode="numeric"
                autoComplete="off"
                placeholder="12345678"
                value={bankAccountNumber}
                onChange={(e) =>
                  setBankAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 8))
                }
                aria-invalid={Boolean(errors.bankAccountNumber)}
              />
              {errors.bankAccountNumber ? (
                <p className="text-sm text-destructive">{errors.bankAccountNumber}</p>
              ) : null}
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Customers will see: {previewName} · {previewSort} · {previewAccount} · reference e.g.
            SMITH12
          </p>
        </CardContent>
      </Card>

      <Card className="glass-card rounded-xl border border-border/60 bg-card/80">
        <CardHeader>
          <CardTitle>VAT</CardTitle>
          <CardDescription>
            Your prices already include VAT. With this on, invoices show the VAT part (20%).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="vat-registered">I&apos;m VAT registered</Label>
            <Switch
              id="vat-registered"
              checked={vatRegistered}
              onCheckedChange={setVatRegistered}
            />
          </div>
          {vatRegistered ? (
            <div className="space-y-2">
              <Label htmlFor="vat-number">VAT number</Label>
              <Input
                id="vat-number"
                value={vatNumber}
                onChange={(e) => setVatNumber(e.target.value)}
                maxLength={20}
                aria-invalid={Boolean(errors.vatNumber)}
              />
              {errors.vatNumber ? (
                <p className="text-sm text-destructive">{errors.vatNumber}</p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="glass-card rounded-xl border border-border/60 bg-card/80">
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="invoice-due-days">Pay within</Label>
              <Input
                id="invoice-due-days"
                type="number"
                min={0}
                max={90}
                value={invoiceDueDays}
                onChange={(e) => setInvoiceDueDays(e.target.value)}
                aria-invalid={Boolean(errors.invoiceDueDays)}
              />
              <p className="text-xs text-muted-foreground">0 = due on receipt</p>
              {errors.invoiceDueDays ? (
                <p className="text-sm text-destructive">{errors.invoiceDueDays}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="invoice-prefix">Invoice number prefix</Label>
              <Input
                id="invoice-prefix"
                value={invoicePrefix}
                onChange={(e) => setInvoicePrefix(e.target.value.toUpperCase())}
                maxLength={10}
                aria-invalid={Boolean(errors.invoicePrefix)}
              />
              <p className="text-xs text-muted-foreground">
                Next invoice: {nextInvoiceLabel(invoicePrefix, settings.nextInvoiceSeq)}
              </p>
              {errors.invoicePrefix ? (
                <p className="text-sm text-destructive">{errors.invoicePrefix}</p>
              ) : null}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="invoice-footer">Footer note</Label>
            <Textarea
              id="invoice-footer"
              value={invoiceFooter}
              onChange={(e) => setInvoiceFooter(e.target.value)}
              maxLength={500}
              placeholder="Thanks for your business"
              aria-invalid={Boolean(errors.invoiceFooter)}
            />
            {errors.invoiceFooter ? (
              <p className="text-sm text-destructive">{errors.invoiceFooter}</p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <CardPaymentsPanel data={cardPanel} />

      {errors.form ? <p className="text-sm text-destructive">{errors.form}</p> : null}

      <UnsavedSaveBar dirty={dirty} saving={saving} savedAt={savedAt} />
    </form>
  );
}

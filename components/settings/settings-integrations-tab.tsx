'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  saveAnthropicApiKey,
  saveVAPIApiKey,
} from '@/lib/actions/settings';
import type { SettingsPageData } from '@/lib/data/settings-types';
import { cn } from '@/lib/utils';

interface SettingsIntegrationsTabProps {
  data: SettingsPageData;
  onSaved: () => void;
}

export function SettingsIntegrationsTab({ data, onSaved }: SettingsIntegrationsTabProps) {
  const [saving, setSaving] = useState(false);
  const [anthropicKey, setAnthropicKey] = useState('');
  const [anthropicDialogOpen, setAnthropicDialogOpen] = useState(false);
  const [vapiKey, setVapiKey] = useState('');
  const [vapiPhone, setVapiPhone] = useState(
    data.tenant?.settings?.integrations?.vapi?.phone_number ?? ''
  );
  const [vapiDialogOpen, setVapiDialogOpen] = useState(false);

  const integrations = data.tenant?.settings?.integrations ?? {};
  const vapi = integrations.vapi ?? { configured: false };
  const anthropic = integrations.anthropic ?? { configured: false };

  async function handleSaveAnthropic() {
    if (!anthropicKey.trim()) {
      toast.error('Enter your API key');
      return;
    }
    setSaving(true);
    const result = await saveAnthropicApiKey(anthropicKey.trim());
    setSaving(false);
    if (result.success) {
      toast.success('Anthropic API key saved');
      setAnthropicDialogOpen(false);
      setAnthropicKey('');
      onSaved();
    } else toast.error(result.error);
  }

  async function handleSaveVAPI() {
    if (!vapiKey.trim()) {
      toast.error('Enter your API key');
      return;
    }
    setSaving(true);
    const result = await saveVAPIApiKey(vapiKey.trim(), vapiPhone.trim() || undefined);
    setSaving(false);
    if (result.success) {
      toast.success('VAPI configured');
      setVapiDialogOpen(false);
      setVapiKey('');
      onSaved();
    } else toast.error(result.error);
  }

  return (
    <div className="space-y-6">
      {/* VAPI */}
      <Card
        className={cn(
          'glass-card rounded-xl border border-border/60',
          'bg-card/80 backdrop-blur-[var(--blur-glass)]'
        )}
      >
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                VAPI (Voice AI)
                {vapi.configured ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-500/20 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">
                    <Check className="size-3" /> Active
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400">
                    <X className="size-3" /> Not Configured
                  </span>
                )}
              </CardTitle>
              <CardDescription>Voice AI for emergency line and calls.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {vapi.configured && (
            <>
              {vapi.phone_number && (
                <p className="text-sm text-muted-foreground">Phone: {vapi.phone_number}</p>
              )}
              {vapi.api_key_masked && (
                <p className="text-sm text-muted-foreground">API Key: {vapi.api_key_masked}</p>
              )}
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setVapiDialogOpen(true)}>
              {vapi.configured ? 'Update' : 'Configure'} VAPI
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Anthropic */}
      <Card
        className={cn(
          'glass-card rounded-xl border border-border/60',
          'bg-card/80 backdrop-blur-[var(--blur-glass)]'
        )}
      >
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                Anthropic API
                {anthropic.configured ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-500/20 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">
                    <Check className="size-3" /> Configured
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400">
                    <X className="size-3" /> Missing
                  </span>
                )}
              </CardTitle>
              <CardDescription>AI quote generation and assistants.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {anthropic.configured && (
            <>
              {anthropic.api_key_masked && (
                <p className="text-sm text-muted-foreground">API Key: {anthropic.api_key_masked}</p>
              )}
              <p className="text-sm text-muted-foreground">
                Usage this month: ${(anthropic.usage_this_month_usd ?? 0).toFixed(2)}
              </p>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setAnthropicDialogOpen(true)}>
              {anthropic.configured ? 'Update' : 'Add'} API Key
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Anthropic key dialog */}
      <Dialog open={anthropicDialogOpen} onOpenChange={setAnthropicDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anthropic API key</DialogTitle>
            <DialogDescription>
              Key should start with sk-ant-. We store it masked and use it for AI quote generation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="anthropic-key">API key</Label>
            <Input
              id="anthropic-key"
              type="password"
              placeholder="sk-ant-..."
              value={anthropicKey}
              onChange={(e) => setAnthropicKey(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnthropicDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveAnthropic} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* VAPI dialog */}
      <Dialog open={vapiDialogOpen} onOpenChange={setVapiDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>VAPI configuration</DialogTitle>
            <DialogDescription>
              API key should start with sk-vapi-. Enter phone number for the emergency line.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="vapi-key">API key</Label>
              <Input
                id="vapi-key"
                type="password"
                placeholder="sk-vapi-..."
                value={vapiKey}
                onChange={(e) => setVapiKey(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vapi-phone">Phone number</Label>
              <Input
                id="vapi-phone"
                type="tel"
                placeholder="+44..."
                value={vapiPhone}
                onChange={(e) => setVapiPhone(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVapiDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveVAPI} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

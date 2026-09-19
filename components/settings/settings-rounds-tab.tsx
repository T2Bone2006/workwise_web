'use client';

import { useState, type FormEvent } from 'react';
import { format, parseISO } from 'date-fns';
import { CalendarIcon, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { updateRoundsSettings } from '@/lib/actions/rounds/settings';
import type { RoundsSettings } from '@/lib/rounds/settings';
import type { Ymd } from '@/lib/rounds/dates';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';

const WEEKDAYS: { iso: number; label: string }[] = [
  { iso: 1, label: 'Mon' },
  { iso: 2, label: 'Tue' },
  { iso: 3, label: 'Wed' },
  { iso: 4, label: 'Thu' },
  { iso: 5, label: 'Fri' },
  { iso: 6, label: 'Sat' },
  { iso: 7, label: 'Sun' },
];

function toYmd(date: Date): Ymd {
  return format(date, 'yyyy-MM-dd');
}

function formatBlackout(ymd: Ymd): string {
  try {
    return format(parseISO(ymd), 'd MMM yyyy');
  } catch {
    return ymd;
  }
}

interface SettingsRoundsTabProps {
  settings: RoundsSettings;
  onSaved: () => void;
}

export function SettingsRoundsTab({ settings, onSaved }: SettingsRoundsTabProps) {
  const [saving, setSaving] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [workingDays, setWorkingDays] = useState<number[]>(settings.working_days);
  const [blackouts, setBlackouts] = useState<Ymd[]>(settings.blackouts);
  const [shiftOff, setShiftOff] = useState(settings.shift_off_non_working_days);
  const [horizonWeeks, setHorizonWeeks] = useState(settings.horizon_weeks);
  const [reminderDays, setReminderDays] = useState(settings.reminder_days_before);
  const [startPostcode, setStartPostcode] = useState(settings.start_postcode ?? '');

  function toggleDay(iso: number) {
    setWorkingDays((current) => {
      if (current.includes(iso)) {
        if (current.length === 1) return current;
        return current.filter((day) => day !== iso);
      }
      return [...current, iso].sort((a, b) => a - b);
    });
  }

  function addBlackout(date: Date | undefined) {
    if (!date) return;
    const ymd = toYmd(date);
    setBlackouts((current) =>
      current.includes(ymd) ? current : [...current, ymd].sort(),
    );
    setCalendarOpen(false);
  }

  function removeBlackout(ymd: Ymd) {
    setBlackouts((current) => current.filter((day) => day !== ymd));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const result = await updateRoundsSettings({
      working_days: workingDays,
      blackouts,
      shift_off_non_working_days: shiftOff,
      horizon_weeks: horizonWeeks,
      reminder_days_before: reminderDays,
      start_postcode: startPostcode.trim() === '' ? null : startPostcode.trim(),
    });
    setSaving(false);
    if (result.success) {
      toast.success('Rounds settings saved');
      onSaved();
    } else {
      toast.error(result.error ?? 'Failed to save');
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card className="glass-card rounded-xl border border-border/60 bg-card/80">
        <CardHeader>
          <CardTitle>Days I usually work</CardTitle>
          <CardDescription>
            Spare days are for weather and overrun. Ticking a day shades the calendar — it
            does not ban jobs on the others.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((day) => {
              const checked = workingDays.includes(day.iso);
              return (
                <label
                  key={day.iso}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-xl border-2 px-3 py-2 text-sm font-medium transition-all',
                    checked
                      ? 'border-emerald-400/50 bg-emerald-500/10'
                      : 'border-border/80 hover:border-border hover:bg-muted/30',
                  )}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggleDay(day.iso)}
                    disabled={checked && workingDays.length === 1}
                  />
                  {day.label}
                </label>
              );
            })}
          </div>

          <div className="flex items-start justify-between gap-4 rounded-xl border border-border/60 p-4">
            <div className="space-y-1">
              <Label htmlFor="shift-off">Move visits off days I don’t work</Label>
              <p className="text-xs text-muted-foreground">
                Off by default. When on, new visits slide forward off weekends, spare days,
                and days off.
              </p>
            </div>
            <Switch
              id="shift-off"
              checked={shiftOff}
              onCheckedChange={setShiftOff}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card rounded-xl border border-border/60 bg-card/80">
        <CardHeader>
          <CardTitle>Days off / bank holidays</CardTitle>
          <CardDescription>
            Shaded on the calendar. Visits stay put unless you turn on the switch above.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {blackouts.map((ymd) => (
              <span
                key={ymd}
                className="inline-flex items-center gap-1 rounded-full border border-border/80 bg-muted/40 px-2.5 py-1 text-sm"
              >
                {formatBlackout(ymd)}
                <button
                  type="button"
                  onClick={() => removeBlackout(ymd)}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={`Remove ${formatBlackout(ymd)}`}
                >
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  <CalendarIcon className="size-4" />
                  Add day off
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  onSelect={addBlackout}
                />
              </PopoverContent>
            </Popover>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card rounded-xl border border-border/60 bg-card/80">
        <CardHeader>
          <CardTitle>Planning</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="horizon-weeks">Horizon (weeks)</Label>
            <Input
              id="horizon-weeks"
              type="number"
              min={4}
              max={12}
              value={horizonWeeks}
              onChange={(e) => setHorizonWeeks(Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              How far ahead to plan visits that keep to the calendar.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="reminder-days">Reminder days before</Label>
            <Input
              id="reminder-days"
              type="number"
              min={0}
              max={14}
              value={reminderDays}
              onChange={(e) => setReminderDays(Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              Used later for opt-out visit notices. Nothing is sent yet.
            </p>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="start-postcode">Route start postcode</Label>
            <Input
              id="start-postcode"
              value={startPostcode}
              onChange={(e) => setStartPostcode(e.target.value)}
              placeholder="Leave blank to use home postcode"
              maxLength={10}
              className="max-w-xs"
            />
          </div>
        </CardContent>
      </Card>

      <Button type="submit" variant="gradient" disabled={saving}>
        {saving ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Saving…
          </>
        ) : (
          'Save rounds settings'
        )}
      </Button>
    </form>
  );
}

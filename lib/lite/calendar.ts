import type { BoardLead } from '@/lib/data/lite/leads-board';

export type CalendarEvent = {
  uid: string;
  title: string;
  date: string;
  time: string | null;
  minutes: number;
  location: string | null;
  details: string;
};

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const HM = /^([01]\d|2[0-3]):([0-5]\d)/;

function pounds(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  if (Number.isInteger(rounded)) return `£${rounded}`;
  return `£${rounded.toFixed(2)}`;
}

function addDays(ymd: string, days: number): string {
  const match = YMD.exec(ymd);
  if (!match) return ymd;
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  utc.setUTCDate(utc.getUTCDate() + days);
  const year = utc.getUTCFullYear();
  const month = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const day = String(utc.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function compact(ymd: string): string {
  return ymd.replace(/-/g, '');
}

function stampTime(time: string): string {
  const match = HM.exec(time);
  if (!match) return '000000';
  return `${match[1]}${match[2]}00`;
}

/** Wall-clock end in London, rolling the date when the visit passes midnight. */
function endStamp(date: string, time: string, minutes: number): { date: string; hhmmss: string } {
  const match = HM.exec(time);
  const start = match ? Number(match[1]) * 60 + Number(match[2]) : 0;
  const total = start + minutes;
  const dayShift = Math.floor(total / (24 * 60));
  const mins = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const hh = String(Math.floor(mins / 60)).padStart(2, '0');
  const mm = String(mins % 60).padStart(2, '0');
  return { date: addDays(date, dayShift), hhmmss: `${hh}${mm}00` };
}

export function googleCalendarUrl(e: CalendarEvent): string {
  let dates: string;
  if (e.time == null) {
    dates = `${compact(e.date)}/${compact(addDays(e.date, 1))}`;
  } else {
    const end = endStamp(e.date, e.time, e.minutes);
    dates = `${compact(e.date)}T${stampTime(e.time)}/${compact(end.date)}T${end.hhmmss}`;
  }
  const parts = [
    'action=TEMPLATE',
    `text=${encodeURIComponent(e.title)}`,
    `dates=${dates}`,
    'ctz=Europe/London',
    `details=${encodeURIComponent(e.details)}`,
  ];
  if (e.location) parts.push(`location=${encodeURIComponent(e.location)}`);
  return `https://calendar.google.com/calendar/render?${parts.join('&')}`;
}

function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\n|\r/g, '\\n');
}

/** RFC 5545 fold: 75 octets, then CRLF + space. Splits on characters so a multibyte mark stays whole. */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let limit = 75;
  for (const ch of Array.from(line)) {
    const next = current + ch;
    if (encoder.encode(next).length > limit && current !== '') {
      parts.push(current);
      current = ch;
      limit = 74;
    } else {
      current = next;
    }
  }
  if (current) parts.push(current);
  return parts.map((part, index) => (index === 0 ? part : ` ${part}`)).join('\r\n');
}

function dtstamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function icsFile(e: CalendarEvent, now: Date): string {
  const start =
    e.time == null
      ? `DTSTART;VALUE=DATE:${compact(e.date)}`
      : `DTSTART;TZID=Europe/London:${compact(e.date)}T${stampTime(e.time)}`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//WorkWise//Lite//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `DTSTAMP:${dtstamp(now)}`,
    start,
    `DURATION:PT${e.minutes}M`,
    `SUMMARY:${escapeText(e.title)}`,
    `DESCRIPTION:${escapeText(e.details)}`,
  ];
  if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

export function leadCalendarEvent(lead: BoardLead): CalendarEvent | null {
  if (lead.status !== 'won' || lead.bookingStatus !== 'accepted' || !lead.bookedForDate) return null;
  if (!YMD.test(lead.bookedForDate)) return null;
  const time = lead.bookedForTime && HM.test(lead.bookedForTime) ? lead.bookedForTime.slice(0, 5) : null;
  const price =
    typeof lead.agreedAmount === 'number' ? `Price: ${pounds(lead.agreedAmount)}` : 'Price: free visit';
  return {
    uid: `${lead.id}@joinworkwise.com`,
    title: `${lead.jobSummary?.trim() || 'Job'} – ${lead.name}`,
    date: lead.bookedForDate,
    time,
    minutes: 60,
    location: lead.postcode,
    details: `Mobile: ${lead.mobileDisplay ?? ''}\n${price}\nFrom your website, via WorkWise`,
  };
}

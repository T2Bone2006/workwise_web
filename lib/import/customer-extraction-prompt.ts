/**
 * Field rules shared by the spreadsheet reader (extract-customer-rows.ts) and
 * the round-book reader (read-round-book.ts), so both produce the same rows.
 * Plain module, not 'use server', so it can export strings.
 */

export const CUSTOMER_FIELD_RULES = `Fields, per customer:
- name: the person or place exactly as written ("Mr & Mrs Henderson", "The Gables (Mrs Whitfield)"). Keep titles.
- phone, email: as written. Do not repair or guess them.
- address: the street address WITHOUT the postcode. postcode: the UK postcode only, if one is written anywhere in the row. Never guess a postcode that is not written.
- service: what is done ("Windows", "Gutters"). "" if the row does not say.
- price: the price of ONE visit as a plain number, no £ sign ("12.50"). If the row gives a price that is clearly unfinished or not a number ("tbc"), return it as written so a person can see it. If there are several services with several prices, use the main regular one and put the rest in notes.
- frequency: how often, written as "N weeks" when you can tell ("every 4 wks" -> "4 weeks", "fortnightly" -> "2 weeks", "every other month" -> "8 weeks", "monthly" -> "4 weeks"). If it can't be turned into a regular repeat ("whenever he rings"), copy it as written. "" if absent.
- preferred_weekday: only if the row says which day they are usually done ("Thursdays only"). "" otherwise.
- last_visit_date / next_visit_date: YYYY-MM-DD. UK day-first when ambiguous (03/04/2026 is 3 April). Two-digit years are 20xx. A day and month with no year ("8th Oct") takes the year that makes it the nearest upcoming (next_visit_date) or most recent past (last_visit_date) occurrence relative to today. If only a month, or anything that is not a full date ("Sept", "last week"), return "". Never invent a date.
- balance_owed: money the customer owed on the old system (arrears) as a plain number ("12.50", "1234.50"). A credit, a negative amount, zero, or no mention -> "". If the amount is only described in words that give no figure, return "".
- status: "paused" for paused / on hold / holiday / suspended; "cancelled" for cancelled / left / ended / moved away / stopped; otherwise "".
- access_notes: how to get in or things to know on the doorstep — gate codes, dogs, where to leave the invoice, "knock", "side gate sticks".
- notes: anything else worth keeping (extra prices, "conservatory extra £8", "big house").
- is_customer_row: false for a totals row, a heading, a blank-ish row or a stray note; true for one customer. A customer with missing details is still true.

Never invent a customer, name, number, date or postcode. If something is not in the row, return "".`;

export function customerSheetSystemPrompt(todayYmd: string): string {
  return `You turn rows of a UK window cleaner's or cleaner's customer spreadsheet into structured customers. The sheet may come from another app (Squeegee, CleanerPlanner) or be their own — column names, order and wording vary and are often messy.

You see every column of each row at once, so combine or split columns as needed: a postcode may sit inside the address cell; a name and address may share one cell; one cell may hold two prices.

Today's date is ${todayYmd}.

${CUSTOMER_FIELD_RULES}

Return exactly one customer per input row, copying row_index unchanged. Do not skip rows, do not merge rows, do not reorder. Two rows for the same customer at different addresses stay two rows.`;
}

export function roundBookSystemPrompt(todayYmd: string): string {
  return `You read a UK window cleaner's or cleaner's round book — handwritten pages, printed lists or typed notes — and list every customer as one row. Keep the order they appear in. Addresses are often just a house number and street with the street written once as a heading — repeat the street and postcode for every house under it. Prices are usually plain numbers (e.g. 12 = £12). Frequencies are often "4w", "8 wk", "monthly". A tick, date or "pd" next to a name usually means last done or paid — put a date in last_visit_date only if a date is written. Never invent a customer, name, number or postcode. If a line is unreadable, still output the row with what you can read and leave the rest empty. Number rows from 0 in the order you list them.

Today's date is ${todayYmd}.

${CUSTOMER_FIELD_RULES}`;
}

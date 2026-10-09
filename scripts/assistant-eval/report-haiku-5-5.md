# Assistant eval — 2026-10-09T15:59:25.596Z

Products: lite, rounds
**4 question(s) with problems.** Cost: 1.8p for 46 questions, 0.04p each on average.


## 1. What's left to do today?

OK · 3.8s · 0.02p (fresh 6, cache write 0, cache read 15391, out 239 tokens)

- Tools: get_schedule({"to":"2026-10-09","from":"2026-10-09","show":"list"})
- Cards: schedule
- Do it cards: none

> You have 3 visits left today, worth £70 in total. Owen Pritchard and Arjun Mehta are both at 10:30 on Lindow Grove, so you may want to check that timing. Beth Harrison is at 1:00pm.

## 2. Show today's round on a map

OK · 3.3s · 0.02p (fresh 6, cache write 759, cache read 14618, out 142 tokens)

- Tools: get_schedule({"to":"2026-10-09","from":"2026-10-09","show":"map"})
- Cards: map(3 stops, 0 unplaced)
- Do it cards: none

> Today's round has three stops, all window cleans, worth £70 in total. The map is on screen now, with the stops in round order.

## 3. Show tomorrow on a map

OK · 3.2s · 0.02p (fresh 6, cache write 290, cache read 14620, out 158 tokens)

- Tools: get_schedule({"to":"2026-10-10","from":"2026-10-10","show":"map"})
- Cards: none
- Do it cards: none

> Nothing is booked for tomorrow (Saturday 10 October), so there's no map to show. If you want, I can check which days have room for work or look at the schedule for next week.

## 4. Where am I working on Thursday? Map it please

OK · 4.3s · 0.03p (fresh 6, cache write 780, cache read 14625, out 324 tokens)

- Tools: get_schedule({"to":"2026-10-15","from":"2026-10-15","show":"map"})
- Cards: map(3 stops, 0 unplaced)
- Do it cards: none

> On Thursday 15 October you have 3 stops, all in south Manchester: Hannah Cooper at 10:00, then Kwame Mensah and Lewis Grant on Egerton Road at 12:30. The day is planned at £52. The map shows the stops in round order, but two of them are placed by postcode area only, so the exact pins may be a little off.

## 5. What's on this week?

OK · 4.9s · 0.04p (fresh 6, cache write 1307, cache read 14616, out 446 tokens)

- Tools: get_schedule({"to":"2026-10-11","from":"2026-10-09","show":"list"})
- Cards: schedule
- Do it cards: none

> You've got three visits today (Fri 9 Oct, £70 in total) and two on Sunday 11 Oct (£24). Nothing is booked for Saturday. Today's stops are Owen Pritchard and Arjun Mehta at 10:30, then Beth Harrison at 13:00. None are done yet.

## 6. Who owes me money?

OK · 4.9s · 0.05p (fresh 6, cache write 2750, cache read 14617, out 344 tokens)

- Tools: who_owes({"show":true})
- Cards: list
- Do it cards: none

> You're owed **£516.50** across 20 customers, and you're holding £8 credit. The list is on your screen.
> 
> The oldest debts are about 30 days old: Harold Finch, Stuart Bell, Lorraine Kay and Arjun Mehta (£50, the largest). Only Bob has had a reminder. Six of the 20 have no email on file, so you'd need to chase them another way.

## 7. Show me a chart of money in and out for the last 6 months

OK · 3.2s · 0.02p (fresh 6, cache write 528, cache read 14628, out 194 tokens)

- Tools: money_summary({"show":true,"chart":"in_and_out","period":"last_6_months"})
- Cards: stats, bar_chart
- Do it cards: none

> Over the last six months you've brought in £3,435 and spent £602.69, leaving £2,832.31. September was your best month, with £1,627 in and £323.69 out. October is only up to today so far, with £140 in.

## 8. How much did I make last month?

OK · 2.8s · 0.02p (fresh 6, cache write 536, cache read 14618, out 90 tokens)

- Tools: money_summary({"period":"last_month"})
- Cards: none
- Do it cards: none

> You took £1,627 in September across 69 payments. Spending came to £323.69, so you were left with £1,303.31.

## 9. How did last month compare with the month before?

OK · 4.7s · 0.04p (fresh 6, cache write 1101, cache read 14621, out 364 tokens)

- Tools: money_summary({"show":true,"period":"last_month"}) → money_summary({"show":true,"month":"2026-08","period":"month"})
- Cards: stats, stats
- Do it cards: none

> September was a much stronger month than August. Money in rose by £597 to £1,627, from 50 payments to 69. Money out rose by about £145 to £324, mostly on vehicle, equipment, cleaning supplies and insurance. That left £1,303 after expenses, up from £851.

## 10. How much have I spent on fuel this tax year?

OK · 4.6s · 0.04p (fresh 6, cache write 977, cache read 14625, out 561 tokens)

- Tools: list_expenses({"to":"2026-10-09","from":"2026-04-06","show":true,"category":"vehicle"})
- Cards: list
- Do it cards: none

> You've spent **£207.85** on vehicle and fuel costs since 6 April. That's five entries, mostly Shell Didsbury fill-ups. I can't pull fuel out on its own because WorkWise files it under "Vehicle & fuel" with other vehicle costs, though these entries look like fuel.
> 
> The list is on screen now. One entry, a £10 "Test" supplier on 1 October, looks like a test entry, so you may want to delete it.

## 11. Where could I fit a new customer?

OK · 4.7s · 0.03p (fresh 6, cache write 658, cache read 14621, out 392 tokens)

- Tools: room_for_work({"show":true})
- Cards: list
- Do it cards: none

> You're fully booked for the next four weeks, so there's no spare day for a new regular customer as things stand. The lightest days are Monday to Friday next week and Monday 19 and Tuesday 20 October, each with three stops. Those could take one more if you're happy to fit them in, and Wednesday 21 and Wednesday 28 October are the busiest.

## 12. Who's due a price rise?

OK · 4.2s · 0.04p (fresh 6, cache write 1115, cache read 14619, out 343 tokens)

- Tools: round_overview({"show":true})
- Cards: stats, bar_chart
- Do it cards: none

> Nobody's flagged for a price rise right now. WorkWise doesn't have a rule for who's due one, so I checked the round overview and it came back empty.
> 
> The spread is wide, though. Front-only window cleans range from £12 to £15 and front-and-back from £18 to £25. If you want, I can pull up the customers at the bottom of each range so you can decide who to raise first.

## 13. Which areas are my customers in? Show me

OK · 3.7s · 0.03p (fresh 6, cache write 1052, cache read 14623, out 235 tokens)

- Tools: round_overview({"show":true})
- Cards: stats, bar_chart
- Do it cards: none

> Your 57 customers are spread across 12 postcode areas. Most are in the M20 and M14 areas around Manchester: M20 2 has the most (9), and M20 1 is worth the most a month (£244). The chart on your screen shows the count for each area. Outliers are SW1A 1 (5 customers), WA3 3 (3) and TN23 5 (1).

## 14. Tell me about Raj Patel

OK · 6.6s · 0.06p (fresh 10, cache write 1693, cache read 29818, out 384 tokens)

- Tools: find_customers({"show":"true","query":"Raj Patel"}) → find_customers({"query":"Raj Patel"}) → get_customer({"show":true,"customer_id":"3a59cc99-32a3-40bb-ab94-ce4277397018"})
- Cards: customer
- Do it cards: none

> Raj Patel is an active customer at 16 Mauldeth Road, M20 4LJ. He has a front and back window clean every fortnight at £18, and he's up to date with nothing owed. His next visit is Wed 14 Oct, then Wed 28 Oct. He pays by card.

## 15. Tell me about Mrs Smith

OK · 6.9s · 0.04p (fresh 10, cache write 532, cache read 29671, out 389 tokens)

- Tools: find_customers({"show":"true","query":"Smith"}) → find_customers({"show":"list","query":"Smith"}) → find_customers({"show":"list","query":"Smith","filter":"all"})
- Cards: none
- Do it cards: none

> I couldn't find anyone called Smith in Test rounds 2, including inactive or paused customers. Could you check the spelling, or give me a first name, address or postcode for her?

## 16. When did I last do anyone on Lapwing Lane?

OK · 8.1s · 0.11p (fresh 10, cache write 5903, cache read 30397, out 815 tokens)

- Tools: find_customers({"show":"true","query":"Lapwing Lane"}) → find_customers({"show":"list","query":"Lapwing Lane"}) → get_customer({"customer_id":"163f8425-aa7a-4482-9875-c80904371c25"}) → get_customer({"customer_id":"4949ff24-6b57-41e5-9363-4bc54d779c60"}) → get_customer({"customer_id":"7ea4c57a-5989-419a-8d23-325526f3b0fd"}) → get_customer({"customer_id":"49002ea0-1cea-4d9e-8f7f-04bcc473ec6e"})
- Cards: list
- Do it cards: none

> You last did anyone on Lapwing Lane on **Mon 5 Oct**, when you cleaned the front windows at 12 Lapwing Lane (Harold Finch) and 52 Lapwing Lane (Stuart Bell).
> 
> Before that, you did Imran Sheikh at 32 on Mon 28 Sep, and Callum Ross at 72 on Mon 14 Sep. Callum's visit on 28 Sep was skipped because of weather.

## 17. List my paused customers

OK · 4.5s · 0.03p (fresh 8, cache write 319, cache read 22090, out 169 tokens)

- Tools: find_customers({"show":"true","filter":"paused"}) → find_customers({"show":"list","filter":"paused"})
- Cards: none
- Do it cards: none

> You have no paused customers right now.

## 18. What are my services and prices?

**PROBLEM:** repeated the card in words (6 list lines) · 3.3s · 0.03p (fresh 6, cache write 696, cache read 14618, out 184 tokens)

- Tools: list_services({"show":true})
- Cards: list
- Do it cards: none

> Your price list has six services, and the card on screen shows them in full. The main ones are:
> 
> - Window clean (front): £12, every 4 weeks
> - Window clean (front & back): £18, every 4 weeks
> - Conservatory roof: £40, quarterly
> - Gutter clear: £60, yearly
> - Fascia & soffit clean: £45, yearly
> - Solar panel clean: £50, twice yearly

## 19. It's raining. Move today's round to my next free day

OK · 7.2s · 0.07p (fresh 8, cache write 1954, cache read 23194, out 827 tokens)

- Tools: room_for_work({}) → get_schedule({"to":"2026-10-09","from":"2026-10-09"}) → move_day({"to_date":"2026-10-12","from_date":"2026-10-09"})
- Cards: none
- Do it cards: move_day: Move today's round to Mon 12 Oct

> I've put a card up to move today's three visits (Owen Pritchard, Beth Harrison and Arjun Mehta, £70 in total) to Monday 12 October. Your calendar is full for the next four weeks, so there's no empty day. Monday is the nearest working day and has three visits, so these would sit alongside them. Tap Do it to confirm, or Cancel if you'd rather pick another day.

## 20. Skip the first stop tomorrow, no access

**PROBLEM:** no skip_visits card · 3.4s · 0.03p (fresh 6, cache write 372, cache read 14625, out 249 tokens)

- Tools: get_schedule({"to":"2026-10-10","from":"2026-10-10","show":"list"})
- Cards: none
- Do it cards: none

> Nothing is booked for tomorrow (Saturday 10 October), so there's no first stop to skip. If you meant a different day, tell me which one and I'll find the first stop and set up the skip with a no access reason.

## 21. I spent £48 on diesel today

OK · 2.8s · 0.02p (fresh 6, cache write 357, cache read 14621, out 164 tokens)

- Tools: add_expense({"date":"2026-10-09","note":"Diesel","amount":48,"category":"vehicle"})
- Cards: none
- Do it cards: add_expense: £48 expense

> I've put a £48 vehicle expense for diesel today on screen. It's waiting for you to tap Do it to save it.

## 22. Someone paid me £20 cash just now, the first person who owes me

**PROBLEM:** no record_payment card · 4.3s · 0.05p (fresh 6, cache write 2751, cache read 14631, out 301 tokens)

- Tools: who_owes({})
- Cards: none
- Do it cards: none

> Good news on the £20. Which customer paid it? The biggest debt is Arjun Mehta (£50), but I don't want to guess. Tell me the name and I'll set up the £20 cash payment for you to confirm.

## 23. Add a new customer: Jo Bloggs, 12 High Street, BS7 8AA, windows every 4 weeks at £18 starting next Monday

OK · 5.7s · 0.05p (fresh 8, cache write 1254, cache read 22725, out 601 tokens)

- Tools: list_services({}) → add_customer({"name":"Jo Bloggs","address":"12 High Street","service":{"price":18,"service_id":"1e073d2f-8926-499c-8ffe-223fea3b012d","every_weeks":4,"first_visit":"2026-10-12","preferred_weekday":1},"postcode":"BS7 8AA"})
- Cards: none
- Do it cards: add_customer: Add Jo Bloggs

> I've put a card up to add Jo Bloggs at 12 High Street, BS7 8AA. It's a front and back window clean at £18 every 4 weeks, starting Mon 12 Oct. Nothing changes until you tap Do it.
> 
> I took "next Monday" to mean 12 October. I used the front and back window clean because it's the one priced at £18. If you'd like a different start date, or you want the front-only clean at £12, tell me and I'll update the card.

## 24. Email pay links to the two people who owe the most

OK · 5.9s · 0.07p (fresh 8, cache write 3170, cache read 24569, out 472 tokens)

- Tools: who_owes({}) → send_pay_link({"customer_id":"80a9c40d-6658-4d26-b29d-b841b306f620"})
- Cards: none
- Do it cards: send_pay_link: Email Arjun Mehta their pay link

> Arjun Mehta owes the most (£50), so I've set up his pay link email to arjun.mehta@example.com. It's waiting for you to tap Do it.
> 
> Second place is a three-way tie at £36: Harold Finch, Stuart Bell and Jack Whitfield. Which one would you like me to email as well?

## 25. Text all my customers that I am off next week

OK · 2.5s · 0.01p (fresh 4, cache write 134, cache read 7244, out 145 tokens)

- Tools: none
- Cards: none
- Do it cards: none

> I can't send texts to customers, so I can't tell them you're off next week. I can only email a customer their pay link.
> 
> Here's how to let them know:
> - **Tell them on the calendar:** this sends the message to customers whose visits fall in your time off. You can find it on the Calendar page.
> - **Messages page:** you can write and send a message to customers from there.
> 
> If you'd like, I can also show you which visits are booked next week so you can see who'll be affected.

## 26. Delete all my customers

OK · 1.8s · 0.01p (fresh 4, cache write 129, cache read 7244, out 86 tokens)

- Tools: none
- Cards: none
- Do it cards: none

> I can't delete customers from here, so nothing has been removed. You'll need to remove them one by one from each customer's page, or ask support if you want them all cleared at once. If you tell me which customers you're after, I can help you find them first, or you can use the Customers page to start.

## 27. How do I set up Direct Debit?

OK · 3.2s · 0.02p (fresh 6, cache write 379, cache read 14622, out 205 tokens)

- Tools: how_to({"topic":"payments"})
- Cards: none
- Do it cards: none

> Direct Debit runs through GoCardless, so you'll set it up in Settings → Payments. I can't set up GoCardless for you, but once it's connected you'll see Direct Debit customers on the Payments page (/payments). Is there a particular customer you want to set up on Direct Debit?

## 28. What do they owe?  _(on: This customer)_

OK · 2.9s · 0.03p (fresh 6, cache write 974, cache read 14700, out 126 tokens)

- Tools: get_customer({"customer_id":"30806b8a-4648-4804-a96a-875916ebf97d"})
- Cards: none
- Do it cards: none

> Amara Nwosu owes £30, for one visit on Mon 28 Sep (windows, conservatory and gutters) that hasn't been paid yet.

## 29. Show this day on a map  _(on: Calendar)_

OK · 2.9s · 0.02p (fresh 6, cache write 329, cache read 14659, out 148 tokens)

- Tools: get_schedule({"to":"2026-10-10","from":"2026-10-10","show":"map"})
- Cards: none
- Do it cards: none

> Tomorrow (Saturday 10 October) has nothing booked, so there's no map to show. If you'd like, I can check another day for you.

## 30. Any new leads this week?

OK · 4.3s · 0.04p (fresh 6, cache write 1176, cache read 14618, out 439 tokens)

- Tools: list_leads({"show":true})
- Cards: list
- Do it cards: none

> No new leads have come in this week (since Monday 5 October). The most recent was Gemma Holt's window cleaning enquiry on Sunday 4 October.
> 
> Three leads are still marked new and haven't been contacted: Gemma Holt, Neil Barker and Aisha Rahman. Those are probably worth a call first.

## 31. My callout's gone up to £60

OK · 4.9s · 0.03p (fresh 6, cache write 344, cache read 14620, out 493 tokens)

- Tools: get_pricing({})
- Cards: none
- Do it cards: none

> Your website chat doesn't have any prices saved yet, so there's no callout fee on it to change. It hasn't been through its set-up interview. Do you want the chat to quote a £60 callout fee? If so, I can set that now and you can finish the rest of the set-up at Lite, then Set-up. If your £60 is for regular customers instead, tell me which regular service it applies to and I'll look at that.

## 32. Show me a map of all my customers

**PROBLEM:** map left stops off · 3.6s · 0.03p (fresh 6, cache write 1780, cache read 14620, out 117 tokens)

- Tools: find_customers({"show":"map","filter":"all"})
- Cards: map(62 stops, 1 unplaced)
- Do it cards: none

> You've got 63 customers in total, and the map shows 62 of them. One couldn't be placed, so it's left off. The map is on screen now.

## 33. Chart my spending by category this tax year

OK · 2.8s · 0.03p (fresh 6, cache write 983, cache read 14622, out 240 tokens)

- Tools: money_summary({"show":true,"chart":"spending_by_category","period":"this_tax_year"})
- Cards: bar_chart
- Do it cards: none

> Your spending so far this tax year (6 Apr 2026 to date) is £602.69, and the chart is on screen now.
> 
> Vehicle & fuel is the biggest at £207.85, about a third of the total. Equipment & tools comes next at £102.19. The other categories are smaller: advertising £89, insurance £83, phone & internet £56, cleaning supplies £55.20 and bank & payment fees £9.45.

## 34. How do people pay me? Show me a chart for last month

OK · 3.1s · 0.03p (fresh 6, cache write 631, cache read 14626, out 222 tokens)

- Tools: money_summary({"show":true,"chart":"how_they_paid","period":"last_month"})
- Cards: bar_chart
- Do it cards: none

> Last month (September) you took £1,627 across 69 payments. Cash was the biggest method at £510, followed by bank transfer at £460 and card at £249. Direct Debit, cheque and pay by bank made up the rest.

## 35. Who's on Mauldeth Road?

OK · 4.5s · 0.04p (fresh 8, cache write 1031, cache read 22109, out 251 tokens)

- Tools: find_customers({"show":"true","query":"Mauldeth Road"}) → find_customers({"show":"list","query":"Mauldeth Road"})
- Cards: list
- Do it cards: none

> Four customers are on Mauldeth Road, all on a fortnightly front and back window clean at £18. Jack Whitfield (46) is the one who owes, £36.

## 36. How many customers do I have?

OK · 3.4s · 0.05p (fresh 6, cache write 3470, cache read 14618, out 154 tokens)

- Tools: find_customers({"filter":"all"})
- Cards: none
- Do it cards: none

> You have 63 customers in total, counting active, paused and inactive ones.

## 37. Who hasn't paid in over a month?

OK · 4.0s · 0.05p (fresh 6, cache write 2756, cache read 14623, out 385 tokens)

- Tools: who_owes({"show":true})
- Cards: list
- Do it cards: none

> Four customers have owed you for more than a month (over 30 days): **Harold Finch** (£36, 32 days), **Stuart Bell** (£36, 32 days), **Lorraine Kay** (£30, 32 days) and **Peter Walsh** (£18, 31 days). That's £120 between them. Harold, Stuart and Peter have email, so you could send them a pay link. Lorraine doesn't have an email on file.

## 38. Show me Friday

OK · 3.2s · 0.03p (fresh 6, cache write 757, cache read 14616, out 271 tokens)

- Tools: get_schedule({"to":"2026-10-09","from":"2026-10-09","show":"map"})
- Cards: map(3 stops, 0 unplaced)
- Do it cards: none

> Friday has three window cleans planned, worth £70 in total, and none are done yet. Owen Pritchard and Arjun Mehta are both at 10:30 on Lindow Grove, and Beth Harrison is at 13:00 on Cavendish Road. The map shows the stops in round order.

## 39. What did Arjun Mehta pay last time?

OK · 4.6s · 0.04p (fresh 8, cache write 1469, cache read 22243, out 257 tokens)

- Tools: find_customers({"query":"Arjun Mehta"}) → get_customer({"customer_id":"80a9c40d-6658-4d26-b29d-b841b306f620"})
- Cards: none
- Do it cards: none

> Arjun Mehta's last payment was **£75 by bank transfer on Tue 15 Sep 2026**.
> 
> He currently owes £50 for two window cleans (11 and 25 Sep).

## 40. Pause Raj Patel's windows for 2 weeks

OK · 5.0s · 0.04p (fresh 8, cache write 690, cache read 22249, out 330 tokens)

- Tools: find_customers({"query":"Raj Patel"}) → pause_service({"until":"2026-10-23","agreement_id":"8908c23b-0ea5-4219-8000-ab36dc73cfbe"})
- Cards: none
- Do it cards: pause_service: Pause Raj Patel's window clean (front & back)

> I've put a card up to pause Raj Patel's fortnightly window clean (front & back) until Fri 23 Oct. It takes 1 booked visit off the calendar, and visits start again after that. It's waiting for you to tap Do it. Nothing changes until you do.

## 41. Put Raj Patel's price up to £20

OK · 4.7s · 0.03p (fresh 8, cache write 589, cache read 22239, out 212 tokens)

- Tools: find_customers({"query":"Raj Patel"}) → change_price({"new_price":20,"agreement_id":"8908c23b-0ea5-4219-8000-ab36dc73cfbe"})
- Cards: none
- Do it cards: change_price: Raj Patel: window clean (front & back) £18 → £20

> Raj Patel's window clean (front & back) is going up from £18 to £20 a visit, which also changes the 2 booked visits. It's waiting for you to tap Do it.

## 42. Move Raj Patel's next visit to the Friday after

OK · 13.8s · 0.06p (fresh 10, cache write 1944, cache read 31046, out 481 tokens)

- Tools: find_customers({"query":"Raj Patel"}) → get_customer({"customer_id":"3a59cc99-32a3-40bb-ab94-ce4277397018"}) → move_visits({"to_date":"2026-10-16","visit_ids":["307b3911-6445-4142-8776-7d707d72a1d6"]})
- Cards: none
- Do it cards: move_visits: Move Raj Patel to Fri 16 Oct

> I've put a card up to move Raj Patel's window clean from Wed 14 Oct to Fri 16 Oct. It's waiting for you to tap Do it. Customers aren't told automatically, so you'll need to let him know from the calendar if you want him to hear about it.

## 43. Mark Gemma Holt's lead as contacted

OK · 4.2s · 0.04p (fresh 8, cache write 1399, cache read 23054, out 241 tokens)

- Tools: list_leads({}) → set_lead_status({"status":"contacted","lead_id":"b6b3764a-b4d0-4d59-a048-4bde9f8d97b1"})
- Cards: none
- Do it cards: set_lead_status: Mark Gemma Holt as Contacted

> I've got a card ready to move Gemma Holt's lead (windows on a 3 bed semi, £25 estimate) from New to Contacted. It's waiting for you to tap Do it.

## 44. What's my busiest day next week?

OK · 4.6s · 0.06p (fresh 6, cache write 3203, cache read 14620, out 472 tokens)

- Tools: get_schedule({"to":"2026-10-18","from":"2026-10-12","show":"list"})
- Cards: schedule
- Do it cards: none

> Wednesday 14 October is your busiest day by money, with 3 visits and £71 planned. Friday 16 October is close behind at £70.
> 
> By number of visits, Monday to Friday are tied at 3 each, and Saturday has no visits. Next week you have 17 visits in total, with Sunday 18 October at 2.

## 45. Where are the people who owe me money? Map them

OK · 7.2s · 0.09p (fresh 10, cache write 4630, cache read 34782, out 544 tokens)

- Tools: who_owes({"show":true}) → find_customers({"show":"true","filter":"owes"}) → find_customers({"show":"map","filter":"owes"})
- Cards: list, map(20 stops, 0 unplaced)
- Do it cards: none

> The map shows 20 places, with 20 people owing £516.50 in total. Ten of them aren't on the map, so I can't show where they are from here. The biggest debts on the map are Arjun Mehta (£50), then Harold Finch, Stuart Bell and Jack Whitfield (£36 each). Most of the amounts have gone unpaid for three weeks or more.

## 46. how much did i earn in august

OK · 3.7s · 0.03p (fresh 6, cache write 533, cache read 14618, out 230 tokens)

- Tools: money_summary({"month":"2026-08","period":"month"})
- Cards: none
- Do it cards: none

> In August you took **£1,030** in payments across 50 transactions. After £178.90 of expenses, **£851.10** was left.

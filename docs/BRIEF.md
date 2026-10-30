# Bulman CS Bot - brief and tracker

Started 2026-10-30. Owner: Ben. Subject-matter expert: Rachel Bowman (Office Manager).

## Goal
A customer-service bot trained on Rachel's email history that drafts replies covering:
auto quoting, dimensions, product information, email history (tone and context), digital catalogue.

## Decisions
- 2026-10-30 Reuse the order-entry project's Graph connection and JobBoss2 read-only cache layer rather than rebuild.
- 2026-10-30 Harvest Rachel's replies from `rbowman@bulmanproducts.com` Sent Items (16,952 items). `bulman@` Sent Items is empty because Outlook saves shared-mailbox sends to the sender's own folder.
- 2026-10-30 Prices come from JB2 order lines (`/order-line-items?partNumber=`), newest first. The estimate record carries no price. Catalogue shows the last sold price with its date.
- 2026-10-30 Sellable = JB2 product codes CUTTER, RACKS, SLIDECUTTER, DRYING RACKS, TABLES, GIFT WRAP, MISC SOLD, SPECIALTY, FOOD, CUSTOM. Cartons, tubing, steel, paint are kept in the catalogue but hidden from the prompt digest.
- 2026-10-30 Model `claude-opus-5-5`, effort medium, catalogue digest cached 1 h in the system prompt, server-side refusal fallback on.
- Bot output is a draft only. No sending, no mailbox writes, no JB2 writes.

## Hard rules (inherited)
- Never read mail newer than 25 days (`GRAPH_MIN_AGE_DAYS`).
- No PATCH/POST to Graph. No non-GET to JB2.

## Status
| Piece | State |
|---|---|
| Cache layer + JB2 read client | Done, verified: 5,247 parts, 1,630 customers |
| Graph read client | Done, verified against both mailboxes |
| Corpus harvest + cleaning | Done; first 80 replies looked right (quotes with part numbers and prices survive, signatures and quoted history stripped) |
| Price book | Done: 402 of 852 sellable parts priced from order lines |
| Catalogue build | Done; 429 of 5,249 parts had dimensions mined from descriptions |
| Draft bot + tools | Done, live tested; `npm run eval` grades hold-out cases |
| API server | Done, untested beyond typecheck |

## Eval log (hold-out: real customer question in, bot draft graded against what Rachel actually sent, 1-5)
| Date | n | tone | facts | helpful | What changed before this run |
|---|---|---|---|---|---|
| 2026-10-30 a | 8 | 4.38 | 2.50 | 2.75 | Baseline: style guide + catalogue + tools |
| 2026-10-30 b | 8 | 4.38 | 3.13 | 3.25 | facts.md, date + attachment names, no placeholders, usual price |

Findings from run a: bot did not know the date (replayed Jan emails and mentioned the Jan 1 increase), left a [DISTRIBUTOR NAME] placeholder, invented a prior email, quoted before asking reseller vs end user, and could not see attachments Rachel had. Fixes: `data/knowledge/facts.md` standing answers, date + attachment names in the prompt, no-placeholder rule, notes capped at 3 lines, catalogue price = usual recent price not last sale.

## Next
1. Full corpus harvest (1,500 replies, 2 years) and review the topic mix.
2. Run 10 real inbound emails from the corpus through `/draft`, compare against what Rachel actually sent, tune the style guide.
3. Fill `catalogue.overrides.json` dimensions from the printed catalogue PDF (ask Rachel for the current one).
4. Decide delivery surface: Outlook add-in, a review queue page like order entry, or drafts dropped into the shared mailbox Drafts folder (would need Mail.ReadWrite).
5. Inbound classifier so the bot ignores invoices/remittances and only drafts for quote, dimensions, product info, order status.

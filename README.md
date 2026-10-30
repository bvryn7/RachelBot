# Bulman CS Bot

Drafts customer-service email replies in Rachel Bowman's voice. Covers quoting, dimensions,
product information, order status and "what did we tell them last time", using Rachel's
real email history as the tone reference and JobBoss2 as the source of truth.

Everything here is **read only**: no mail is ever marked, moved or sent, and the JobBoss2
client only has a GET path. Output is a draft for Rachel to review.

## Borrowed from Ai-Enabled-Order-Entry-Automation-true

| Here | There | What changed |
|---|---|---|
| `src/cache/diskCache.ts` | `prodReadClient.ts` `cachedList` + the three token caches | Generalised: any bucket/name, TTL, stale-on-failure, shared OAuth token cache |
| `src/jobboss/prodReadClient.ts` | `src/jobboss/prodReadClient.ts` | Same GET-only client; adds `priceHistory` (order lines are where JB2 keeps prices) |
| `src/mailbox/graphClient.ts` | `src/mailbox/graphMailbox.ts` | List/conversation/attachments only. The PATCH path was deliberately not ported |
| `src/util/retry.ts` | `src/util/retry.ts` | Unchanged |
| `src/vision/docIntel.ts`, `mapInvoiceToPo.ts` | `src/extraction/documentIntelligence.ts`, `mapInvoiceToPo.ts` | Generalised to any model (prebuilt-read for photos/scans, prebuilt-invoice for POs), disk-cached by content hash, in-memory buffers instead of file paths |
| `src/config.ts` | `src/config.ts` | Same zod pattern, fewer keys, plus `RACHEL_MAILBOX` |

Hard rule inherited: nothing newer than `GRAPH_MIN_AGE_DAYS` (min 25) is ever read.

## Data flow

```
rbowman@ Sent Items ──harvest──> data/corpus/rachel.jsonl   (question -> Rachel's answer, per thread)
JB2 estimates       ──refresh──> data/reference/jb2-prod-parts.json      (24 h cache)
JB2 order lines     ──prices───> data/reference/jb2-prod-prices.json     (7 d cache, last sold price per sellable part)
parts + prices + overrides ──build──> data/knowledge/catalogue.json      (the digital catalogue)

POST /draft {from, subject, body} ──> Claude Opus 5.5 + tools ──> draft reply
```

Rachel answers from the shared `bulman@` box, but Outlook files her sent copies in **her own**
Sent Items (`bulman@` Sent Items is empty), so the corpus is harvested from `RACHEL_MAILBOX`.

## Setup

```
npm install
cp .env.example .env     # fill Graph + JB2 prod read creds + ANTHROPIC_API_KEY
npm run jb2:refresh      # parts + customers
npm run knowledge:prices # last sold prices (a few minutes, one GET per part)
npm run knowledge:build  # catalogue.json
npm run corpus:harvest -- 1500 730   # up to 1500 replies from the last 2 years
npm run corpus:stats
```

## Use

```
npm run draft -- "buyer@customer.com" "RE: Replacement blade" "Hi Rachel, what is the price on 5 of the 26138P?"
npm run dev              # POST http://localhost:3100/draft  {from, subject, body, thread?}
```

Tools Claude can call while drafting: `lookup_part`, `search_catalogue`, `price_history`,
`order_status`, `customer_recent_orders`, `past_replies`.

## Catalogue overrides

`data/knowledge/catalogue.overrides.json` holds what the ERP does not: dimensions, family,
plain-English names. Key = JB2 part number. Dimensions found inside JB2 descriptions
(`24 IN x 48 IN`) are mined automatically; override when wrong or missing.

## Layout

```
src/cache       disk + token cache layer
src/jobboss     JB2 production read-only client
src/mailbox     Graph read-only client, body cleaning
src/corpus      harvest, classify, load Rachel's history
src/knowledge   catalogue + price book
src/bot         style guide, tools, draftReply, CLI
src/api         express server
docs/BRIEF.md   status and decisions
```

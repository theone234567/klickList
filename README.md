# KlickList

Photograph a pile of things you want to sell, and AI writes the Trade Me listings for you. Works on **phone and desktop** with the same account: shoot on your phone, then review and upload on your computer.

1. **Snap.** Take 1–3 photos of an item and tap **Next item**. Do that for all 50 items. You can also bulk-import or drag & drop photos on a computer. Desktop shortcuts: Space = photo, N = next item.
2. **AI writes.** For each item it writes the title, description, category, condition, suggested start and Buy Now prices, DVD/Blu-ray region, brand and other details. It also flags anything you should check. You choose **Claude** or **Gemini (free)** in Settings, and the other one can act as a backup.
3. **Tidy photos (free).** Photos are automatically turned the right way up, colour-corrected and compressed. **White backgrounds** are made on your own device using a free model, so there's no AI cost.
4. **Price check (free).** Compares with similar listings on Trade Me through Trade Me's own API. No AI is involved, so it costs nothing.
5. **Review & approve.** Go through the drafts one by one, edit anything, and tap **Approve & next**. On desktop, Ctrl/Cmd+Enter does the same.
6. **Upload to Trade Me.** Approved items become a Trade Me **My Products** import file. Photos are included as links, or as a ZIP of photo files. Import it on Trade Me, check, and list. Re-exporting updates the same products instead of creating duplicates.

You can also use copy-paste mode (one item at a time, with copy buttons for each field) and CSV export.

## Pricing

Everything is free except the AI (USD, rough estimates):

| What | Per item | 50 items |
|---|---|---|
| Listings by Claude Haiku 4.5, **economy mode** (default: half price, ready in minutes to an hour) | ~0.15c | **~$0.07** |
| Listings by Claude Haiku 4.5, instant | ~0.3c | ~$0.15 |
| Listings by **Gemini Flash-Lite free tier** | $0 | **$0** (within Google's daily free limit) |
| Price checks via the Trade Me API | $0 | $0 |
| Price checks via Claude web search (optional fallback, `PRICE_SOURCES=trademe,claude`) | ~2c | — |
| White backgrounds, photo tidy-up, barcodes | $0 (on your device) | $0 |
| Website, database, photo storage, email sign-in codes | free tiers | $0 |

Better AI models are optional: `AI_MODEL=claude-sonnet-5` costs about 2× Haiku and `claude-opus-5` about 5×. Phone text sign-in is off by default because each SMS costs about NZ$0.15; email codes are free.

**How the AI cost is kept down:**
- **One image per item:** the front and back photos are merged into one small image (at most 640×480 each), which uses about 30–60% fewer tokens than sending them separately.
- **Economy mode:** Anthropic's Batch API charges half price. Items are sent as one batch and collected when ready.
- **Small, fixed requests:** a short prompt, no extended thinking, and answers capped at 1,200 tokens.
- **Free extras:** barcodes are read on your device and price checks come from Trade Me, so neither uses the AI.
- **Once per item:** the AI only runs again if you tap **Re-write with AI**.
- **Limits:** there's a daily cap per account (`AI_DAILY_LIMIT`, default 150) and a monthly spend limit in your Anthropic account. Settings shows today's estimated spend.

## Security

- **Sign-in:** a 6-digit code sent by email (text messages optional). There are no passwords to leak. New sign-ups are turned off, so only accounts you create can sign in. `ALLOWED_USERS` adds a second allowlist check on the server.
- **Your data:** Postgres Row Level Security means each user can only ever read or change their own batches, items, photos and usage. This is enforced in the database, not only in the app, and there is an automated test for it (`supabase/tests/rls_check.sql`, run in CI). Photos are stored in a private bucket and shown through links that expire after 1 hour.
- **Protecting the AI from misuse:**
  - The Anthropic, Gemini and Trade Me keys are only stored as server secrets and are never sent to the browser.
  - The AI endpoint only accepts signed-in, allowlisted users from your own website.
  - It only accepts 1–3 small JPEGs, a note of up to 300 characters and a barcode, and checks every field.
  - The prompt, the models and the answer format are fixed on the server, so it can't be used as a general chatbot. The Claude/Gemini switch only picks between the two fixed setups.
  - Text in photos or notes (for example "ignore your instructions") is treated as information about the item, never as a command.
  - The AI can only answer in a fixed JSON shape. That answer is checked again and cleaned (HTML removed, lengths and prices limited) before it is saved.
  - The listing AI has no tools. The price-check AI can only do 1 web search and must answer through a fixed form. Numbers are checked and limited, and only https links are kept.
  - Price checks never change an item you've already approved. Nothing goes to Trade Me until you approve it and import the file yourself.
  - The daily cap per user and an Anthropic spend limit put a ceiling on cost.
- **Website:** a strict Content-Security-Policy and other security headers (`public/_headers`), no third-party scripts, and CSV export that protects against formula injection.

## Setup

See **[docs/SETUP.md](docs/SETUP.md)**. It takes about 30 minutes and every step can be done through a web page.

## Development

```bash
npm install
cp .env.example .env.local   # fill in your Supabase URL + anon key
npm run dev                  # http://localhost:5173
npm test                     # unit tests
npm run typecheck
```

```
src/                         React web app (Vite + TypeScript)
  pages/                     Login, BatchView (home: all items by day), Capture, ItemEditor, Export, QuickList, Settings
  lib/image.ts               on-device photo tidy-up, AI thumbnails, barcode reading
supabase/migrations/         database tables, security rules, private photo bucket
supabase/functions/analyze-item/   writes listings (the AI key is only used server-side)
supabase/functions/ai-batch/       economy mode (Anthropic Batch API, half price)
supabase/functions/price-check/    free Trade Me price comparison (optional Claude web-search fallback)
supabase/functions/_shared/providers.ts   Claude + Gemini behind one interface, backup and cost tracking
supabase/functions/_shared/  prompts, answer schemas, validation, sign-in/quota checks
src/lib/bgremove.ts          on-device white backgrounds (U2-Net "silueta", Apache-2.0)
src/lib/trademe.ts           Trade Me My Products CSV import file
```

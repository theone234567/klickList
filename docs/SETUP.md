# Setting up klickList

Allow about 30 minutes. You need free accounts with **Supabase**, **Anthropic** and **Cloudflare**. **Resend** (for email) and **Twilio** (for text messages) are optional.

## 1. Supabase (sign-in, database, photos)

1. Go to <https://supabase.com> → **New project**. Choose the **Sydney** region because it's closest to NZ, and save the database password somewhere safe.
2. Install the Supabase CLI (<https://supabase.com/docs/guides/cli>), then in this folder run:
   ```bash
   supabase login
   supabase link --project-ref YOUR-PROJECT-REF   # Project Settings → General
   supabase db push                               # creates tables, security rules, photo bucket
   ```
3. **Authentication → Sign In / Providers**:
   - Turn **off** "Allow new users to sign up". This keeps the app private.
   - Make sure **Email** is enabled.
   - Optional (costs about NZ$0.15 per text): enable **Phone**, enter your Twilio details, set `VITE_ENABLE_PHONE=true` in step 3, and in the Twilio console under *Messaging → Geo permissions* allow **New Zealand only**. This blocks SMS-fraud charges.
4. Sign-in emails contain a **sign-in link** by default, and klickList accepts that. Optionally, once you've added your own SMTP (next step), edit **Authentication → Emails → Magic link or OTP** to include `{{ .Token }}` so the email also shows a 6-digit code. Codes work better inside an installed home-screen app, because links open in the normal browser.
5. **Authentication → Emails → SMTP Settings**: add an SMTP provider. Resend is free for 3,000 emails a month. Supabase's built-in email only sends a few messages an hour and is meant for testing.
6. **Authentication → Users → Add user**: create yourself with your email and/or mobile number (+64…) and tick "Auto confirm".
7. **Project Settings → API**: copy the **Project URL** and the **anon public** key for step 3.
   Never put the `service_role` key anywhere in the website.

## 2. AI and price-check keys

You need **at least one** AI key. Having both lets each back up the other.

**Claude (best listings, about US$0.07 per 50 items in economy mode)**
1. Sign up at <https://console.anthropic.com>. This is separate from a Claude.ai subscription: the API is pay-as-you-go.
2. Add US$5 of credit, which covers several thousand listings. Under **Limits**, set a monthly spend limit such as US$10.
3. Create an API key.

**Gemini (free)**
1. Go to <https://aistudio.google.com>, sign in with a Google account, and click **Get API key**. No card is needed for the free tier.
2. The free tier has daily limits that Google adjusts, roughly 500–1,000 requests a day for Flash-Lite. AI Studio shows your current limits.
3. On the free tier, Google may use what you send (photos and notes) to improve its products. Use Claude if that matters to you.

**Trade Me API (free price checks)**
1. Sign in to Trade Me and register an application in the developer area (see <https://developer.trademe.co.nz>). Ask for **read-only** access; klickList only searches listings.
2. You receive a **consumer key** and **consumer secret**. New apps may start on Trade Me's sandbox (`tmsandbox.co.nz`) until Trade Me approves production access. Set `TRADEME_SANDBOX=true` while you're on the sandbox.
3. Until this is set up, price checks use a Claude web search instead (about 2c each), or you can turn them off in Settings.

**Barcodes (free, nothing to set up):** the app reads barcodes on the phone (including iPhone). Books are looked up by ISBN on Open Library, with Google Books as a backup. DVDs and Blu-rays get their likely region from the barcode's country: 93 Australia / 94 NZ means Region 4 / B, a US barcode means Region 1 / A, and a UK one means Region 2 / B. Anything worked out this way is flagged "check the back cover". Optionally add a free `GOOGLE_BOOKS_API_KEY` (Google Cloud → enable Books API → Credentials → API key), because without it Google's shared quota is often used up.

**Save the keys and deploy the AI functions (no command line needed):**
1. Create a Supabase access token at <https://supabase.com/dashboard/account/tokens> (name it `github-deploy`).
2. On GitHub, open the repo → **Settings → Secrets and variables → Actions → New repository secret** and add:

   | Name | Value |
   |---|---|
   | `SUPABASE_ACCESS_TOKEN` | the token from step 1 |
   | `SUPABASE_PROJECT_REF` | the id in your Supabase URL (e.g. `mbqnmdhuanjldmhkbcld`) |
   | `GEMINI_API_KEY` and/or `ANTHROPIC_API_KEY` | your AI key(s) |
   | `ALLOWED_ORIGINS` | your website, e.g. `https://klicklist-app.pages.dev` |
   | `ALLOWED_USERS` | your email address |
   | optional | `TRADEME_CONSUMER_KEY`, `TRADEME_CONSUMER_SECRET`, `TRADEME_SANDBOX`, `AI_DAILY_LIMIT`, `AI_MODEL`, `GEMINI_MODEL`, `PRICE_SOURCES`, `GOOGLE_BOOKS_API_KEY` |
3. Go to the **Actions** tab → **Deploy Supabase functions** → **Run workflow**. Run it again whenever you change a key.

GitHub keeps these secrets encrypted and they never appear in logs. If you prefer the command line instead, use `supabase secrets set …` and `supabase functions deploy analyze-item ai-batch price-check --no-verify-jwt`.

In the app, **Settings → Which AI** chooses Claude or Gemini, whether the other one is used as a backup, and economy mode.

## 3. Cloudflare Pages (the website)

1. Go to <https://dash.cloudflare.com> → **Workers & Pages → Create → Pages → Connect to Git** and choose this repository.
2. Set the build command to `npm run build` and the output folder to `dist`.
3. Under **Environment variables**, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (from step 1.7).
4. Deploy. You get an address like `https://klicklist.pages.dev`.
5. Back in Supabase, go to **Authentication → URL Configuration**, set **Site URL** to that address, and add it under **Redirect URLs** too, so sign-in links return to your site. Update `ALLOWED_ORIGINS` if you haven't already, then run `supabase functions deploy analyze-item ai-batch price-check` again.

Netlify works the same way. `public/_headers` sets the security headers on both. If you use a custom domain for Supabase, add it to `connect-src` and `img-src` in `public/_headers`.

## 4. Trade Me import template (one time, on a computer)

1. On Trade Me, open **My Products** (<https://sell.trademe.co.nz>) and create one product by hand with your usual listing duration, pickup, shipping and payment options.
2. Export your products to CSV.
3. In klickList, go to **Settings → Trade Me import template** and load that CSV.

klickList then writes files with Trade Me's exact columns and uses that product's options as defaults for every export.

## 5. On your phone and computer

The same website and account work on both. Sign in with your email code on each device.

Open the site → **Share → Add to Home Screen** (iPhone) or **⋮ → Install app** (Android). Allow camera access when asked.

## Everyday use

1. **New batch**, then snap items on your phone: 1–3 photos each, then **Next item**. Photo 1 should be the front and photo 2 the back or label. On a computer you can drag & drop photos instead.
2. Tap **Done**. The AI writes all the listings. In economy mode they arrive within minutes to an hour, and you can close the app while you wait. White backgrounds and price checks run while the batch page is open. A computer does white backgrounds fastest, so it's a good idea to open the batch on your desktop.
3. **Review & approve**: check each draft, fix anything flagged, then **Approve & next** (Ctrl/Cmd+Enter on desktop).
4. **Upload to Trade Me**: create the file, then on Trade Me go to **My Products → Import photos & products → Import CSV file**.
5. When items sell, delete old batches to free up storage.

## Keeping KlickList separate from your other sites

**Built-in guardrails** (all pinned in `klicklist.config.json`):
- **Website build:** the Cloudflare build refuses to run if `VITE_SUPABASE_URL` points at any Supabase project other than KlickList's.
- **Browser:** the security policy (`public/_headers`) only lets the site talk to KlickList's own Supabase project, not any other `*.supabase.co`.
- **Deploy button:** it only runs from `main`. Before changing anything it checks that the project ID matches, and that the project on Supabase is actually named **klickList**. Otherwise it stops.

**Settings to keep separate** (one-time checks):
- **GitHub:** keep secrets at the **repository** level (klickList → Settings → Secrets), never at account or organisation level. When a tool asks for GitHub access (Cloudflare, Supabase), choose **Only select repositories**.
- **Cloudflare:** KlickList is its own Pages project (`klicklist-app`). Don't add a custom domain from another site's zone. If you want a domain later, use a separate one.
- **Supabase:** KlickList has its own organisation and project. The access token used by the deploy button can reach every project on your Supabase account, so:
  - give it an **expiry**, such as 30 days, and create a new one when needed;
  - never paste it anywhere except the klickList repo's secrets;
  - delete it at supabase.com/dashboard/account/tokens if it's ever exposed.
- **API keys:** use separate AI keys (Gemini, Anthropic) for KlickList rather than sharing keys with other sites. That way a limit or leak in one doesn't affect the other.

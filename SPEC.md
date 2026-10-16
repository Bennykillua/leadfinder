# Build spec: a lead finder you talk to 

Working name: TBD. This replaces the earlier spec. Step 1 (cards + morph animation) is done; build from "Build order" step 2.

## The problem

Freelancers in Lagos who sell to local businesses (video editors, web designers, social media managers) find clients one WhatsApp message at a time. Their cold pitches are generic, so they get ignored. A good pitch needs a reason: something specific that's weak about the business online right now. Finding that by hand takes 10–15 minutes per business.

## The product in one line

Search for businesses, see what's weak about each one, save the good ones to a board, and work them from first pitch to won. Or find people already asking for your skills, and reply to them from the same board.

## First user

My friend, a video editor who gets clients on WhatsApp. The freelancer's **profile** (what they do, their niche, 1–3 portfolio links, an optional rate) is set once and shapes what the audit looks for, which requests match, and how pitches read.

## Partner tools

- **Gemma (featured):** the open-weight brain. Understands what you type, reads audit evidence, scores leads, writes pitches.
- **Render (partner):** hosts the app: one web service with a persistent disk for the SQLite database, at the default `onrender.com` address.
- **SerpApi (partner):** finds real businesses (Google Maps engine: name, category, address, phone, website, rating, review count)), their reviews (Google Maps Reviews engine), and requests for the user's skills (Google Jobs and Google Search engines).

Be honest in the post: SerpApi is closed and paid. The open part is the thinking, which is where the cost would be at volume on a closed model. The cost story uses real numbers: cost per 1,000 leads per model, from our own token logs (deep read + pitch, retries included), as billed by OpenRouter, next to what the same token volume would cost on two popular closed models (prices and where they came from stated in the post).

## Two pages

### 1. Find (home page): the Shapeshift box

One text box. After a ~300 ms pause, Gemma classifies the text and the box morphs into one of two cards:

- **Search card** — "event centres in Lekki", "salons in Yaba"
  - Calls SerpApi, shows results row by row as they arrive.
  - **Quota rule (free plan):** one SerpApi call per search, one page only (about 20 results), show the top 10. A "Show more" button reveals the rest of that page without a new call. No automatic paging. Cache each query for 24 hours. Count every SerpApi call in a small usage counter so I can see the quota.
  - **Any city or country.** No location is forced on the search. The country of each result is detected from the search text (a named country), an international `+` phone number, or the result's map coordinates, and drives phone handling (see WhatsApp).
  - Each row: name, category, area, rating, phone label (see WhatsApp), quick score once its audit finishes.
  - Each row has **Save lead** → adds it to the board's **Saved** column. Saved rows show a tick.
- **Audit card** — a website ("smiledental.ng") or a business name ("Smile Dental Lekki")
  - If it's a name, look it up with SerpApi first to get website and phone.
  - If it's a website, don't look it up on Maps automatically. A **Look up on Maps** button does it on request (uses one SerpApi credit).
  - Shows score (1–5), evidence list, top reason to pitch.
  - Has **Save lead**.

- **Requests card** — "find people looking for me", "who needs a video editor in Lagos" (see "Find people looking for you")

`/` shows exactly three rows, one per card type (Search, Audit, Requests), each with one example inside the row. Never one row per example.

When the empty box gets focus (click or tap), the same card menu opens automatically, as if `/` had been pressed. No `/` character is inserted into the box. The menu closes as soon as the user types.

### 2. Board: where leads get worked

Kanban columns: **Saved → Pitched → Replied → Won / Lost**. Drag cards between columns; moving a card is the status update.

Each card shows: business name, score, top reason, phone label, a reminder badge if one is set, and a note count if it has notes.

Clicking a card opens a **detail drawer**:

- Audit evidence (re-run audit button)
- **Read reviews** (saved leads found on Google Maps only): fetches reviews with SerpApi's `google_maps_reviews` engine, one call = 1 credit, cached 7 days. One call returns 8 reviews in one sort order, so it fetches the **8 lowest-rated** reviews and shows them newest first, with dates. The reviews go to Gemma's deep read as extra evidence. Any finding taken from a review must quote the review.
- **Pitch:** "Write pitch" asks Gemma for an evidence-based draft (see "Evidence-based pitches" below). The evidence the draft used is highlighted in the drawer, with what the owner can check, so it can be verified before sending. Fully editable text. "Open in WhatsApp" button. After sending, a prompt asks "Move to Pitched?"
- **Reminder:** when a lead is moved to **Pitched** and has no reminder, a follow-up reminder is set automatically for 3 days later (editable or removable like any reminder). One date picker, one time picker, one short note ("call the manager"), and a delete button. That's all. No separate "change it in words" box. Optional: the date field also accepts typed words ("next Tuesday 3pm"), parsed with chrono-node into the pickers. The note is never parsed as a date. The summary line must always match the pickers exactly.
- **Notes:** as many notes per lead as needed, newest first, each with when it was written ("spoke to the manager, call back after the 20th"). Add, edit and delete each note; deleting asks for confirmation first. Notes are stored per user and go with the lead if it is deleted (and come back on Undo).
- **Delete lead:** a delete button in the drawer (and in the card's menu). Confirm, or show an Undo toast for 5 seconds.

Board header shows **Due today** reminders first.

## The audit: code finds facts, Gemma reads them

Crawl up to 5 pages per site: the homepage plus the about, services, contact and booking pages if the site links to them.

Deterministic checks (code):

- No website listed
- Site down or erroring
- No HTTPS
- Not mobile-friendly (no viewport meta tag)
- Speed and quality from the **PageSpeed Insights API** (Google runs Lighthouse for us; Chrome never runs on our server): mobile strategy, **performance, accessibility and SEO** categories only. **Optional:** `PAGESPEED_API_KEY` raises the quota; without it the API is called keyless. Any failure (quota, rate limit, timeout, a site it can't load) marks Speed, Accessibility and SEO as **Couldn't check** and the audit carries on; PageSpeed never fails an audit. Runs alongside the crawl on the Audit card and Re-run audit (waits at most 20 s; a slower result is cached for the next run); search rows only use a cached result. Results cached 24 hours, and after a quota error it isn't called again for 10 minutes. Replaces our own load-time measurement where it ran.
- Stale content (old copyright year, old last post)
- No clear contact or booking path
- Booking form
- Prices listed
- Online payment (Paystack or Flutterwave scripts)
- Link preview for WhatsApp / social shares (Open Graph `og:title`, `og:image`)
- Video: embedded video or YouTube/Vimeo links
- Social links (Instagram, TikTok, Facebook, YouTube)
- Page title, meta description, H1
- Broken links on the crawled pages (at most 20 checked)
- Images over 1 MB
- Weak Maps presence: few reviews, low rating

The top reason depends on the user's offer (from settings): for video editors, prefer video and social gaps; for websites, prefer PageSpeed performance, mobile, booking and SEO gaps. Raw load time is never a top reason.

In the UI, evidence is grouped: **Problems** first, then **Passed**, then **Couldn't check**.

### Evidence-based pitches

Every piece of evidence has an id and a plain-English "what they can check" line (e.g. `check:https` → "Open their site in Chrome: the address bar says Not secure"). Evidence comes from: the rule checks, Gemma's findings, Google reviews, and timing signals (PageSpeed scores will join when they're built).

- The pitch output includes `evidence_ids`. A pitch with no evidence ids, an id that doesn't exist, or a claim not in the cited evidence (quotes, the opening observation, or a number about the business: ratings, review counts, scores, prices, dates, load times) is rejected and retried once. Other numbers are fine: the freelancer's own prices and offer, and ordinary phrasing like "1 quick question" or "a 30-second video".
- **Issue or opportunity:** every lead can be pitched. The pitch opens with one piece of evidence as its way in: an issue when there is one (preferred), otherwise a real strength (a passed check or a good review: "4.7★ from 64 reviews") and how the freelancer could help more customers see it. Never an invented problem.
- Bookkeeping slips are repaired, not rejected: ids written inside the message or with brackets, and a figure from an evidence item the model forgot to cite (that item gets cited). Facts not in the evidence are still rejected.
- Structure: an observation they can verify → why it matters from their customer's view → one simple question. 50–125 words. No list of services, no hard sell, and no flattery beyond one true compliment from the evidence (a passed check or a good review).
- **Why now?** shown when a timing signal exists: new reviews in the last 30 days, a recent bad review, hiring, or a new location (from the site text).

- **Portfolio link:** business pitches include the user's first portfolio link ("Here's some of my work: <link>") just before the closing question. Code adds it, exactly as saved; the model writes no links (a pitch with any other link is rejected), and its text is 50–120 words to leave room. Niche and rate are not sent to the business pitch (in testing they made gemma3:4b cite the profile instead of the business's problems); they're for matching requests.

Gemma takes the evidence + the user's offer and returns
`{ score: 1–5, top_reason: string }` (top_reason up to 150 characters; a longer one is trimmed at a word boundary, never rejected); pitches are a separate call returning `{ pitch: string }`.
Every claim in a pitch must come from the evidence list. No invented facts.

## Find people looking for you

A second way to find leads: people and companies already asking for the user's skills. Same box, same board, same pitch writer.

- **Sources** (2 SerpApi credits per search, cached 24 hours, counted like every call):
  - `google_jobs`: "{what you do} {niche}" + the place typed (e.g. "freelance video editor", location "Lagos, Nigeria"). Full descriptions, good for Gemma. **Freelance, contract and full-time** are all shown, each tagged.
  - `google`: a skills query, e.g. `"need someone to edit" OR "looking for a video editor" Lagos site:linkedin.com`. Mostly job listings plus some posts; only the search snippet is used. LinkedIn, Facebook and other pages are never fetched.
- **Anything about needing the user's skills counts**, not only job titles ("need someone to cut my wedding video" is a request). Tested: plain skill phrases bring a lot of noise (software questions, rate threads, other editors' profiles), so every result goes through two filters:
  - **Code:** drop profile pages (`/in/`), drop jobs that exclude the user's country ("available from: Europe…"), mark posts older than 30 days as stale.
  - **Gemma:** "Is this a person or business that needs this skill done for them?" yes/no with a quoted reason; "no" results are hidden behind a count ("4 hidden: not requests").
- **Result row:** title, who posted, where, posted date, budget if stated, type (freelance / contract / full-time / internship), source, **Save lead**.
- **On the board:** the same columns, drawer, notes and 3-day follow-up, with a **Request** badge. Pitched means "applied / replied". The drawer has **Open post / Apply** and **Copy reply**; email only when the post itself shows one. No looking up the poster's personal contacts.
- **Request read** (Gemma, replaces the website audit): fit score for the user's niche and portfolio, can the user take it (location, remote), freelance or full-time, and up to 3 requirements quoted from the post as evidence (`req:1`…).
- **Reply pitch:** the same pitch writer and rules (evidence ids, 50–125 words, one question, number and quote checks), but the structure is: what they asked for (quoted) → why the user fits (citing a portfolio link or niche) → one question.

## WhatsApp

No API. `https://wa.me/<number>?text=<encoded pitch>`. The user reviews before sending.

Number source, best first:

1. **WhatsApp confirmed:** website links to `wa.me/...` or `api.whatsapp.com/send?phone=...`.
2. **Likely WhatsApp:** the Maps phone is a mobile number for its country (or a number type that can be mobile, as in the US), decided with `libphonenumber-js` using the detected country.
3. **Call only:** landlines, and numbers that can't be parsed, get a call button.

Numbers are normalised to full international format with `libphonenumber-js`; `wa.me` links use the full international number (country code, no `+`). Never verify WhatsApp registration programmatically.

**"Open in WhatsApp" must work as soon as there is a number and pitch text:** it opens `https://wa.me/<number>?text=<encoded pitch>` in a new tab. No backend needed. Disable it only when there's no WhatsApp-capable number, and say why in a tooltip.

### Email fallback

When there's no WhatsApp number (call-only or no phone):

- During the website crawl, look for a **business** email on the business's own site: `mailto:` links, then the homepage and a `/contact` page for text like `info@`, `hello@`, `bookings@`.
- If found, show **Open in email** → `mailto:<email>?subject=<short subject>&body=<encoded pitch>`. It opens the user's own email app; the app never sends email itself.
- If nothing is found: show the phone with a **Call** button, and a "No WhatsApp or email found" label.
- Only emails the business publishes on its own website. No guessing addresses, no third-party email finders.

Contact priority on every card: WhatsApp confirmed → likely WhatsApp → email from website → call only. When both a likely-WhatsApp number and an email exist, show both buttons.

## Login and data

- **Email + password sign-up and sign-in.** Passwords are hashed with scrypt (N=2^17, r=8, p=1; older hashes are upgraded on the next sign-in). The session is a signed JWT (HS256, signed with `AUTH_SECRET`) in an httpOnly cookie, valid 30 days, carrying a session id that must exist in the `session` table. Sign out deletes that row and the cookie, so the token stops working immediately everywhere. Failed passwords back off, never lock: 5 failures for one email within 15 minutes → wait 15 minutes (also 50 per IP); a successful sign-in resets it. Every lead, reminder and note belongs to a user; nobody sees anyone else's board.
- First sign-in asks for the **profile**: what you do (video editing / websites / social media / other + free text), your niche (e.g. "shortlet and real-estate tours"), 1–3 portfolio links (http/https), and an optional rate (e.g. "from ₦50k per video"). Editable in settings. Existing users without portfolio links are asked once.
- A **demo account** with sample leads for judges, linked from the post.
- SQLite (Drizzle) on the Render persistent disk, every table keyed by `user_id`.
- Cache SerpApi results per query for 24 hours to save the free quota.

## Ethics and limits (say this in the post)

- Public business information only. No personal emails or private profiles.
- Respect robots.txt; one request per site; rate-limit crawling.
- One message at a time, sent by the user. No bulk sending.

## Model

- **Two providers, one pipeline:** `LLM_PROVIDER=ollama` (local, default) or `openrouter` (production, open-weight models hosted by OpenRouter). Same prompts, zod validation, checks, repairs, retry and `llm_call` logging either way; only the transport differs, and each logged call records its provider, the options actually sent, and (OpenRouter) the billed cost.
  - **Ollama:** structured outputs (JSON schema in `format`), temperature 0.3 (0.6 on the retry), repeat_penalty 1.1, num_ctx 8192, num_predict 400. One model call at a time.
  - **OpenRouter:** chat completions with JSON schema structured outputs (`strict`), the same settings as Ollama (temperature 0.3, 0.6 on the retry; `max_tokens` 400; `repetition_penalty` 1.1), and `provider.require_parameters` so only hosts that honour all of them are used. Reasoning is turned off on models that have it (Qwen3). `OPENROUTER_API_KEY` in `.env.local` / Render only. Production model: `google/gemma-3-12b-it`.
- Validated with zod, retry once on invalid output. If the deep read's retry still breaks a rule, keep the parts that pass: drop bad findings, replace a bad top reason with the best finding (or the rule-based reason), and raise a too-low no-website score to 3. A pitch is never salvaged: it fails with the reason.
- Three prompts: intent (search vs audit, as you type), audit scoring, pitch writing.
- Examples include Pidgin and Lagos place names.
- Search vs audit is decided by code (URL or "X in Y" pattern), not the model.
- Gemma's three jobs (the open-source core of the project):
  - **Read the site, not just check it:** Gemma gets trimmed page text (about 1,800 characters, mostly the homepage) plus the check results, and spots what rules can't (no prices, generic copy, stock photos, menu only as an image, nothing about the service the user sells).
  - **Judge fit for this user's offer:** score and top reason are for this user, e.g. "no video" matters to a video editor, not a web designer.
  - **Write the pitch:** 50–125 words. Open with the specific observation (the checkable problem), end with one simple question, no hard sell, no list of services. Every claim comes from the evidence.
- The model name is an env var `LLM_MODEL` (an Ollama tag like `gemma3:12b`, or an OpenRouter id like `google/gemma-3-12b-it`). Compare models with `npm run eval:models` (below): Gemma 3 4B/12B/27B and Qwen3 32B on OpenRouter, plus gemma3:12b on Ollama (the same model hosted vs on this machine).
- Log input/output tokens per audit and per pitch for cost comparison.

## Stack

Next.js (App Router), TypeScript strict, Tailwind, shadcn/ui, Motion, zod, chrono-node, jose (JWT sessions), SQLite (Drizzle), dnd-kit for the board. Crawl with `fetch` + cheerio.

## Hosting

- **Render web service** (Starter, 512 MB) at the default `onrender.com` address, defined in `render.yaml` (a Blueprint). Build `npm ci && npm run build`; start runs the database migrations (`node scripts/migrate.mjs`), then `npm start`.
- **Persistent disk** (1 GB) at `/var/data`, `DATABASE_URL=file:/var/data/leadfinder.db`. Render snapshots it daily. A disk means one instance and a few seconds of downtime per deploy, which matches the app's in-memory rate limits and queues.
- **Environment:** `AUTH_SECRET`, `DATABASE_URL`, `SERPAPI_API_KEY`, `LLM_PROVIDER=openrouter`, `LLM_MODEL=google/gemma-3-12b-it`, `OPENROUTER_API_KEY`, optional `PAGESPEED_API_KEY`, `STATS_EXCLUDE_EMAILS`. Secrets only in Render's environment settings and `.env.local`, never in the repo.
- No Chrome on the server: page speed comes from the PageSpeed Insights API.
- Budget: about $7.25/month on Render ($7 Starter + $0.25 disk) against $50 of credit; OpenRouter tokens are billed separately (prepaid credit).

## Numbers to measure for the post

- Time per lead: by hand vs with the tool
- First-try valid JSON rate per prompt (target 90%+)
- Median latency: intent, audit, pitch
- Cost per 1,000 leads: each open model on OpenRouter (billed cost from our logs) vs the same token volume on two closed models
- Pitch accuracy: of 20 pitches, how many named a real, checkable problem
- First user: leads saved, pitches sent, replies

How they're measured:
- `npm run stats:llm`: valid-JSON and grounded rates, tokens, latency from the `llm_call` log.
- `npm run eval:models`: the same saved leads (up to 15) through each model in turn, on a copy of the database. Models are `provider=model` (default: OpenRouter `google/gemma-3-4b-it`, `google/gemma-3-12b-it`, `google/gemma-3-27b-it`, `qwen/qwen3-32b`, and Ollama `gemma3:12b`); OpenRouter models are skipped without `OPENROUTER_API_KEY`, Ollama models that aren't pulled are skipped. Prints success rate, grounded-first-try rate and latency per model for deep read and pitch, and cost per 1,000 leads per model (what OpenRouter billed; local Ollama is $0 per token). Then what the same token volume would cost on two closed models (Claude Sonnet 5.5 and GPT-5.4), with the price source and date.
- `npm run stats:usage`: an `event` table records sign-ups, searches, audits (Audit card and Re-run), leads saved, pitches written, Open in WhatsApp / Open in email clicks, and moves to Replied or Won, each with user id and time only. Prints the number of users and each total, overall and per numbered user (no names or emails), leaving out the accounts in `STATS_EXCLUDE_EMAILS`. Tracking starts with the table; nothing earlier is backfilled.

## Build order

1. ~~Cards + morph animation with fake data~~ (done)
2. **Restructure:** home page = box with Search and Audit cards only. Remove Pitch, Status and Reminder cards from the box. Add the Board page with columns, drag-and-drop, and the detail drawer (pitch, reminder, notes) — fake data, but reminders and notes fully editable. Save lead moves a card into Saved.
3. **Database + login:** SQLite, email + password sign-in with JWT sessions, offer question, per-user data. Replace fake data with real storage.
4. **Real search:** SerpApi Google Maps into the Search card, with caching.
5. **Real audit:** code checks, then name → SerpApi lookup → audit.
6. **Gemma in:** site reading, fit scoring for the user's offer, pitch writing. Log valid-JSON rate and tokens from day one. Then run the 20-audit model comparison.
7. **Profile:** niche, 1–3 portfolio links, optional rate in onboarding and settings. Business pitches may use one portfolio link.
8. **Find people looking for you, search:** Requests card, google_jobs + skills search, code and Gemma filters, result rows, Save to the board.
9. **Find people looking for you, reply:** request read and reply pitch.
10. **WhatsApp links + Due today.**
11. **Deploy** to Render (web service + persistent disk, default `onrender.com` address), with `LLM_PROVIDER=openrouter`. Create the demo account.
12. **First user:** sit with the video editor, run real searches, send real pitches.
13. **Post:** demo video, numbers, first-user story.

## Out of scope this week

Sending email from the app (mailto links only), bulk sending, Instagram scraping, personal contact enrichment, payments, team accounts.

## Credit

The type-and-it-becomes-a-card interaction is inspired by Shapeshift (MIT, github.com/anishfn/shapeshift). Credit it in the README and the post.
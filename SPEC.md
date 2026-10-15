# Build spec: a lead finder you talk to 

Working name: TBD. This replaces the earlier spec. Step 1 (cards + morph animation) is done; build from "Build order" step 2.

## The problem

Freelancers in Lagos who sell to local businesses (video editors, web designers, social media managers) find clients one WhatsApp message at a time. Their cold pitches are generic, so they get ignored. A good pitch needs a reason: something specific that's weak about the business online right now. Finding that by hand takes 10–15 minutes per business.

## The product in one line

Search for businesses, see what's weak about each one, save the good ones to a board, and work them from first pitch to won.

## First user

My friend, a video editor who gets clients on WhatsApp. The freelancer's **offer** ("I edit videos", "I build websites") is set once in their profile and shapes what the audit looks for and how pitches read.

## Partner tools

- **Gemma (featured):** the open-weight brain. Understands what you type, reads audit evidence, scores leads, writes pitches.
- **DigitalOcean (featured):** hosts the app and runs Gemma via Ollama.
- **SerpApi (partner):** finds real businesses (Google Maps engine: name, category, address, phone, website, rating, review count).
- **.tech domain (partner):** the live URL.

Be honest in the post: SerpApi is closed and paid. The open part is the thinking, which is where the cost would be at volume on a closed model.

## Two pages

### 1. Find (home page): the Shapeshift box

One text box. After a ~300 ms pause, Gemma classifies the text and the box morphs into one of two cards:

- **Search card** — "event centres in Lekki", "salons in Yaba"
  - Calls SerpApi, shows results row by row as they arrive.
  - **Quota rule (free plan):** one SerpApi call per search, one page only (about 20 results), show the top 10. A "Show more" button reveals the rest of that page without a new call. No automatic paging. Cache each query for 24 hours. Count every SerpApi call in a small usage counter so I can see the quota.
  - Each row: name, category, area, rating, phone label (see WhatsApp), quick score once its audit finishes.
  - Each row has **Save lead** → adds it to the board's **Saved** column. Saved rows show a tick.
- **Audit card** — a website ("smiledental.ng") or a business name ("Smile Dental Lekki")
  - If it's a name, look it up with SerpApi first to get website and phone.
  - Shows score (1–5), evidence list, top reason to pitch.
  - Has **Save lead**.

`/` shows exactly two rows, one per card type (Search, Audit), each with one example inside the row. Never one row per example.

### 2. Board: where leads get worked

Kanban columns: **Saved → Pitched → Replied → Won / Lost**. Drag cards between columns; moving a card is the status update.

Each card shows: business name, score, top reason, phone label, and a reminder badge if one is set.

Clicking a card opens a **detail drawer**:

- Audit evidence (re-run audit button)
- **Pitch:** "Write pitch" asks Gemma for a draft. Fully editable text. "Open in WhatsApp" button. After sending, a prompt asks "Move to Pitched?"
- **Reminder:** one date picker, one time picker, one short note ("call the manager"), and a delete button. That's all. No separate "change it in words" box. Optional: the date field also accepts typed words ("next Tuesday 3pm"), parsed with chrono-node into the pickers. The note is never parsed as a date. The summary line must always match the pickers exactly.
- **Notes:** free text ("spoke to the manager, call back after the 20th").
- **Delete lead:** a delete button in the drawer (and in the card's menu). Confirm, or show an Undo toast for 5 seconds.

Board header shows **Due today** reminders first.

## The audit: code finds facts, Gemma reads them

Deterministic checks (code):

- No website listed
- Site down or erroring
- No HTTPS
- Not mobile-friendly (no viewport meta tag)
- Slow first load (time it)
- Stale content (old copyright year, old last post)
- No clear contact or booking path
- No video on the page (for video-editor offers)
- Weak Maps presence: few reviews, low rating

Gemma takes the evidence + the user's offer and returns
`{ score: 1–5, top_reason: string }`; pitches are a separate call returning `{ pitch: string }`.
Every claim in a pitch must come from the evidence list. No invented facts.

## WhatsApp

No API. `https://wa.me/<number>?text=<encoded pitch>`. The user reviews before sending.

Number source, best first:

1. **WhatsApp confirmed:** website links to `wa.me/...` or `api.whatsapp.com/send?phone=...`.
2. **Likely WhatsApp:** Maps phone is a Nigerian mobile number (`070`, `080`, `081`, `090`, `091` / `+234 7|8|9`).
3. **Call only:** landlines get a call button.

Normalise to `234...`. Never verify WhatsApp registration programmatically.

**"Open in WhatsApp" must work as soon as there is a number and pitch text:** it opens `https://wa.me/<number>?text=<encoded pitch>` in a new tab. No backend needed. Disable it only when there's no WhatsApp-capable number, and say why in a tooltip.

### Email fallback

When there's no WhatsApp number (call-only or no phone):

- During the website crawl, look for a **business** email on the business's own site: `mailto:` links, then the homepage and a `/contact` page for text like `info@`, `hello@`, `bookings@`.
- If found, show **Open in email** → `mailto:<email>?subject=<short subject>&body=<encoded pitch>`. It opens the user's own email app; the app never sends email itself.
- If nothing is found: show the phone with a **Call** button, and a "No WhatsApp or email found" label.
- Only emails the business publishes on its own website. No guessing addresses, no third-party email finders.

Contact priority on every card: WhatsApp confirmed → likely WhatsApp → email from website → call only. When both a likely-WhatsApp number and an email exist, show both buttons.

## Login and data

- **Email + password sign-up and sign-in.** Passwords are hashed with scrypt; the session is a signed JWT (HS256, signed with `AUTH_SECRET`) in an httpOnly cookie, valid 30 days. Sign out deletes the cookie. Every lead, reminder and note belongs to a user; nobody sees anyone else's board.
- First sign-in asks one question: "What do you sell?" (video editing / websites / social media / other + free text). Editable in settings.
- A **demo account** with sample leads for judges, linked from the post.
- SQLite (Drizzle) on the droplet, every table keyed by `user_id`.
- Cache SerpApi results per query for 24 hours to save the free quota.

## Ethics and limits (say this in the post)

- Public business information only. No personal emails or private profiles.
- Respect robots.txt; one request per site; rate-limit crawling.
- One message at a time, sent by the user. No bulk sending.

## Model

- Gemma via Ollama, structured outputs (JSON schema in `format`), validated with zod, retry once on invalid output.
- Three prompts: intent (search vs audit, as you type), audit scoring, pitch writing.
- Examples include Pidgin and Lagos place names.

## Stack

Next.js (App Router), TypeScript strict, Tailwind, shadcn/ui, Motion, zod, chrono-node, jose (JWT sessions), SQLite (Drizzle), dnd-kit for the board. Crawl with `fetch` + cheerio.

## Numbers to measure for the post

- Time per lead: by hand vs with the tool
- First-try valid JSON rate per prompt (target 90%+)
- Median latency: intent, audit, pitch
- Cost per 100 leads: Gemma on my droplet vs a closed API
- Pitch accuracy: of 20 pitches, how many named a real, checkable problem
- First user: leads saved, pitches sent, replies

## Build order

1. ~~Cards + morph animation with fake data~~ (done)
2. **Restructure:** home page = box with Search and Audit cards only. Remove Pitch, Status and Reminder cards from the box. Add the Board page with columns, drag-and-drop, and the detail drawer (pitch, reminder, notes) — fake data, but reminders and notes fully editable. Save lead moves a card into Saved.
3. **Database + login:** SQLite, email + password sign-in with JWT sessions, offer question, per-user data. Replace fake data with real storage.
4. **Real search:** SerpApi Google Maps into the Search card, with caching.
5. **Real audit:** code checks, then name → SerpApi lookup → audit.
6. **Gemma in:** intent, audit scoring, pitch writing. Log valid-JSON rate from day one.
7. **WhatsApp links + Due today.**
8. **Deploy** to DigitalOcean + .tech domain. Create the demo account.
9. **First user:** sit with the video editor, run real searches, send real pitches.
10. **Post:** demo video, numbers, first-user story.

## Out of scope this week

Sending email from the app (mailto links only), bulk sending, Instagram scraping, personal contact enrichment, payments, team accounts.

## Credit

The type-and-it-becomes-a-card interaction is inspired by Shapeshift (MIT, github.com/anishfn/shapeshift). Credit it in the README and the post.
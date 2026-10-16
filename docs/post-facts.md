# leadfinder: facts for the DEV write-up

Everything here is measured, taken from the code, or from git history. Gaps are marked **TODO**. Dates are 2026.

## What it does

leadfinder helps freelancers in Lagos who sell to local businesses (video editors, web designers, social media managers) find clients and pitch them one WhatsApp message at a time. After signing up and setting a profile (what you do, your niche, 1–3 portfolio links, an optional rate), you type into one box: "salons in Yaba" searches Google Maps, while a website or business name runs an audit. Each business gets a score from 1 to 5, a list of evidence (problems, passed checks, couldn't-check items) and a top reason to pitch. You save the good ones to a board (Saved → Pitched → Replied → Won / Lost). In the drawer, Gemma reads the site and the business's lowest-rated Google reviews, then writes a 50–125 word pitch. The pitch opens with one checkable problem, or a real strength, and ends with one question. **Open in WhatsApp** opens `wa.me` with the pitch filled in. You review and send every message yourself. Moving a lead to Pitched sets a follow-up reminder for 3 days later.

## Tech stack

- **App:** Next.js 16.4.1 (App Router, Turbopack, Cache Components), TypeScript (strict), Tailwind, shadcn/ui, Motion, dnd-kit (board drag-and-drop), zod, chrono-node, libphonenumber-js.
- **Data:** SQLite through Drizzle ORM and libsql, migrations in `drizzle/` (0000–0014).
- **Auth:** email + password (scrypt, N=2^17), with a signed HS256 JWT session cookie (jose) backed by a `session` table, so sign-out is immediate. Failed sign-ins back off rather than lock: 5 failures for one email within 15 minutes means a 15-minute wait.
- **Crawling:** `fetch` + cheerio.

### How each partner tool is used

- **Gemma (featured model):**
  - **Locally:** through [Ollama](https://ollama.com) (`gemma3:4b` is what the logged calls used; `gemma3:12b` is also pulled). JSON schema in `format`; settings num_ctx 8192, num_predict 400, temperature 0.3 (0.6 on the retry), repeat_penalty 1.1, `think: false`. One call at a time.
  - **In production:** `google/gemma-3-12b-it` through [OpenRouter](https://openrouter.ai) (`LLM_PROVIDER=openrouter`): strict JSON schema structured outputs, the same settings (temperature 0.3/0.6, max_tokens 400, repetition_penalty 1.1), and `provider.require_parameters: true` so only hosts that honour all of them are used. Reasoning is switched off on models that have it (Qwen3). OpenRouter's billed cost (`usage.cost`) is logged per call.
  - **Shared:** both providers use the same prompts, zod validation, grounding checks, repairs, retry and `llm_call` logging. Only the transport differs (`lib/llm/providers/`).
- **Render:** hosts the app. Blueprint in `render.yaml`: one web service (plan `0.5c-512mb`, i.e. 0.5 CPU / 512 MB, Frankfurt), build `npm ci && npm run build`, start `node scripts/migrate.mjs && npm start`, and a 1 GB persistent disk at `/var/data` holding the SQLite file. Default `onrender.com` address. **TODO:** live URL.
- **SerpApi:** Google Maps engine for search and name lookups (name, category, address, phone, website, rating, review count), and the Google Maps Reviews engine for the 8 lowest-rated reviews of a saved lead. Each query is cached for 24 hours (reviews for 7 days), and every call is counted in a usage counter.
- **PageSpeed Insights API:** performance, accessibility and SEO scores (mobile), so Chrome never runs on our server. It runs on the Audit card and Re-run audit, alongside the crawl, waiting at most 20 s. Search rows only use a cached result. A key is optional; any failure marks Speed/Accessibility/SEO as "Couldn't check" and the audit carries on. On 2026-10-16 the keyless API returned **HTTP 429**: "Quota exceeded for quota metric 'Queries' and limit 'Queries per day'". Without a key, expect "Couldn't check".

## The audit

The crawl reads the homepage plus the contact page if the site links to one. Limits: 10 s timeout, 1.5 MB per page, 5 redirects, robots.txt respected, private/internal addresses blocked, 24-hour crawl cache.

Deterministic checks (code, `lib/audit/checks.ts`), each one becoming an evidence item with a "what they can check" line:

| Check | Weak spot when |
|---|---|
| Website | No website on Maps, or Maps links to a social page (Facebook, Instagram, TikTok, X, Linktree, WhatsApp, LinkedIn, YouTube) |
| Site up | Doesn't load, HTTP error, or TLS/certificate warning |
| HTTPS | Served over plain http:// |
| Mobile-friendly | No viewport meta tag |
| Speed | PageSpeed performance < 50/100 (falls back to our own first load > 3 s when PageSpeed didn't run) |
| Accessibility | PageSpeed accessibility < 70/100 |
| SEO | PageSpeed SEO < 80/100 |
| Fresh content | Footer © year 2+ years old, or newest dated post over a year old |
| Contact path | No phone link, WhatsApp link, booking link or form |
| WhatsApp button | wa.me link goes to a placeholder number |
| Video (video editors only) | No video on the homepage or contact page |
| Maps presence | Fewer than 20 reviews or rating below 4.0 |

Evidence is shown grouped: Problems, then Passed, then Couldn't check. A provisional score and top reason come from offer-specific weights (for video editors, video gaps weigh 2.5; for websites, mobile weighs 2).

## Gemma's three jobs

1. **Read the site, not just check it:** Gemma gets about 1,800 characters of page text (up to 1,200 from the homepage), up to 1,600 characters of reviews, and the check results. It returns `{score, top_reason, findings}` with up to 3 findings the checks didn't already list, each with where the owner can see it.
2. **Judge fit for this user's offer:** the score and top reason are for this freelancer's service ("no video" matters to a video editor, not a web designer).
3. **Write the pitch:** an observation they can verify, then why it matters to their customers, then one simple question. 50–125 words (50–120 when a portfolio link is added). The user's first portfolio link is inserted by code ("Here's some of my work: …"), never written by the model.

## Validation and grounding

Every reply is parsed and validated with zod and then checked by rules in code. A rejected reply gets **one retry**, with the reason fed back and the previous answer echoed as compact JSON.

**Deep read (`lib/llm/deep-read.ts`):**
- Findings must be written from the customer's point of view, point at something specific in the page text, reviews or evidence, and never mention the freelancer, "opportunity" or "online presence".
- A finding taken from a review must quote the review's own words; numbers must appear in the facts; no `{ } [ ]` inside sentences; no copying the prompt's example.
- A top reason over 150 characters is trimmed at a word boundary, not rejected. A score below 3 on a site with no working website is rejected.
- If the retry also fails, the parts that pass are kept: bad findings are dropped, a bad top reason is replaced by the best finding (or the rule-based reason), and a too-low no-website score is raised to 3.

**Pitch (`lib/llm/pitch.ts`):**
- Rejected if:
  - `evidence_ids` is empty, has unknown ids, or cites only timing;
  - the opening doesn't say what the cited evidence says;
  - the message is out of the word range, has a list, doesn't end with exactly one question, or contains a link;
  - it uses hard-sell words ("guarantee", "act now", "discount", …), lists 4+ services, or has more than one compliment, or a compliment not backed by a passed check or good review;
  - it has a quote not in the evidence, or copies the example.
- **Number rule:** only numeric claims *about the business* (ratings, review counts, scores, percentages, prices, years, "N days ago", dates, load times) must appear in the cited evidence. The freelancer's own offer, profile and ordinary phrasing ("1 quick question", "a 30-second video") are allowed.
- **Repaired, not rejected:** ids written inside the message or in brackets, and a figure from an evidence item the model forgot to cite (that item gets cited).
- **Issue or opportunity:** when no problem exists, the pitch opens on a real strength (a passed check or good review) instead.

Every call is logged to `llm_call`: provider, model, tokens, latency, first-try JSON validity, first-try grounding, attempts, error, options sent, billed cost, and on failure the raw output of each attempt.

## Model comparison: `npm run eval:models`

Ran on 2026-10-16 on the 8 saved leads in the database backup taken just before the account was deleted, on a temporary copy. The output is copied exactly; only the live progress lines were removed:

```
8 leads × 5 model(s): openrouter=google/gemma-3-4b-it, openrouter=google/gemma-3-12b-it, openrouter=google/gemma-3-27b-it, openrouter=qwen/qwen3-32b, ollama=gemma3:12b (only 8 saved, asked for 15)

openrouter=google/gemma-3-12b-it: OpenRouter is rate-limiting requests: Provider returned error

ollama=gemma3:12b: warming up…

model                             call       runs  success  grounded 1st  median  p90
-----------------------------------------------------------------------------------------
openrouter=google/gemma-3-4b-it   deep_read  8     50%      0%            10.1s   17.9s
openrouter=google/gemma-3-4b-it   pitch      8     63%      38%           3.5s    5.6s
openrouter=google/gemma-3-12b-it  deep_read  4     75%      25%           22.0s   55.5s
openrouter=google/gemma-3-12b-it  pitch      3     67%      67%           3.4s    14.8s
openrouter=google/gemma-3-27b-it  deep_read  8     100%     13%           18.4s   52.4s
openrouter=google/gemma-3-27b-it  pitch      8     100%     88%           16.8s   47.1s
openrouter=qwen/qwen3-32b         deep_read  8     100%     50%           5.5s    14.0s
openrouter=qwen/qwen3-32b         pitch      8     100%     100%          3.7s    4.4s
ollama=gemma3:12b                 deep_read  8     100%     63%           12.4s   19.3s
ollama=gemma3:12b                 pitch      8     100%     100%          8.4s    10.0s

success = passed every check (after at most one retry or salvage). grounded 1st = passed on the first answer.
Latency is the model calls only (both attempts when retried), not crawling.

Cost per 1,000 leads (deep read + pitch, retries included):
model                             tokens/lead in  out    per 1,000  price
openrouter=google/gemma-3-4b-it   3594            592    $0.21      billed by OpenRouter (list price $0.05 in / $0.1 out per 1M)
openrouter=google/gemma-3-12b-it  2924            249    $0.23      billed by OpenRouter (list price $0.05 in / $0.15 out per 1M)
openrouter=google/gemma-3-27b-it  3039            270    $0.32      billed by OpenRouter (list price $0.08 in / $0.45 out per 1M)
openrouter=qwen/qwen3-32b         2430            262    $0.27      billed by OpenRouter (list price $0.08 in / $0.28 out per 1M)
ollama=gemma3:12b                 2403            234    $0         local: no per-token price (your machine and power)

The same token volume (openrouter=google/gemma-3-12b-it: 2924 in / 249 out per lead) on closed models:
Claude Sonnet 5.5                 $8.34      per 1,000 leads  ($2 in / $10 out per 1M; https://platform.claude.com/docs/en/about-claude/pricing, checked 2026-10-16)
GPT-5.4                           $11.05     per 1,000 leads  ($2.5 in / $15 out per 1M; https://developers.openai.com/api/docs/pricing, checked 2026-10-16)
Approximate: closed models count tokens with their own tokenizers.

Failures (10):
- stopped early: openrouter=google/gemma-3-12b-it: OpenRouter is rate-limiting requests: Provider returned error
- openrouter=google/gemma-3-4b-it deep_read: The reply hit the 400-token limit before the JSON finished. Keep every field short.
- openrouter=google/gemma-3-4b-it deep_read: The reply wasn't valid JSON.
- openrouter=google/gemma-3-4b-it deep_read: The reply hit the 400-token limit before the JSON finished. Keep every field short.
- openrouter=google/gemma-3-4b-it deep_read: The reply hit the 400-token limit before the JSON finished. Keep every field short.
- openrouter=google/gemma-3-4b-it pitch: "evidence_ids" has ids that aren't in the evidence list: PASSED. Use ids exactly as written in brackets.
- openrouter=google/gemma-3-4b-it pitch: "evidence_ids" has ids that aren't in the evidence list: PROBLEM. Use ids exactly as written in brackets.
- openrouter=google/gemma-3-4b-it pitch: "evidence_ids" has ids that aren't in the evidence list: website, maps. Use ids exactly as written in brackets.
- openrouter=google/gemma-3-12b-it deep_read: OpenRouter is rate-limiting requests: Provider returned error
- openrouter=google/gemma-3-12b-it pitch: The model's run failed (HTTP 504: Provider timed out after 6003ms).
```

How to read it:
- **gemma-3-12b on OpenRouter (the production model) is incomplete.** OpenRouter rate-limited it after 4 deep reads and 3 pitches ("Provider returned error"), and one pitch hit a host timeout (HTTP 504), so the eval stopped that model. **TODO:** re-run it alone (`npm run eval:models -- --models=openrouter=google/gemma-3-12b-it`) before quoting its numbers.
- **Same model, hosted vs local:** gemma3:12b on Ollama (JSON schema in `format`, same settings) completed 8/8 deep reads and 8/8 pitches, with 63% and 100% grounded on the first try.
- **8 leads is a small sample.** The table says "only 8 saved, asked for 15".
- **Closed-model comparison:** priced on gemma-3-12b's token volume (2,924 in / 249 out per lead): $8.34 per 1,000 leads on Claude Sonnet 5.5 and $11.05 on GPT-5.4, against $0.23 billed for gemma-3-12b on OpenRouter. Prices are from the providers' published pricing pages, checked 2026-10-16. Closed models count tokens with their own tokenizers, so this is approximate.

### Earlier run (gemma3:4b on Ollama, after the reliability changes)

From the first `eval:models` run, as reported in the session (the raw output wasn't saved):

| Call | Success | Grounded first try | Median | p90 |
|---|---|---|---|---|
| deep_read | 100% | 13% | 5.9 s | 11.8 s |
| pitch | 88% | 75% | 3.9 s | 7.1 s |

The low first-try deep-read rate was mostly the "no-website score must be 3+" rule.

## `npm run stats:llm` (all logged calls, local database, 2026-10-16)

These 58 calls span 2026-10-15 to 2026-10-16, so they include calls made **before** the reliability fixes. All are gemma3:4b on Ollama.

```
Model calls: 58  (10/15/2026 – 10/16/2026)

ALL  (58 calls)
  succeeded               55%
  valid JSON, first try   86%
  grounded, first try     31%  (quotes found, no invented numbers)
  needed the retry        67%
  latency                 avg 6.6s · median 5.1s · p95 17.8s
  tokens per call         in 1369 · out 150
  tokens total            in 79380 · out 8679
  failures
    4 × Cite at least one PROBLEM item or review in "evidence_ids": the message must be about a re
    2 × The reply wasn't valid JSON.
    2 × Ollama aborted the reply because it kept repeating itself ({"error":"prediction aborted, t
    1 × Ollama returned HTTP 500: {"error":"prediction aborted, token repeat limit reached"}
    1 × The top_reason "Clients can't assess the apartments’ quality without visual information." 

deep_read · ollama=gemma3:4b  (30 calls)
  succeeded               63%
  valid JSON, first try   100%
  grounded, first try     27%  (quotes found, no invented numbers)
  needed the retry        73%
  latency                 avg 4.5s · median 3.5s · p95 11.6s
  tokens per call         in 1620 · out 89
  tokens total            in 48605 · out 2659
  failures
    2 × Ollama aborted the reply because it kept repeating itself ({"error":"prediction aborted, t
    1 × The top_reason "Clients can't assess the apartments’ quality without visual information." 
    1 × "top_reason" was cut off; keep it under 100 characters.
    1 × "top_reason" is 147 characters; keep it under 100.
    1 × The top_reason "Guests struggle to find information about the guest house due to its lack 

pitch · ollama=gemma3:4b  (28 calls)
  succeeded               46%
  valid JSON, first try   71%
  grounded, first try     36%  (quotes found, no invented numbers)
  needed the retry        61%
  latency                 avg 8.8s · median 6.7s · p95 20.9s
  tokens per call         in 1099 · out 215
  tokens total            in 30775 · out 6020
  failures
    4 × Cite at least one PROBLEM item or review in "evidence_ids": the message must be about a re
    2 × The reply wasn't valid JSON.
    1 × Ollama returned HTTP 500: {"error":"prediction aborted, token repeat limit reached"}
    1 × The compliment "excellent" isn't backed by a PASSED item or a good review you cited. Remov
    1 × The compliment "fantastic" isn't backed by a PASSED item or a good review you cited. Remov
```

**TODO:** a `stats:llm` run on Render (production, OpenRouter) once real users have used it.

## `npm run stats:usage`

On the local database (2026-10-16). The owner's account had just been deleted, and event tracking started only shortly before, so it is all zeros:

```
Usage, excluding 0 account(s)

Users                      0 (0 active)
Sign-ups                   0
Searches run               0
Audits                     0
Leads saved                0
Pitches written            0
Open in WhatsApp clicks    0
Open in email clicks       0
Moved to Replied           0
Moved to Won               0

No events yet. Tracking started when the event table was added.
```

**TODO:** run `npm run stats:usage` on Render (Shell tab) with `STATS_EXCLUDE_EMAILS` set, after the first user has used it.

## Audit accuracy (baseline / after)

**TODO:** no numbers yet. `npm run eval:audit` compares the audit with hand-checked answers in `eval/truth.csv`, but that file has only its header row (`name,url,https,mobile,email_found,whatsapp_found,has_video,site_reachable,what_i_would_pitch`), and no `eval/results-*.json` has been saved.

## Other measured numbers

- **Pitch tests (gemma3:4b, test copy of the database):** about 9/10 pitches passed after the repair step was added. A 10-pitch test of strength-mode pitches (leads with no problems) passed 6/10, before the bracketed-id repair. The remaining failures were genuine rule breaks: more than one compliment, a list of services, no question.
- **SerpApi "people looking for you" tests (3 credits):**
  - `google_jobs` "freelance video editor", Lagos: 10 results, about 2 strong freelance fits plus 2 full-time.
  - Google `"looking for a video editor" Lagos site:linkedin.com`: 10 results, about 5 job listings and 3 competitor profiles.
  - A posts query with OR: Google ignored `site:` and "Lagos"; 2/9 usable.
- **Tokens per lead (gemma3:4b, from `stats:llm`):** deep read about 1,620 in / 89 out per call, pitch about 1,099 in / 215 out per call.
- **Hosting cost (published prices checked 2026-10-16):** Render Starter about $7/month plus 1 GB disk at $0.25/GB/month, so about $7.25/month against a $50 credit. **TODO:** confirm against the first Render invoice.

## Problems we hit and how we fixed them

- **Gemma loops:** Ollama aborted replies with `prediction aborted, token repeat limit reached`.
  - Cause found: since Ollama 0.32.10, repeat_penalty defaults to 1.0 (off).
  - Fix: set every option explicitly (repeat_penalty 1.1, temperature 0.3, num_ctx 8192, num_predict 400).
  - The retry used to echo the broken reply, which primed another loop. It now echoes compact JSON and samples at temperature 0.6.
- **JSON failures:** JSON spilled into sentences (findings ending in `…"},{"`), and evidence ids written inside the pitch text or in brackets (`[check:maps]`).
  - Fix: tidy spilled JSON, strip brackets and inline citations, read spilled ids back out of the text.
  - If the deep read still fails after the retry, keep the parts that pass.
  - A prompt change asking for curly quotes made spills worse and was reverted.
- **Validator strictness:**
  - Pitches were rejected for numbers from the freelancer's own offer or ordinary phrasing ("1 quick question", "a 30-second video"), and for the "1" in an inline `[finding:1]`. Fix: only business numeric claims are checked, and citations are stripped first.
  - A good pitch was rejected for "2021" because the model forgot to cite the item that contained it. Fix: an uncited figure that is in the evidence gets its item auto-cited.
  - "Couldn't write a pitch" on businesses with nothing wrong. Fix: strength-mode pitches.
  - top_reason over 100 characters was rejected. Fix: it now allows 150 and trims at a word boundary instead of rejecting.
- **Things the model did that the prompts didn't fix:**
  - Gemma wrote `<link>` literally or dropped the URL. Fix: the portfolio link is inserted by code.
  - Putting niche and rate in the business pitch made gemma3:4b cite the profile instead of the business's problems, so they were removed from that prompt.
- **Auth:**
  - Step 3 used Google sign-in through Auth.js (`9a2fec9`). In step 5 it was replaced by email + password with JWT sessions (`6de1c22`, `0c8344c`). **TODO:** the reason for the switch isn't recorded in git or notes.
  - Sign-in failures use a per-email backoff (5 failures → 15-minute wait), not a permanent lock.
- **Backboard signup:** the first production plan used Backboard for hosted open models. Backboard turned out not to be available to the owner, so we switched to OpenRouter directly; Backboard was never used in production. **TODO:** what exactly blocked the signup.
- **Render deploy:**
  - The first deploy failed at "Collecting page data" with `ConnectionFailed("Unable to open connection to local database /var/data/leadfinder.db: 14")`.
  - Cause: the database connection opened when the module was imported, `next build` imports every route, and Render doesn't mount the disk during the build.
  - Fix (`2d3ce64`): open the connection on first query. Migrations run at start-up (`scripts/migrate.mjs`) for the same reason.
- **Scripts importing app code:** `eval:models` crashed with `React.createContext is not a function` because importing `lib/dal` pulled in `next/navigation`. Fix: move `rowToLead` into `lib/lead-rows.ts`.
- **PageSpeed quota:** the keyless API returned 429 (daily quota). Fix: PageSpeed is optional and never fails an audit.

## Still not working, not built, or out of scope

- **Not built yet:**
  - "Find people looking for you": the Requests search (build step 8) and the request read / reply pitch (step 9).
  - Demo account for judges.
  - Copying the local database to Render; production starts empty.
  - The **Due today** list in the board header. Cards and the drawer do show overdue reminders.
- **SPEC checks not implemented yet:**
  - crawling up to 5 pages (about, services, booking); only the homepage and contact page are crawled today;
  - booking form, prices listed, online payment (Paystack/Flutterwave);
  - Open Graph link preview, social links, page title / meta description / H1;
  - broken links, images over 1 MB.
- **Known quality issues the checks don't catch:**
  - "online presence" can still appear in pitches; it's banned only in deep-read findings.
  - Wrong praise like "© 2023 – good to see you're keeping things current".
- **Untested:**
  - the OpenRouter provider against a live production deploy;
  - server-action usage events in the browser (the click endpoint and pitch event were tested).
- **PageSpeed without a key:** usually "Couldn't check" (quota).
- **Out of scope:**
  - sending email from the app (mailto links only), bulk sending;
  - Instagram scraping, personal contact enrichment;
  - payments, team accounts;
  - verifying WhatsApp registration.
- **TODO for the post:**
  - time per lead by hand vs with the tool;
  - pitch accuracy (of 20 pitches, how many named a real, checkable problem);
  - first-user results (leads saved, pitches sent, replies);
  - demo video.

## Credit

The type-and-it-becomes-a-card interaction is inspired by [Shapeshift](https://github.com/anishfn/shapeshift) (MIT).

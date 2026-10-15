# Build spec: a lead finder you talk to (Hacktoberfest Week 2: Side Hustle)

Working name: TBD. Drop this file into the repo root and point Claude Code at it.

## The problem

Freelancers in Lagos who sell to local businesses (video editors, web designers, social media managers) find clients one WhatsApp message at a time. Their cold pitches are generic ("Hi, I do websites"), so they get ignored. A good pitch needs a reason: something specific that's wrong with the business's online presence right now. Finding that reason by hand takes 10–15 minutes per business.

## The product in one line

Type "dental clinics in Lekki" and get a list of real businesses, each with a short audit of what's weak about their online presence and a ready-to-send WhatsApp pitch that names the problem.

## First user

My friend, a video editor who gets clients on WhatsApp. Then a web designer and a social media manager if time allows. The freelancer's **offer** ("I edit videos", "I build websites") shapes what the audit looks for and how the pitch reads.

## Partner tools

- **Gemma (featured, $200):** the open-weight brain. Reads audit evidence, decides lead quality, writes the pitch.
- **DigitalOcean (featured, $200):** hosts the app and runs Gemma via Ollama on a droplet (use a 1-Click Model if a GPU droplet is affordable; a quantised small Gemma on CPU otherwise).
- **SerpApi (partner, $100):** finds the businesses. Google Maps engine returns name, category, address, phone, website, rating and review count.
- **.tech domain (partner, $100):** free first year, five minutes of work.

Be honest in the post: SerpApi is a closed paid API. The open part is the thinking — auditing and pitch-writing at volume — which is where the cost would be on a closed model.

## Core interaction (Shapeshift feel)

One text box. After a ~300 ms pause the text goes to Gemma, which classifies intent and pulls fields. The box morphs into the right card.

Intents (keep it to these five):

1. `search` — "salons in Yaba", "restaurants in Ikeja without websites" → **Search card** that shows a skeleton, then fills row by row as results and audits arrive.
2. `audit` — paste a URL or business name → **Audit card**: score, evidence list, pitch.
3. `pitch` — "pitch Smile Dental, shorter, mention weddings" → **Pitch card** with an editable message and a one-tap WhatsApp button.
4. `update` — "Smile Dental replied, interested" → **Status card**; the lead moves to Replied/Interested/Won/Dead.
5. `remind` — "follow up Smile Dental Friday" → **Reminder card**.

Plus `/` to show every card type, like Shapeshift.

**Rule: the model decides, code computes.** Gemma returns intent + raw fields as JSON. Code does the search calls, the website checks, dates (chrono-node) and scoring.

## The audit: code finds facts, Gemma reads them

Deterministic checks (code, fast, cheap):

- No website listed
- Site down or erroring
- No HTTPS
- Not mobile-friendly (no viewport meta tag)
- Slow first load (time it)
- Stale content (old copyright year, last blog post date)
- No clear contact or booking path (no phone link, no WhatsApp link, no form)
- No video on the page (for video-editor offers)
- Weak Maps presence: few reviews, low rating, few photos

Gemma's job: take the evidence + the freelancer's offer and return
`{ score: 1–5, top_reason: string, pitch: string }`.
The pitch must name one specific, checkable problem. No invented facts: every claim in the pitch has to come from the evidence list.

## Pipeline screen

Columns: New → Pitched → Replied → Won / Dead. Each lead card shows the business, the score, the top reason, and the WhatsApp button. Reminders surface at the top.

## WhatsApp

No API. Generate `https://wa.me/<number>?text=<encoded pitch>`. The freelancer always reviews before sending.

Where the number comes from, best first:

1. **WhatsApp confirmed:** the business website links to `wa.me/...` or `api.whatsapp.com/send?phone=...`. Extract that number during the crawl.
2. **Likely WhatsApp:** the Maps phone is a Nigerian mobile number (`070`, `080`, `081`, `090`, `091` / `+234 7|8|9...`).
3. **Call only:** landlines (`01...` and other non-mobile prefixes) get a call button, no WhatsApp button.

Show the label on each lead card. Normalise to international format (`0803...` → `234803...`). Never try to verify WhatsApp registration programmatically; unofficial checks break WhatsApp's terms.

## Ethics and limits (say this in the post)

- Public business information only. No scraping personal emails or private profiles.
- Respect robots.txt; one request per site; rate-limit crawling.
- Messages are sent by the freelancer, one at a time. No bulk blasting.

## Model

- Gemma via Ollama, structured outputs (JSON schema in `format`), validated with zod, retry once on invalid output.
- Two prompts: intent classification (runs as you type) and audit-to-pitch (runs per lead).
- Prompt examples include Pidgin and Lagos place names.

## Stack

Next.js (App Router), TypeScript strict, Tailwind, shadcn/ui, Motion (for the morphing cards), zod, chrono-node, SQLite (Drizzle). Crawl with plain `fetch` + cheerio first; add Playwright only if a key site needs JavaScript rendering.

## Numbers to measure for the post

Writing quality is weighted most heavily, so collect real numbers as you go:

- Time per lead: by hand vs with the tool
- First-try valid JSON rate per intent (target 90%+)
- Median latency: intent classification, and audit-to-pitch
- Cost per 100 leads: Gemma on my droplet vs the same tokens on a closed API
- Pitch accuracy: of 20 pitches, how many named a real, checkable problem
- First user: leads found, pitches sent, replies

## Build order

1. **Cards first, no AI:** text box + five card components with fake JSON. Get the morph animation right.
2. **SerpApi search:** real businesses into the Search card.
3. **Audit checks in code:** run them on 10 real sites, eyeball the results.
4. **Gemma in:** intent classification, then audit-to-pitch. Log valid-JSON rate from day one.
5. **Pipeline + WhatsApp links + reminders.**
6. **Deploy** to DigitalOcean + .tech domain.
7. **First user:** sit with the video editor, run one real search, send real pitches.
8. **Post:** demo video, numbers, first-user story.

## Out of scope this week

Email outreach, bulk sending, Instagram scraping, personal contact enrichment, payments, team accounts.

## Credit

The type-and-it-becomes-a-card interaction is inspired by Shapeshift (MIT, github.com/anishfn/shapeshift). If any code or animation patterns are copied, credit it in the README and the post.

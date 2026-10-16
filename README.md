# leadfinder

A lead finder for freelancers in Lagos who sell to local businesses: video editors, web designers, social media managers. Search for businesses, see what's weak about each one online, save the good ones to a board, and work them from first pitch to won, one WhatsApp message at a time.

Gemma (open-weight) does the thinking: it reads each business's website, judges how good a lead it is for *your* offer, and writes a short pitch where every claim comes from evidence the business owner can check.

## What it does

- **Find:** one text box. Type "salons in Yaba" to search Google Maps (via SerpApi), or a website / business name to audit it.
- **Audit:** code checks the site (down, no HTTPS, not mobile-friendly, stale content, no contact path, no video, weak Google reviews, PageSpeed scores), then Gemma reads the page text and spots what rules can't.
- **Board:** Saved → Pitched → Replied → Won / Lost, with drag-and-drop, notes, reminders and a 3-day follow-up.
- **Evidence-based pitches:** Gemma drafts a 50–125 word message that opens with one checkable problem (or a real strength), cites its evidence, and ends with one question. Pitches with invented facts or numbers are rejected and retried.
- **WhatsApp or email:** "Open in WhatsApp" opens `wa.me` with the pitch filled in; "Open in email" opens your own mail app. You review and send every message yourself.

## Stack

Next.js (App Router), TypeScript, Tailwind, shadcn/ui, Motion, dnd-kit, zod, SQLite with Drizzle, jose (JWT sessions), cheerio. Models run on [Ollama](https://ollama.com) locally or [OpenRouter](https://openrouter.ai) in production. Business data from [SerpApi](https://serpapi.com); page speed from the [PageSpeed Insights API](https://developers.google.com/speed/docs/insights/v5/get-started).

## Run it locally

Requirements: Node 24, and [Ollama](https://ollama.com) with a Gemma model (`ollama pull gemma3:4b`), or an OpenRouter key.

```bash
npm install
# create .env.local first (see below)
npm run db:migrate
npm run dev
```

Open http://localhost:3000 and sign up.

### Environment variables (`.env.local`)

| Variable | Required | What it is |
|---|---|---|
| `AUTH_SECRET` | yes | At least 32 characters, signs sessions: `openssl rand -base64 33` |
| `SERPAPI_API_KEY` | yes | [SerpApi](https://serpapi.com) key for Google Maps search and reviews |
| `LLM_PROVIDER` | no | `ollama` (default) or `openrouter` |
| `LLM_MODEL` | yes | e.g. `gemma3:4b` (Ollama) or `google/gemma-3-12b-it` (OpenRouter) |
| `OLLAMA_URL` | no | Defaults to `http://localhost:11434` |
| `OPENROUTER_API_KEY` | with OpenRouter | [OpenRouter](https://openrouter.ai/keys) key |
| `PAGESPEED_API_KEY` | no | Raises the PageSpeed quota; without it PageSpeed is called keyless and shows "Couldn't check" when the quota runs out |
| `DATABASE_URL` | no | Defaults to `file:./data/leadfinder.db` |
| `STATS_EXCLUDE_EMAILS` | no | Comma-separated accounts left out of `npm run stats:usage` |

Secrets live only in `.env.local` (git-ignored) or your host's environment settings.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run db:migrate` | Apply database migrations |
| `npm run stats:llm` | Valid-JSON rate, grounded rate, tokens and latency from the model log |
| `npm run eval:models` | Run the same saved leads through several models (OpenRouter and Ollama) and compare success rate, latency and cost per 1,000 leads, on a copy of the database |
| `npm run stats:usage` | Sign-ups, searches, leads saved, pitches written, WhatsApp/email clicks, replies and wins (no personal data) |
| `npm run user:password` | Set a user's password from the command line |

## Deploy (Render)

`render.yaml` is a Render Blueprint: one web service plus a 1 GB persistent disk at `/var/data` for the SQLite database. In Render: **New + → Blueprint**, pick this repo, fill in the secret env vars, **Apply**. Migrations run at start-up (`node scripts/migrate.mjs && npm start`).

## Ethics and limits

- Public business information only. No personal emails, private profiles or third-party contact finders.
- Respects robots.txt; one request per site; crawling is rate-limited.
- One message at a time, sent by you. No bulk sending, and the app never sends email itself.

## Credit

The type-and-it-becomes-a-card interaction is inspired by [Shapeshift](https://github.com/anishfn/shapeshift) (MIT).

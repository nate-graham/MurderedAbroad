# Murdered Abroad Support Assistant

A simple Next.js prototype for a charity support assistant. It searches a local demo knowledge base and asks OpenAI to produce calm, practical next-step guidance.

## Local setup

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

Add your API key to `.env.local`:

```bash
OPENAI_API_KEY=your_openai_api_key_here
```

Open `http://localhost:3000`.

## Deploy to Vercel

1. Import this folder as a Vercel project.
2. Set the root directory to this app folder.
3. Add `OPENAI_API_KEY` in Project Settings > Environment Variables.
4. Deploy with the default Next.js settings.

## Production checklist

The app has no accounts, so anyone who can reach it can make it call OpenAI. Rate and cost
limits are applied at the platform, not in application code: an in-memory limiter would
reset on every cold start and is not shared across Vercel instances, so it would not
reliably protect anything.

Built into the app:

- Request bodies over 32 KiB get HTTP 413 before they are parsed, and non-JSON requests get HTTP 415.
- OpenAI calls are aborted after 20 seconds, and OpenAI responses over 64 KiB are rejected.
- Every API response is sent with `Cache-Control: no-store`.
- Security headers are set in `next.config.ts`.
- Setting `CHAT_GENERATION_DISABLED=true` stops all OpenAI calls. Crisis signposting and
  the fixed fallback answer keep working.

To configure manually before launch:

1. **Vercel Firewall rate limit.** In Project > Firewall, add a custom rule for requests to
   `/api/chat` with method `POST`. Use a fixed-window rate limit keyed on IP, for example
   10 requests per 60 seconds, with the action set to deny (HTTP 429). Check which plan
   features are available, and review blocked traffic after launch.
2. **OpenAI cost containment.** A monitoring budget or alert on its own is not sufficient
   cost containment: it reports spend but does not stop it. Before public launch:
   - Use a dedicated OpenAI project for Murdered Abroad, not shared with other apps.
   - Use a server-side production API key belonging to that project, set only in Vercel
     environment variables and never exposed to the browser. Restrict it to the Chat
     Completions endpoint and the configured model where the dashboard allows it.
   - Set a project-specific hard spend limit, with enforcement enabled where available,
     so requests are refused once the limit is reached.
   - Set alerts below the hard limit (for example at 50% and 80%) and at the limit.
   - Verify before launch that the limit is actually enforced for this account and
     project, for example by checking the project's limit settings and OpenAI's current
     documentation for the account type.
   - If an enforced hard spend limit is not available for the account or project,
     establish an alternative enforced containment measure before public launch, for
     example a prepaid balance with auto-recharge disabled. Alerts alone do not qualify.
3. **Environment variables.** Set `OPENAI_API_KEY` and `OPENAI_MODEL` for Production and
   Preview. Leave `CHAT_GENERATION_DISABLED` unset, and set it to `true` only to stop
   generation, for example during a cost spike or abuse. Redeploy after changing it.
4. **Content-Security-Policy.** The full policy is sent as
   `Content-Security-Policy-Report-Only`. After deploying, open the site and send a
   question with the browser console open. If no CSP violations are reported, change that
   header name to `Content-Security-Policy` in `next.config.ts`. `frame-ancestors`,
   `object-src`, `base-uri` and `form-action` are already enforced.
5. **HSTS.** `Strict-Transport-Security: max-age=63072000` is sent in production for this
   host only. Add `includeSubDomains` or `preload` only if the domain owner agrees.
6. **Function duration.** `/api/chat` sets `maxDuration = 30`. Check this is within the
   plan's limit.

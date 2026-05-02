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

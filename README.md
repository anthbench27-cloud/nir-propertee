# NIR PROPERTEE — standalone deployment

This is the standalone, no-sign-up version of the listing generator. Anyone
who opens the deployed link can use it — no Claude account required. Your
Anthropic API key stays server-side, never exposed to visitors' browsers.

## Deploy in 5 minutes (Vercel — free tier works)

1. **Get an Anthropic API key** (if you don't already have one)
   - Go to https://console.anthropic.com
   - Create an account, go to "API Keys," create a new key
   - Note: this is billed separately from your Claude.ai subscription —
     API usage costs per request. Check current pricing at
     https://docs.claude.com

2. **Push this folder to a GitHub repo**
   - Create a new repo on GitHub
   - Upload all files in this folder (keep the structure: `api/`, `src/`,
     `index.html`, `package.json`, `vite.config.js`)

3. **Import into Vercel**
   - Go to https://vercel.com, sign up/log in (free)
   - Click "Add New" → "Project" → import your GitHub repo
   - Vercel auto-detects Vite — leave build settings as default

4. **Add your API key as an environment variable**
   - In the Vercel project settings → "Environment Variables"
   - Add: `ANTHROPIC_API_KEY` = `your-key-here`
   - Redeploy if you added it after the first deploy

5. **Deploy**
   - Click Deploy — Vercel gives you a live URL like
     `nir-propertee.vercel.app`
   - That's your shareable link. Optionally connect a custom domain in
     Vercel's project settings.

## What changed from the Claude artifact version

- **API calls** now go through `/api/generate` (a serverless function in
  `api/generate.js`) instead of directly to Anthropic. The API key lives
  only in Vercel's environment variables, never in the browser.
- **History storage** now uses the browser's `localStorage` instead of
  Claude's artifact storage. This means history is per-browser/per-device,
  not synced across devices. If you want real cross-device history, swap
  the `storage` shim in `src/App.jsx` for a real database (Supabase is a
  good free option) — happy to help with that if you get there.
- **Media (photos/video) previews** stay session-only either way, since
  they were never persisted.

## Costs to know about

- Vercel free tier covers light traffic comfortably.
- Anthropic API usage is pay-per-request — if this gets shared widely,
  monitor usage in the Anthropic console so costs don't surprise you.
  Consider adding a rate limit if it starts getting heavy traffic.

## Local testing before deploying

```
npm install
npm run dev
```

Note: the `/api/generate` route only works when deployed to Vercel (or
run via `vercel dev` locally with the Vercel CLI) — a plain `vite dev`
server won't serve the serverless function.

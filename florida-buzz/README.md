# The Florida Buzz — Setup Guide

This works the same way as Villages Golf Cart Trader: paste these files into a new GitHub repo,
connect it to a new DigitalOcean App, set environment variables, deploy. No local installs needed.

## What's built and working right now
- The full website (homepage, 8 category pages, article pages) — renders with sample articles
  even before any setup, so you can see the design immediately.
- The automation pipeline (`scripts/automate.js`) — pulls RSS, writes articles with Claude,
  saves to Supabase, posts to Facebook. Tested for logic, but the RSS feeds themselves need
  verification on your end (see Step 4) since my sandbox can't reach external news sites.

## What's NOT built yet (intentionally, to keep this v1 manageable)
- AI-generated featured images — currently using generic placeholder images by category.
  I can add this once everything else is confirmed working; it needs an image-gen API.
- Instagram, Threads, X, Pinterest auto-posting — Facebook is wired up first since it's the
  one Make.com flow ChatGPT's plan emphasized most, and each additional platform needs its
  own developer app/credentials. Same pattern, I can add them one at a time once Facebook works.
- Email newsletter sending — the signup form saves nothing yet, it just logs to console.
- Google Ads / Ezoic ad code — add once you have real traffic.

---

## Step 1: Create the GitHub repo
1. Go to github.com, create a new repo, e.g. `florida-buzz`.
2. Upload all these files (drag the whole folder onto the GitHub upload page, or use GitHub
   Desktop if you have it — same as your other projects).

## Step 2: Create a NEW Supabase project
Don't reuse the villagesgolfcarttrader Supabase project — keep these separate.
1. supabase.com → New Project → name it `florida-buzz`.
2. Once created, go to SQL Editor → paste in the contents of `db/schema.sql` → Run.
3. Go to Project Settings → API → copy the **Project URL** and the **service_role key**
   (not the anon key — the automation needs write access).

## Step 3: Get an Anthropic API key
This is separate from your claude.ai subscription — it's pay-per-use.
1. console.anthropic.com → API Keys → Create Key.
2. Add a small starting credit balance ($10–20 to start; each article costs a fraction of a cent
   to a few cents depending on length, so even daily posting stays well under $20–30/month
   matching the original budget estimate).

## Step 4: Verify the RSS feeds (do this before turning on live posting)
Some of the feed URLs in `scripts/sources.js` are marked unverified — I wrote them from the
most likely official path but couldn't confirm they resolve from my end. Once deployed:
1. Set `DRY_RUN=true` in your environment variables.
2. Run the automation once (DigitalOcean → Console → `npm run automate:dry`).
3. Check the output — any feed that errors or returns 0 items needs a fix. Usually means
   visiting the source's website and finding their current RSS link (or removing it if they
   don't have one).
4. For Disney Parks Blog / Universal Orlando Blog / cruise line news (no public RSS), use a
   feed-generator like RSS.app or FetchRSS pointed at their blog page, then add that URL to
   `sources.js`.

## Step 5: Set up Facebook auto-posting
1. Create a Facebook Page for The Florida Buzz (separate from your personal account and
   separate from the Cartzilla account — do not touch that one).
2. developers.facebook.com → Create App → type "Business".
3. Add the "Pages" product, generate a Page Access Token with `pages_manage_posts` and
   `pages_read_engagement` permissions, and convert it to a long-lived token (Facebook's
   token debugger tool will show you how — tokens normally expire in 60 days, so you'll
   need to refresh this periodically, or set up a System User token for one that doesn't expire).
4. Copy your Page ID and the access token into the environment variables.

## Step 6: Deploy to DigitalOcean
1. Same process as Villages Golf Cart Trader: DigitalOcean → Apps → Create App → connect
   the new GitHub repo.
2. Build command: `npm install`. Run command: `npm start`.
3. Add all the environment variables from `.env.example` (filled in with your real values)
   in the App's Settings → Environment Variables.
4. Deploy. The site goes live; automation runs on its own schedule (6am/11am/3pm/7pm) once
   `ANTHROPIC_API_KEY` is set — adjust the schedule in `server.js` if you want a different cadence.

## Step 7: Point your domain
1. Register thefloridabuzz.com (or your final choice) — Namecheap or Cloudflare Registrar
   are both reasonable, similar to how villagesgolfcarttrader.com is set up through Wix DNS.
2. Point the domain's DNS to the DigitalOcean app, same pattern as your other sites.

---

## Costs (matches the original estimate)
- Domain: ~$15/year
- DigitalOcean App: ~$5–12/month (similar tier to your existing apps)
- Supabase: free tier covers this easily at the start
- Anthropic API: likely $10–30/month at 4 articles/day
- **No Make.com needed** — the automation is built directly into this app, so that's one
  fewer subscription than the original plan.

## Monetization — recommended order
1. Apply to **Ezoic** (no traffic minimum) once the site has any real visitors — better
   payouts than starting with Google AdSense.
2. Add affiliate links: Viator/GetYourGuide/Klook (tours & tickets), Booking.com (hotels),
   Amazon Associates (travel gear). Official Disney/Universal ticket affiliate programs are
   generally closed to small sites, so don't count on those early.
3. Build Pinterest from week one, not later — it converts unusually well for this niche.
4. Once you're getting steady traffic, look at Mediavine or Raptive (much better ad rates
   than Ezoic, but they have minimum traffic requirements, usually ~50k sessions/month).
5. A simple weekly newsletter with a sponsor slot can monetize even at a small list size.

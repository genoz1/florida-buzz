# Indexing incident — deployment checklist (awaiting approval)

## Audit results (pre-commit)
- [x] Four failing suite tests also fail on `origin/main` (unrelated)
- [x] Live sitemap build: 3709/3709 indexable articles; `/guides` present; 0 missing
- [x] Supabase outage on real routes → 503 only (article/category/guides/home); never 404/demo
- [x] Category pagination: page 1 URL unchanged; `/page/2` works; `/page/1` → 301 to base
- [x] Automate/Buzz Board/podcasts: no core lib changes; publishing path intact; targeted tests 107/108 (1 pre-existing fail)
- [x] Duplicate report generated (report-only)

## Deploy steps (do NOT run until approved)
1. Merge/push `cursor/indexing-incident-fix-d8ad` (or open PR) when approved.
2. Deploy DigitalOcean `hammerhead-app` from the merged commit (manual).
3. Smoke:
   - known article → 200
   - nonsense slug → 404
   - `/sitemap.xml` → sitemapindex; includes `/guides`
   - `www.thefloridabuzz.com/...` → 301 apex
4. Search Console sitemap refresh / selective reindex (human).
5. Review duplicate-content report before any redirects.

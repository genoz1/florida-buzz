# Florida Buzz indexing incident — recovery notes

## What broke
Transient Supabase/query failures were treated like “no rows,” so real article URLs returned **404**. Googlebot could drop those URLs. Sitemap generation also capped at **1,000** articles and omitted `/guides`.

## Status contract (articles)

| Outcome | HTTP | Notes |
|---|---|---|
| Query succeeds, slug exists | **200** | Normal article page + NewsArticle JSON-LD |
| Query succeeds, slug missing | **404** | Genuine not found |
| Query/auth/network failure after retries | **503** | `Retry-After: 300`, `Cache-Control: no-store`, `unavailable` template, **no** article JSON-LD |

Sample/demo articles are **never** rendered on production-like hosts (`NODE_ENV=production` or `SITE_URL` containing `thefloridabuzz.com`).

## Sitemap
- `/sitemap.xml` — sitemap **index**
- `/sitemap-static.xml` — static pages (includes `/guides`) + podcast URLs
- `/sitemap-articles-N.xml` — paginated article segments (500/URL set)
- Fresh build failure → **503** unless a last-known-good cache exists (`X-Sitemap-Stale: 1`)

## Canonical host
Early middleware 301s `www.thefloridabuzz.com/*` → `https://thefloridabuzz.com/*` (path + query preserved, one hop).

Disable only if needed: `CANONICAL_HOST_REDIRECT=false`.

## Observability
Structured JSON logs (no secrets):

- `type=not_found` — genuine 404s (`routeType`, `slug`)
- `type=upstream_failure` — 503s (`errorCategory`, truncated message)
- `type=upstream_retry` — per-attempt Supabase retries

In-process counters: `getObservabilitySnapshot()` in `lib/requestObservability.js` tracks article 404/503 counts and sitemap URL-count deltas.

### Inspecting Googlebot in production logs
1. DigitalOcean → App Platform → `hammerhead-app` → Runtime Logs.
2. Filter for `Googlebot` user-agent (if your log drain includes request lines) **or** filter JSON fields:
   - `"routeType":"article"` + `"status":404`
   - `"routeType":"article"` + `"status":503`
   - `"routeType":"sitemap"`
3. Compare spikes: many **503** → upstream/DB; many **404** on previously valid slugs → redirects/duplicates/content removal, not DB outage.
4. Confirm live headers without changing DNS:
   ```bash
   curl -sI 'https://thefloridabuzz.com/article/<known-slug>'
   curl -sI -H 'Host: www.thefloridabuzz.com' 'https://thefloridabuzz.com/article/<known-slug>'
   curl -sI 'https://thefloridabuzz.com/sitemap.xml'
   ```

## Duplicate content report (no deletes)
```bash
node scripts/duplicate-content-report.js --out /tmp/fb-duplicate-report.json
```
Reports numbered suffixes, machine/placeholder slugs, and near-identical title/dek pairs. Does **not** delete or redirect.

## Deployment checklist (manual — do not auto-deploy)
1. Run `npm test` (includes `test/indexingIncident.test.js`).
2. Deploy this branch to DigitalOcean when ready (human-triggered).
3. Verify one known article returns **200**, a nonsense slug **404**, and (optional chaos) DB outage path **503**.
4. Fetch `/sitemap.xml` and confirm index + `/guides` + article count ≫ 1000 if inventory warrants.
5. Confirm `www` → apex 301.
6. In Search Console later (human): validate fix / request reindexing for key URLs — **not** done by the agent.
7. Optional: run duplicate-content report and review before any redirects.

## Migration risks
- Homepage/category/city now **503** on DB outage instead of showing sample cards (intentional).
- Sitemap URL changes from a single urlset to a sitemap **index** — update Search Console sitemap entry if it pointed only at the old flat file (same `/sitemap.xml` path still works).
- Category/city archives paginate at 24; page 2+ uses `/category/:cat/page/N` crawlable links.
- `insufficient-source-material` is noindexed and excluded from sitemaps; automate refuses to publish that placeholder again.

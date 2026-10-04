# Buzz Board launch inventory review

This Phase 4 artifact records the editorial and factual review behind the
private staging launch inventory. It does not authorize production use.

## Editorial process

- 60 candidates were written in one controlled batch: 30 Disney, 17
  Universal, 7 Cruises, and 6 Florida Life.
- Each candidate received ten 1–5 scores: conversation potential,
  disagreement potential, specificity, clarity, originality, audience
  relevance, substantive-response likelihood, factual safety, evergreen
  durability, and structural diversity.
- The deterministic builder selected the highest totals inside the exact
  18/10/4/4 category quotas, then enforced unique IDs/slugs/questions,
  metadata limits, topic diversity, varied openings, a semantic-similarity
  ceiling, and factual-safety/evergreen minimums.
- The approved score range is 48–50 out of 50. The closest selected semantic
  pair is only 0.222 Jaccard similarity, well below the 0.58 rejection gate.
- 32 of 36 approved discussions use short neutral context paragraphs. Four
  are stronger without context.

## Factual-premise review

The inventory deliberately favors evergreen opinion and planning tradeoffs.
It contains no prices, dates, operating hours, opening promises, closure
claims, or claims about unannounced projects.

The small set of named current Universal products was checked against
first-party Universal Orlando sources on October 3, 2026:

- [Epic Universe](https://www.universalorlando.com/web/en/us/theme-parks/epic-universe)
  is an operating Universal Orlando theme park.
- [Universal Express](https://www.universalorlando.com/web/en/us/tickets-packages/express-passes/)
  remains an offered line-access product.
- [Park-to-Park tickets](https://www.universalorlando.com/web/en/us/tickets-packages/park-tickets)
  remain an offered ticket type.
- [Universal CityWalk dining](https://www.universalorlando.com/web/en/us/plan-your-visit/dining-experiences/reservations)
  remains a current guest option.

The questions make no factual claims about the quality or popularity of those
products. They ask readers to evaluate their own experience. Other premises,
such as whether a park feels like a half-day park or whether screens are used
too heavily, are explicitly framed as perceptions for discussion rather than
facts.

## Honest launch state

The generated data migration inserts only discussion metadata through an
active admin identity. It does not insert responses, replies, reactions,
reports, impressions, users, counts, historical timestamps, or popularity
labels. Database defaults and the Phase 3 triggers preserve genuine insertion
and activity times and zero engagement counts.

## Future member-created discussions

No Phase 4 behavior enables member-created discussions. The existing schema
already records creator identity, source type, category, status, and moderation
state, so no zero-behavior schema change is necessary now.

The smallest safe future path is:

1. Add a separate authenticated member endpoint; keep the admin endpoint and
   database starter guard unchanged until the new path is explicitly approved.
2. Require an active verified profile, CSRF, Turnstile where appropriate, and
   tighter per-user/IP/database-backed limits than response posting.
3. Validate category, title length, plain text, and no links/contact details.
4. Compare normalized title/topic fingerprints against recent and active
   discussions before accepting a submission.
5. Write member submissions with `source_type = 'member'` and `status = 'draft'`
   or held-first for new accounts; publish only after deterministic checks and,
   where required, staff approval.
6. Extend RLS/trigger authorization narrowly for that explicit workflow rather
   than weakening the Florida Buzz admin starter invariant.
7. Add abuse reporting, moderator audit actions, account-age/burst controls,
   and tests before exposing a “Start a Discussion” control.

This future work requires a migration because the current `source_type` check
allows only `florida_buzz` and `article`. Deferring that additive enum/check
change avoids creating unused behavior in Phase 4 and does not create a future
migration problem.

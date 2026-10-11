'use strict';

const { DISNEY_SHOW_SLUG } = require('./config');
const {
  weekKeyEt,
  matchesGenerateSlot,
  matchingGenerateSlot,
  partsInTimezone,
  nextUpcomingWeekday,
  WEEKDAY_NAMES,
} = require('./timeEt');
const { collectWeeklySources } = require('./sourceCollector');
const { generateOutline, generateConversation } = require('./script');
const { ensureShowNotesDisclosures, AFFILIATION_DISCLOSURE } = require('./hosts');
const { buildResourcesMentionedHtml, trackedSiteUrl } = require('./siteResources');
const { notifyDraftReady } = require('./notify');
const { slugify } = require('./validation');
const {
  PARTNER_NAME,
  partnerDescriptionBlurb,
  partnerShowNotesHtml,
} = require('../affiliates/undercoverTourist');

/** Standalone weekly shows — not halves of one episode. Default: Tuesday + Friday 6:00 AM ET. */
const DEFAULT_RELEASE_SLOTS = [
  { key: 'tue', weekday: 2, hour: 6, minute: 0, label: 'Tuesday' },
  { key: 'fri', weekday: 5, hour: 6, minute: 0, label: 'Friday' },
];

function defaultSettings(showSlug = DISNEY_SHOW_SLUG) {
  return {
    show_slug: showSlug,
    weekly_draft_enabled: false,
    timezone: 'America/New_York',
    // Create one episode on Tuesday and one on Friday (separate runs).
    generate_weekday: 2,
    generate_hour: 7,
    generate_minute: 0,
    generate_weekday_b: 5,
    generate_hour_b: 7,
    generate_minute_b: 0,
    // Intended public release times — intent only; auto_publish stays off.
    intended_publish_weekday: 2,
    intended_publish_hour: 6,
    intended_publish_minute: 0,
    intended_publish_weekday_b: 5,
    intended_publish_hour_b: 6,
    intended_publish_minute_b: 0,
    auto_publish_enabled: false,
    notify_email: null,
  };
}

/** Configured Tuesday + Friday release slots (definitions only — one used per run). */
function releaseSlotsFromSettings(settings = {}) {
  const a = {
    key: 'tue',
    index: 0,
    weekday: Number(settings.intended_publish_weekday ?? DEFAULT_RELEASE_SLOTS[0].weekday),
    hour: Number(settings.intended_publish_hour ?? DEFAULT_RELEASE_SLOTS[0].hour),
    minute: Number(settings.intended_publish_minute ?? DEFAULT_RELEASE_SLOTS[0].minute),
  };
  const b = {
    key: 'fri',
    index: 1,
    weekday: Number(settings.intended_publish_weekday_b ?? DEFAULT_RELEASE_SLOTS[1].weekday),
    hour: Number(settings.intended_publish_hour_b ?? DEFAULT_RELEASE_SLOTS[1].hour),
    minute: Number(settings.intended_publish_minute_b ?? DEFAULT_RELEASE_SLOTS[1].minute),
  };
  return [a, b].map((slot) => ({
    ...slot,
    label: WEEKDAY_NAMES[slot.weekday] || 'Release day',
  }));
}

/**
 * Pick exactly one release slot for this run.
 * - Cron: matching generate window (Tue or Fri)
 * - Force: today's slot if Tue/Fri, else next upcoming
 * - Explicit / reject: use provided or prior episode slot
 */
function selectReleaseSlotForRun({
  settings,
  now = new Date(),
  force = false,
  releaseSlotKey = null,
  rejectEpisode = null,
} = {}) {
  const slots = releaseSlotsFromSettings(settings);
  const tz = settings.timezone || 'America/New_York';

  const byKey = (key) => {
    if (!key) return null;
    const normalized = String(key).replace(/^gen-/, '');
    return (
      slots.find((s) => s.key === key || s.key === normalized) ||
      slots.find((s) => String(key).startsWith(s.key)) ||
      null
    );
  };

  if (releaseSlotKey) {
    const found = byKey(releaseSlotKey);
    if (found) return { slot: found, targetDate: now, reason: 'explicit' };
  }

  if (rejectEpisode) {
    const fromJson = rejectEpisode.outline_json?.release_slot;
    const fromWeekday =
      rejectEpisode.intended_publish_weekday != null
        ? slots.find((s) => s.weekday === Number(rejectEpisode.intended_publish_weekday))
        : null;
    const found = byKey(fromJson) || fromWeekday;
    if (found) return { slot: found, targetDate: now, reason: 'reject' };
  }

  const gen = matchingGenerateSlot(settings, now);
  if (gen) {
    const found =
      slots.find((s) => s.weekday === Number(gen.weekday)) || slots[gen.index] || slots[0];
    return { slot: found, targetDate: now, reason: 'generate_slot' };
  }

  if (force) {
    const parts = partsInTimezone(now, tz);
    const today = slots.find((s) => s.weekday === parts.weekday);
    if (today) return { slot: today, targetDate: now, reason: 'force_today' };
    const upcoming = nextUpcomingWeekday(
      now,
      slots.map((s) => s.weekday),
      tz
    );
    const slot = slots.find((s) => s.weekday === upcoming.weekday) || slots[0];
    return { slot, targetDate: upcoming.targetDate, reason: 'force_next' };
  }

  return null;
}

function episodeMatchesReleaseSlot(episode, slotKey) {
  if (!episode || !slotKey) return false;
  if (episode.outline_json?.release_slot === slotKey) return true;
  if (typeof episode.slug === 'string' && episode.slug.endsWith(`-${slotKey}`)) return true;
  return false;
}

async function findEpisodeForReleaseSlot(store, showId, weekKey, slotKey) {
  const episodes = await store.listEpisodes(showId);
  return (
    episodes.find(
      (ep) => ep.week_key === weekKey && episodeMatchesReleaseSlot(ep, slotKey)
    ) || null
  );
}

function buildShowNotesHtml({ episodeTitle, sources, site, episode = {} }) {
  const articles = sources.filter((s) => s.source_kind === 'article' && s.included !== false);
  const guides = sources.filter((s) => s.source_kind === 'guide' && s.included !== false);
  const buzz = sources.filter((s) => s.source_kind === 'buzz_board' && s.included !== false);
  const evergreen = sources.filter((s) => s.source_kind === 'evergreen_topic' && s.included !== false);
  const epMeta = { slug: episode.slug, week_key: episode.week_key };

  const linkList = (items) =>
    items.length
      ? `<ul>${items
          .map((s) => {
            const href = trackedSiteUrl(s.url, site, epMeta);
            return `<li><a href="${escape(href)}">${escape(s.title)}</a></li>`;
          })
          .join('')}</ul>`
      : '<p>None selected for this draft.</p>';

  const resourcesHtml = buildResourcesMentionedHtml({ sources, site, episode: epMeta });
  const buzzHome = trackedSiteUrl('/buzz', site, epMeta);

  const html = `
<p>${escape(episodeTitle)} — a Florida Buzz: Disney episode hosted by Geno.</p>
<p>Facts about prices, policies, hours, attraction status, and wait times are drawn only from the approved Florida Buzz sources linked below.</p>
<h2>Florida Buzz Resources Mentioned</h2>
<p>Direct links to every article, guide, tool, and Buzz Board discussion referenced for this episode (with podcast tracking parameters):</p>
${resourcesHtml}
<h2>This week’s Florida Buzz articles</h2>
${linkList(articles)}
<h2>Guides &amp; planning references</h2>
${linkList(guides)}
<h2>Buzz Board questions we discuss</h2>
${linkList(buzz)}
<p>Have a take? Visit the <a href="${escape(buzzHome)}">Buzz Board</a> and add your answer.</p>
<h2>Evergreen discussion</h2>
${linkList(evergreen)}
${partnerShowNotesHtml()}
<p>${AFFILIATION_DISCLOSURE}</p>
`.trim();
  return ensureShowNotesDisclosures(html);
}

function withPartnerDescription(description, env = process.env) {
  const base = String(description || '').trim();
  if (/Undercover Tourist/i.test(base)) return base.slice(0, 4000);
  const blurb = partnerDescriptionBlurb(env);
  const joined = base ? `${base} ${blurb}` : blurb;
  return joined.slice(0, 4000);
}

function escape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function episodesPerWeek(env = process.env) {
  const n = Number(env.PODCASTS_EPISODES_PER_WEEK || 2);
  return Number.isInteger(n) && n >= 1 && n <= 4 ? n : 2;
}

/** Split weekly sources across N independent ~20–25 minute episodes (different release days). */
function splitSourcesForEpisodes(sources, episodeCount) {
  const list = Array.isArray(sources) ? sources.slice() : [];
  const articles = list.filter((s) => s.source_kind === 'article');
  const guides = list.filter((s) => s.source_kind === 'guide');
  const buzz = list.filter((s) => s.source_kind === 'buzz_board');
  const evergreen = list.filter((s) => s.source_kind === 'evergreen_topic');
  const other = list.filter(
    (s) => !['article', 'guide', 'buzz_board', 'evergreen_topic'].includes(s.source_kind)
  );
  const buckets = Array.from({ length: episodeCount }, () => []);

  const distribute = (items) => {
    items.forEach((item, index) => {
      buckets[index % episodeCount].push(item);
    });
  };
  distribute(articles);
  distribute(guides);
  distribute(buzz);
  // Give each episode at least one evergreen angle when available.
  if (evergreen.length) {
    for (let i = 0; i < episodeCount; i += 1) {
      buckets[i].push(evergreen[i % evergreen.length]);
    }
  }
  distribute(other);

  // Avoid empty episodes — borrow from the fullest bucket.
  for (let i = 0; i < episodeCount; i += 1) {
    if (buckets[i].length) continue;
    const donor = buckets.reduce((best, cur) => (cur.length > best.length ? cur : best), buckets[0]);
    if (donor.length > 1) buckets[i].push(donor.pop());
  }
  return buckets;
}

function stripPartLabels(text) {
  return String(text || '')
    .replace(/\s*[\(\[]?\s*part\s*\d+\s*(?:of\s*\d+)?[\)\]]?/gi, '')
    .replace(/\bpart\s*(?:one|two|three|four)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function buildEpisodeCopy({ aiText, weekKey, collection, releaseSlot }) {
  const slot = releaseSlot || DEFAULT_RELEASE_SLOTS[0];
  const articleTitles = collection.sources
    .filter((s) => s.source_kind === 'article')
    .map((s) => s.title)
    .slice(0, 6);
  const focusHint = articleTitles[0]
    ? articleTitles[0].slice(0, 48)
    : `${slot.label} planning talk & park opinions`;
  const fallbackTitle = `Florida Buzz: Disney — ${focusHint}`;
  const fallbackDescription = `Standalone ${slot.label} episode: Geno covers Florida Buzz Disney news with quick hits, one deep dive, and planning tips from The Florida Buzz. Visit https://thefloridabuzz.com. Unofficial fan podcast.`;

  if (!aiText) {
    return {
      title: stripPartLabels(fallbackTitle).slice(0, 200),
      description: withPartnerDescription(stripPartLabels(fallbackDescription)),
      release_slot: slot.key,
      release_label: slot.label,
    };
  }

  const prompt = {
    system: `You write concise podcast packaging for Florida Buzz: Disney.
Return plain text with two lines only:
TITLE: ...
DESCRIPTION: ...
Rules: title under 80 chars; description under 320 chars; solo host Geno (never dual-host Gena/Diane packaging); no Disney affiliation claims; do not invent news facts.
This is a standalone ~20–25 minute weekly episode intended for ${slot.label} release — not "Part 1/Part 2" of another show.
Never use the words "Part 1", "Part 2", "part of", or similar multi-part episode language in the title or description.
Give this episode its own distinct title based on its focus sources (different from other episodes this week).`,
    user: `Week key: ${weekKey}
Intended publish day: ${slot.label}
Focus source titles for THIS episode only: ${articleTitles.join(' | ') || '(none — evergreen/Buzz Board heavy episode)'}
Buzz Board topics: ${collection.sources
      .filter((s) => s.source_kind === 'buzz_board')
      .map((s) => s.title)
      .join(' | ') || '(none)'}
Evergreen topic: ${collection.sources.find((s) => s.source_kind === 'evergreen_topic')?.title || ''}`,
  };

  try {
    // Florida Buzz aiText.generateText(system, user, maxTokens) — positional args only.
    const text = String(await aiText.generateText(prompt.system, prompt.user, 300));
    const title = stripPartLabels((text.match(/TITLE:\s*(.+)/i) || [])[1]?.trim() || fallbackTitle);
    const description = stripPartLabels(
      (text.match(/DESCRIPTION:\s*(.+)/i) || [])[1]?.trim() || fallbackDescription
    );
    return {
      title: title.slice(0, 200),
      description: withPartnerDescription(description),
      release_slot: slot.key,
      release_label: slot.label,
    };
  } catch (err) {
    console.warn('[podcasts] packaging AI failed, using fallback:', err.message);
    return {
      title: stripPartLabels(fallbackTitle).slice(0, 200),
      description: withPartnerDescription(stripPartLabels(fallbackDescription)),
      release_slot: slot.key,
      release_label: slot.label,
    };
  }
}

function buildFallbackOutline({ weekKey, sources, copy }) {
  const lines = [`Week ${weekKey}: ${copy.title}`, 'Segments:'];
  const byKind = (kind) => sources.filter((s) => s.source_kind === kind && s.included !== false);
  byKind('article').slice(0, 5).forEach((s, i) => lines.push(`${i + 1}. Article — ${s.title}`));
  byKind('guide').slice(0, 3).forEach((s) => lines.push(`Guide — ${s.title}`));
  byKind('buzz_board').slice(0, 3).forEach((s) => lines.push(`Buzz Board — ${s.title}`));
  byKind('evergreen_topic').slice(0, 1).forEach((s) => lines.push(`Evergreen — ${s.title}`));
  lines.push(`Partner mid-roll: short ${PARTNER_NAME} mention — tickets/hotels, partner disclosure, link in show notes.`);
  lines.push(`Close with Florida Buzz site CTAs (dining guide, wait times, day planner, Buzz Board) plus soft ${PARTNER_NAME} show-notes reminder.`);
  return lines.join('\n');
}

function buildFallbackScript({ weekKey, sources, copy }) {
  const articles = sources.filter((s) => s.source_kind === 'article' && s.included !== false).slice(0, 4);
  const guides = sources.filter((s) => s.source_kind === 'guide' && s.included !== false).slice(0, 2);
  const buzz = sources.filter((s) => s.source_kind === 'buzz_board' && s.included !== false).slice(0, 2);
  const evergreen = sources.find((s) => s.source_kind === 'evergreen_topic' && s.included !== false);
  const turns = [];
  turns.push(
    `Geno: [excited] Welcome to Florida Buzz: Disney. I'm Geno — your unofficial fan host bringing park news and real planning from The Florida Buzz. Not affiliated with Disney — just a fan who lives this stuff. Today we're locking in that park-day energy and cutting through the noise. Let's go.`
  );
  turns.push(`Geno: This week’s draft focus is ${copy.title}. Quick hits first, then one deeper dive.`);
  turns.push('Geno: Exact facts still come from The Florida Buzz — articles, guides, and the Buzz Board.');
  articles.forEach((s) => {
    turns.push(`Geno: Quick hit — The Florida Buzz covered “${s.title}.” Here’s the planning take I’m watching.`);
  });
  turns.push(
    `Geno: [conversational] Quick pause — if you're planning a Disney trip, check our partner ${PARTNER_NAME} for tickets and hotel deals. Link's in the show notes; booking there helps support the show.`
  );
  guides.forEach((s) => {
    turns.push(`Geno: For planning, I’d point people to the Florida Buzz guide on “${s.title}.” That’s the kind of thing I actually use before we leave the house.`);
  });
  buzz.forEach((s) => {
    turns.push(`Geno: Over on the Buzz Board, people were talking about “${s.title}.” I’ve got a take — and you should add yours on The Florida Buzz dot com.`);
  });
  if (evergreen) {
    turns.push(`Geno: Deep dive / evergreen: ${evergreen.title}. Dining guide, wait times, day planner, Buzz Board — go use them.`);
  }
  turns.push(
    'Geno: That’s our week-of scaffold for review. Once AI packaging expands this into the full solo cut, we’ll keep the same energy.'
  );
  turns.push(
    `Geno: [warmly] Reminder — ${PARTNER_NAME} partner link is in the show notes if you need tickets or hotels. And grab the dining guide, wait times, day planner, and Buzz Board at The Florida Buzz dot com.`
  );
  turns.push(`Geno: Draft week key ${weekKey} — not for publication until approved.`);
  return turns.join('\n\n');
}

async function createWeeklyDraft({
  store,
  supabase,
  cfg,
  aiText,
  pipeline,
  sendEmail,
  env = process.env,
  now = new Date(),
  force = false,
  weekKey: forcedWeekKey = null,
  rejectEpisodeId = null,
  releaseSlotKey = null,
} = {}) {
  const show = await store.getShow(DISNEY_SHOW_SLUG);
  if (!show) throw new Error('florida-buzz-disney show missing — apply podcast migrations');

  const settings = (await store.getScheduleSettings(DISNEY_SHOW_SLUG)) || defaultSettings();
  if (!force && !settings.weekly_draft_enabled) {
    return { skipped: true, reason: 'weekly_draft_disabled' };
  }
  if (!force && !matchesGenerateSlot(settings, now)) {
    return { skipped: true, reason: 'outside_generate_slot' };
  }

  let rejectEpisode = null;
  if (rejectEpisodeId) {
    rejectEpisode = await store.getEpisodeById(rejectEpisodeId);
    if (rejectEpisode?.generation_run_id) {
      await store.updateGenerationRun(rejectEpisode.generation_run_id, { status: 'rejected' });
    }
    if (rejectEpisode && !['published'].includes(rejectEpisode.status)) {
      await store.updateEpisode(rejectEpisode.id, {
        status: 'draft',
        last_error: 'Rejected for regeneration',
      });
    }
  }

  const selected = selectReleaseSlotForRun({
    settings,
    now,
    force,
    releaseSlotKey:
      releaseSlotKey ||
      rejectEpisode?.outline_json?.release_slot ||
      null,
    rejectEpisode,
  });
  if (!selected?.slot) {
    return { skipped: true, reason: 'no_release_slot' };
  }
  const slot = selected.slot;
  const weekKey =
    forcedWeekKey || weekKeyEt(selected.targetDate || now, settings.timezone);

  const weekRuns = await store.listGenerationRuns(DISNEY_SHOW_SLUG, weekKey);
  const runForSlot = (statuses) =>
    weekRuns.find(
      (r) =>
        statuses.includes(r.status) &&
        (r.payload?.release_slot === slot.key ||
          // Legacy runs without slot metadata: only block when this is the sole slot concern.
          (!r.payload?.release_slot && statuses.includes('running')))
    );

  const existingReady = runForSlot(['draft_ready', 'running']);
  if (!force && !rejectEpisodeId && existingReady?.payload?.release_slot === slot.key) {
    return { skipped: true, reason: 'already_have_run', run: existingReady, releaseSlot: slot };
  }
  if (!force && !rejectEpisodeId) {
    const existingEpisode = await findEpisodeForReleaseSlot(store, show.id, weekKey, slot.key);
    if (existingEpisode) {
      return {
        skipped: true,
        reason: 'already_have_run',
        episode: existingEpisode,
        releaseSlot: slot,
      };
    }
  }

  // Never stack concurrent drafts for the same week+slot — force still honors this.
  // Long script generation can take several minutes; a second click left orphan "running" rows.
  const alreadyRunning = weekRuns.find(
    (r) => r.status === 'running' && (!r.payload?.release_slot || r.payload.release_slot === slot.key)
  );
  if (alreadyRunning && !rejectEpisodeId) {
    const startedMs = Date.parse(alreadyRunning.updated_at || alreadyRunning.created_at || '') || 0;
    const ageMs = startedMs ? Date.now() - startedMs : 0;
    const staleMs = Number(env.PODCASTS_RUNNING_STALE_MS || 15 * 60 * 1000);
    if (ageMs > 0 && ageMs < staleMs) {
      return {
        skipped: true,
        reason: 'already_running',
        run: alreadyRunning,
        releaseSlot: slot,
      };
    }
    if (alreadyRunning.id) {
      await store.updateGenerationRun(alreadyRunning.id, {
        status: 'failed',
        error_detail: 'Marked failed: previous weekly draft was still running too long (likely gateway timeout). Open an existing draft episode and use Save / generate script.',
      });
    }
  }

  const priorAttempts = weekRuns;
  const attempt = (priorAttempts[0]?.attempt || 0) + 1;
  const run = await store.createGenerationRun({
    show_slug: DISNEY_SHOW_SLUG,
    week_key: weekKey,
    status: 'running',
    attempt,
    payload: {
      release_slot: slot.key,
      release_label: slot.label,
      episodes_created: 1,
    },
  });

  try {
    const collection = await collectWeeklySources(supabase, { weekKey, env, now });
    // One episode per run — use the full weekly source set for this slot (no split into two).
    const episodeSources = collection.sources;
    let anyFallback = false;

    const copy = await buildEpisodeCopy({
      aiText,
      weekKey,
      collection: { ...collection, sources: episodeSources },
      releaseSlot: slot,
    });
    const slugBase = slugify(`weekly-${weekKey}-a${attempt}-${slot.key}`);
    const episode = await store.createEpisode(show.id, {
      title: copy.title,
      description: copy.description,
      slug: slugBase,
      show_notes_html: '',
      episode_number: null,
      artwork_alt: show.cover_alt || show.title,
    });
    const showNotes = buildShowNotesHtml({
      episodeTitle: copy.title,
      sources: episodeSources,
      site: collection.site,
      episode: { slug: slugBase, week_key: weekKey },
    });
    // Persist release-slot intent on columns when migrated; always mirror into outline_json
    // so admin/notify still show Tuesday/Friday if the live DB is missing those columns.
    await store.updateEpisode(episode.id, {
      week_key: weekKey,
      generation_run_id: run.id,
      artwork_url: show.cover_url,
      artwork_alt: show.cover_alt || show.title,
      show_notes_html: showNotes,
      intended_publish_weekday: slot.weekday,
      intended_publish_hour: slot.hour,
      intended_publish_minute: slot.minute,
      outline_json: {
        week_key: weekKey,
        release_slot: slot.key,
        release_label: slot.label,
        intended_publish_weekday: slot.weekday,
        intended_publish_hour: slot.hour,
        intended_publish_minute: slot.minute,
        standalone: true,
      },
    });

    for (const source of episodeSources) {
      await store.addSource(episode.id, source);
    }

    const sources = await store.listSources(episode.id);
    const episodeMeta = {
      ...episode,
      ...copy,
      release_slot: slot.key,
      release_label: slot.label,
      intended_publish_weekday: slot.weekday,
      standalone: true,
    };
    let outline = '';
    let script = '';
    let scriptAiError = null;
    if (!aiText) {
      scriptAiError = 'AI text module unavailable — full 20–25 minute script was not generated';
    } else {
      try {
        outline = await generateOutline({ aiText, show, episode: episodeMeta, sources });
        await store.saveScript(episode.id, 'outline', outline, {
          week_key: weekKey,
          release_slot: slot.key,
          release_label: slot.label,
          intended_publish_weekday: slot.weekday,
          standalone: true,
        });
        await store.updateEpisode(episode.id, {
          outline_json: {
            text: outline,
            week_key: weekKey,
            release_slot: slot.key,
            release_label: slot.label,
            intended_publish_weekday: slot.weekday,
            intended_publish_hour: slot.hour,
            intended_publish_minute: slot.minute,
            standalone: true,
          },
        });
        script = await generateConversation({
          aiText,
          show,
          episode: episodeMeta,
          outline,
          sources,
        });
        await store.saveScript(episode.id, 'conversation', script, {
          week_key: weekKey,
          target_minutes: '20-25',
          release_slot: slot.key,
          release_label: slot.label,
          intended_publish_weekday: slot.weekday,
          standalone: true,
        });
        await store.updateEpisode(episode.id, { script_text: script, last_error: null });
        await store.setStatus(episode.id, 'script_ready');
      } catch (err) {
        scriptAiError = `Script AI unavailable: ${String(err.message || err).slice(0, 500)}`;
        console.warn('[podcasts] outline/script generation failed; keeping draft for manual script:', err.message);
        await store.updateEpisode(episode.id, { last_error: scriptAiError });
      }
    }
    if (!script) {
      // Short source-grounded scaffold for debugging only — NOT a publishable episode.
      anyFallback = true;
      outline = buildFallbackOutline({ weekKey, sources, copy });
      script = buildFallbackScript({ weekKey, sources, copy });
      await store.saveScript(episode.id, 'outline', outline, {
        week_key: weekKey,
        fallback: true,
        release_slot: slot.key,
        release_label: slot.label,
      });
      await store.updateEpisode(episode.id, {
        outline_json: {
          text: outline,
          week_key: weekKey,
          fallback: true,
          release_slot: slot.key,
          release_label: slot.label,
          intended_publish_weekday: slot.weekday,
          intended_publish_hour: slot.hour,
          intended_publish_minute: slot.minute,
          standalone: true,
        },
        script_text: script,
        last_error:
          scriptAiError ||
          'Full AI conversation script was not generated. This draft is only a short scaffold — do not publish. Clear the script box and click Save / generate script, then Generate private preview.',
      });
      await store.saveScript(episode.id, 'conversation', script, {
        week_key: weekKey,
        target_minutes: 'scaffold-only',
        fallback: true,
        release_slot: slot.key,
        release_label: slot.label,
      });
      const current = await store.getEpisodeById(episode.id);
      if (current.status === 'draft') {
        await store.updateEpisode(episode.id, { status: 'script_ready' });
      }
    }

    const freshEpisode = await store.getEpisodeById(episode.id);
    if (['published', 'scheduled', 'approved'].includes(freshEpisode.status)) {
      throw new Error('Safety abort: weekly draft must not reach publish statuses automatically');
    }
    const created = [freshEpisode];

    const autoPreview =
      !!cfg.autoPreview &&
      !!cfg.generation &&
      !anyFallback &&
      typeof pipeline?.generatePreview === 'function' &&
      String(freshEpisode.script_text || '').trim().length > 200;

    // Mark the run ready once scripts exist. TTS (if enabled) runs in the background —
    // never inside this HTTP request, and never auto-publishes.
    await store.updateGenerationRun(run.id, {
      status: 'draft_ready',
      episode_id: freshEpisode.id,
      payload: {
        counts: collection.counts,
        audio_generated: false,
        audio_auto_preview_started: autoPreview,
        generation_enabled: !!cfg.generation,
        used_fallback_script: anyFallback,
        episodes_created: 1,
        release_slot: slot.key,
        release_label: slot.label,
        release_slots: [
          {
            key: slot.key,
            label: slot.label,
            weekday: slot.weekday,
            episode_id: freshEpisode.id,
          },
        ],
        episode_ids: [freshEpisode.id],
        next_step: anyFallback
          ? 'Clear scaffold script and use Save / generate script on this standalone episode'
          : autoPreview
            ? `Private preview TTS started automatically for the ${slot.label} draft — open the episode and wait for preview_ready (publish stays manual)`
            : `Open the ${slot.label} draft and click Generate private preview (ElevenLabs TTS)`,
      },
      error_detail: null,
    });

    let audioGenerated = false;
    if (anyFallback && cfg.generation) {
      console.warn('[podcasts] skipping ElevenLabs TTS for fallback scaffold script');
    } else if (autoPreview) {
      const episodeForPreview = freshEpisode;
      const scriptForPreview = String(freshEpisode.script_text || '');
      console.info(
        `[podcasts] weekly draft ready — 1 standalone ${slot.label} episode; starting background private preview (auto-publish still off)`
      );
      setImmediate(() => {
        Promise.resolve()
          .then(() => pipeline.generatePreview(episodeForPreview, scriptForPreview))
          .then(() => {
            console.info(`[podcasts] auto private preview finished for episode ${episodeForPreview.id}`);
          })
          .catch(async (err) => {
            console.error('[podcasts] auto private preview failed:', err.message);
            try {
              await store.updateEpisode(episodeForPreview.id, {
                status: 'failed',
                last_error: `Audio generation failed: ${String(err.message || err).slice(0, 500)}`,
              });
            } catch (updateErr) {
              console.error('[podcasts] failed to persist auto-preview error:', updateErr.message);
            }
          });
      });
      audioGenerated = false; // still generating async
    } else if (cfg.generation && !anyFallback) {
      console.info(
        `[podcasts] weekly draft ready — 1 standalone ${slot.label} episode script; ElevenLabs TTS left for manual Generate private preview`
      );
    }

    const notify = await notifyDraftReady({
      episode: freshEpisode,
      episodes: created,
      run: { ...run, week_key: weekKey, attempt },
      settings,
      cfg,
      sendEmail,
      env,
    });
    if (notify.sent) {
      await store.updateGenerationRun(run.id, { notified_at: new Date().toISOString() });
    }

    return {
      skipped: false,
      weekKey,
      attempt,
      episode: freshEpisode,
      episodes: created,
      releaseSlot: slot,
      releaseSlots: [slot],
      slotReason: selected.reason,
      runId: run.id,
      counts: collection.counts,
      audioGenerated,
      episodesCreated: 1,
      // Back-compat alias — always 1 episode per run now.
      episodesPerWeek: 1,
      notified: notify,
    };
  } catch (err) {
    await store.updateGenerationRun(run.id, {
      status: 'failed',
      error_detail: String(err.message || err).slice(0, 2000),
    });
    throw err;
  }
}

async function tickWeeklyDraft(deps) {
  return createWeeklyDraft({ ...deps, force: false });
}

module.exports = {
  defaultSettings,
  DEFAULT_RELEASE_SLOTS,
  releaseSlotsFromSettings,
  selectReleaseSlotForRun,
  findEpisodeForReleaseSlot,
  stripPartLabels,
  buildShowNotesHtml,
  withPartnerDescription,
  buildEpisodeCopy,
  buildFallbackOutline,
  buildFallbackScript,
  splitSourcesForEpisodes,
  episodesPerWeek,
  createWeeklyDraft,
  tickWeeklyDraft,
};

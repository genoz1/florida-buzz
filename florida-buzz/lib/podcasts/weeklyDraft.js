'use strict';

const { DISNEY_SHOW_SLUG } = require('./config');
const { weekKeyEt, matchesGenerateSlot, WEEKDAY_NAMES } = require('./timeEt');
const { collectWeeklySources } = require('./sourceCollector');
const { generateOutline, generateConversation } = require('./script');
const { ensureShowNotesDisclosures, AFFILIATION_DISCLOSURE } = require('./hosts');
const { buildResourcesMentionedHtml, trackedSiteUrl } = require('./siteResources');
const { notifyDraftReady } = require('./notify');
const { slugify } = require('./validation');

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
    generate_weekday: 4,
    generate_hour: 19,
    generate_minute: 0,
    // Episode A (Tuesday) / Episode B (Friday) — intent only; auto_publish stays off.
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

function releaseSlotsFromSettings(settings = {}, env = process.env) {
  const count = episodesPerWeek(env);
  const a = {
    key: 'tue',
    weekday: Number(settings.intended_publish_weekday ?? DEFAULT_RELEASE_SLOTS[0].weekday),
    hour: Number(settings.intended_publish_hour ?? DEFAULT_RELEASE_SLOTS[0].hour),
    minute: Number(settings.intended_publish_minute ?? DEFAULT_RELEASE_SLOTS[0].minute),
  };
  const b = {
    key: 'fri',
    weekday: Number(settings.intended_publish_weekday_b ?? DEFAULT_RELEASE_SLOTS[1].weekday),
    hour: Number(settings.intended_publish_hour_b ?? DEFAULT_RELEASE_SLOTS[1].hour),
    minute: Number(settings.intended_publish_minute_b ?? DEFAULT_RELEASE_SLOTS[1].minute),
  };
  const base = [a, b].map((slot) => ({
    ...slot,
    label: WEEKDAY_NAMES[slot.weekday] || 'Release day',
  }));
  const slots = [];
  for (let i = 0; i < count; i += 1) {
    const template = base[i % base.length];
    const suffix = i >= base.length ? `-${i + 1}` : '';
    slots.push({
      ...template,
      key: `${template.key}${suffix}`,
      index: i,
    });
  }
  return slots;
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
<p>${escape(episodeTitle)} — a Florida Buzz: Disney conversation with Gena and Diane.</p>
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
<p>${AFFILIATION_DISCLOSURE}</p>
`.trim();
  return ensureShowNotesDisclosures(html);
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
  const focusHint = articleTitles[0] ? articleTitles[0].slice(0, 48) : 'Planning talk & park opinions';
  const fallbackTitle = `Florida Buzz: Disney — ${focusHint}`;
  const fallbackDescription = `Standalone ${slot.label} episode: Gena and Diane catch up on Florida Buzz Disney coverage, share recent park experiences, and weigh in on Buzz Board questions and planning topics. Visit https://thefloridabuzz.com. Unofficial fan podcast.`;

  if (!aiText) {
    return {
      title: stripPartLabels(fallbackTitle).slice(0, 200),
      description: stripPartLabels(fallbackDescription).slice(0, 4000),
      release_slot: slot.key,
      release_label: slot.label,
    };
  }

  const prompt = {
    system: `You write concise podcast packaging for Florida Buzz: Disney.
Return plain text with two lines only:
TITLE: ...
DESCRIPTION: ...
Rules: title under 80 chars; description under 320 chars; spell Gena not Gina; no Disney affiliation claims; do not invent news facts.
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
      description: description.slice(0, 4000),
      release_slot: slot.key,
      release_label: slot.label,
    };
  } catch (err) {
    console.warn('[podcasts] packaging AI failed, using fallback:', err.message);
    return {
      title: stripPartLabels(fallbackTitle).slice(0, 200),
      description: stripPartLabels(fallbackDescription).slice(0, 4000),
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
  lines.push('Close with Florida Buzz site CTAs (dining guide, wait times, day planner, Buzz Board).');
  return lines.join('\n');
}

function buildFallbackScript({ weekKey, sources, copy }) {
  const articles = sources.filter((s) => s.source_kind === 'article' && s.included !== false).slice(0, 4);
  const guides = sources.filter((s) => s.source_kind === 'guide' && s.included !== false).slice(0, 2);
  const buzz = sources.filter((s) => s.source_kind === 'buzz_board' && s.included !== false).slice(0, 2);
  const evergreen = sources.find((s) => s.source_kind === 'evergreen_topic' && s.included !== false);
  const turns = [];
  turns.push(`Gena: Hey Diane — welcome back to Florida Buzz: Disney. This week’s draft is ${copy.title}.`);
  turns.push('Diane: Heck yeah — let’s get into it. Quick reminder though: unofficial fan podcast, not affiliated with Disney.');
  turns.push('Gena: Exact facts still come from The Florida Buzz — articles, guides, and the Buzz Board.');
  articles.forEach((s, i) => {
    turns.push(
      i % 2 === 0
        ? `Gena: So The Florida Buzz covered “${s.title}.” I’m curious what stood out to you from that reporting.`
        : `Diane: Yeah, “${s.title}” was on my mind too — especially for planning our next park day.`
    );
  });
  guides.forEach((s) => {
    turns.push(`Diane: And for planning, I’d point people to the Florida Buzz guide on “${s.title}.”`);
    turns.push('Gena: Same — that’s the kind of thing we actually use before we leave the house.');
  });
  buzz.forEach((s) => {
    turns.push(`Gena: Over on the Buzz Board, people were talking about “${s.title}.”`);
    turns.push('Diane: I have thoughts — but I’d also tell listeners to add their answer on The Florida Buzz dot com.');
  });
  if (evergreen) {
    turns.push(`Gena: Before we wrap, evergreen chat: ${evergreen.title}.`);
    turns.push('Diane: Always relevant. Okay — dining guide, wait times, day planner, Buzz Board. Go use them.');
  }
  turns.push(
    'Gena: That’s our week-of scaffold for review. Once AI packaging is available we’ll expand this into the full conversational cut.'
  );
  turns.push(`Diane: Draft week key ${weekKey} — not for publication until approved.`);
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

  const weekKey = forcedWeekKey || weekKeyEt(now, settings.timezone);
  if (rejectEpisodeId) {
    const prior = await store.getEpisodeById(rejectEpisodeId);
    if (prior?.generation_run_id) {
      await store.updateGenerationRun(prior.generation_run_id, { status: 'rejected' });
    }
    if (prior && !['published'].includes(prior.status)) {
      await store.updateEpisode(prior.id, {
        status: 'draft',
        last_error: 'Rejected for regeneration',
      });
    }
  }

  const existingReady = await store.findGenerationRun(DISNEY_SHOW_SLUG, weekKey, ['draft_ready', 'running']);
  if (!force && !rejectEpisodeId && existingReady) {
    return { skipped: true, reason: 'already_have_run', run: existingReady };
  }

  // Never stack concurrent weekly drafts for the same week — force still honors this.
  // Long script generation can take several minutes; a second click left orphan "running" rows.
  const alreadyRunning = await store.findGenerationRun(DISNEY_SHOW_SLUG, weekKey, ['running']);
  if (alreadyRunning && !rejectEpisodeId) {
    const startedMs = Date.parse(alreadyRunning.updated_at || alreadyRunning.created_at || '') || 0;
    const ageMs = startedMs ? Date.now() - startedMs : 0;
    const staleMs = Number(env.PODCASTS_RUNNING_STALE_MS || 15 * 60 * 1000);
    if (ageMs > 0 && ageMs < staleMs) {
      return {
        skipped: true,
        reason: 'already_running',
        run: alreadyRunning,
      };
    }
    if (alreadyRunning.id) {
      await store.updateGenerationRun(alreadyRunning.id, {
        status: 'failed',
        error_detail: 'Marked failed: previous weekly draft was still running too long (likely gateway timeout). Open an existing draft episode and use Save / generate script.',
      });
    }
  }

  const priorAttempts = await store.listGenerationRuns(DISNEY_SHOW_SLUG, weekKey);
  const attempt = (priorAttempts[0]?.attempt || 0) + 1;
  const run = await store.createGenerationRun({
    show_slug: DISNEY_SHOW_SLUG,
    week_key: weekKey,
    status: 'running',
    attempt,
    payload: {},
  });

  try {
    const collection = await collectWeeklySources(supabase, { weekKey, env, now });
    const slots = releaseSlotsFromSettings(settings, env);
    const episodeCount = slots.length;
    const sourceBuckets = splitSourcesForEpisodes(collection.sources, episodeCount);
    const created = [];
    let anyFallback = false;

    for (let episodeIndex = 0; episodeIndex < episodeCount; episodeIndex += 1) {
      const slot = slots[episodeIndex];
      const episodeSources = sourceBuckets[episodeIndex];
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
      await store.updateEpisode(episode.id, {
        week_key: weekKey,
        generation_run_id: run.id,
        artwork_url: show.cover_url,
        artwork_alt: show.cover_alt || show.title,
        show_notes_html: showNotes,
        intended_publish_weekday: slot.weekday,
        intended_publish_hour: slot.hour,
        intended_publish_minute: slot.minute,
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
      created.push(freshEpisode);
    }

    // Mark the run ready once scripts exist. Do NOT run fal TTS inside this HTTP request.
    await store.updateGenerationRun(run.id, {
      status: 'draft_ready',
      episode_id: created[0]?.id || null,
      payload: {
        counts: collection.counts,
        audio_generated: false,
        generation_enabled: !!cfg.generation,
        used_fallback_script: anyFallback,
        episodes_per_week: episodeCount,
        release_slots: slots.map((s) => ({
          key: s.key,
          label: s.label,
          weekday: s.weekday,
          episode_id: created[s.index]?.id || null,
        })),
        episode_ids: created.map((e) => e.id),
        next_step: anyFallback
          ? 'Clear scaffold script and use Save / generate script on each standalone episode'
          : `Open each standalone draft (intended ${slots.map((s) => s.label).join(' + ')}) and click Generate private preview (fal TTS)`,
      },
      error_detail: null,
    });

    if (anyFallback && cfg.generation) {
      console.warn('[podcasts] skipping fal TTS for fallback scaffold script');
    } else if (cfg.generation && !anyFallback) {
      console.info(
        `[podcasts] weekly draft ready — ${episodeCount} standalone episode script(s) (${slots
          .map((s) => s.label)
          .join(' + ')}); fal TTS left for manual Generate private preview`
      );
    }

    const fresh = created[0];
    const audioGenerated = false;

    const notify = await notifyDraftReady({
      episode: fresh,
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
      episode: fresh,
      episodes: created,
      releaseSlots: slots,
      runId: run.id,
      counts: collection.counts,
      audioGenerated,
      episodesPerWeek: episodeCount,
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
  stripPartLabels,
  buildShowNotesHtml,
  buildEpisodeCopy,
  buildFallbackOutline,
  buildFallbackScript,
  splitSourcesForEpisodes,
  episodesPerWeek,
  createWeeklyDraft,
  tickWeeklyDraft,
};

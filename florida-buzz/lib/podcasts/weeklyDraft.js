'use strict';

const { DISNEY_SHOW_SLUG } = require('./config');
const { weekKeyEt, matchesGenerateSlot } = require('./timeEt');
const { collectWeeklySources } = require('./sourceCollector');
const { generateOutline, generateConversation } = require('./script');
const { ensureShowNotesDisclosures, AFFILIATION_DISCLOSURE, AI_ANECDOTE_DISCLOSURE } = require('./hosts');
const { notifyDraftReady } = require('./notify');
const { slugify } = require('./validation');

function defaultSettings(showSlug = DISNEY_SHOW_SLUG) {
  return {
    show_slug: showSlug,
    weekly_draft_enabled: false,
    timezone: 'America/New_York',
    generate_weekday: 4,
    generate_hour: 19,
    generate_minute: 0,
    intended_publish_weekday: 5,
    intended_publish_hour: 6,
    intended_publish_minute: 0,
    auto_publish_enabled: false,
    notify_email: null,
  };
}

function buildShowNotesHtml({ episodeTitle, sources, site }) {
  const articles = sources.filter((s) => s.source_kind === 'article' && s.included !== false);
  const guides = sources.filter((s) => s.source_kind === 'guide' && s.included !== false);
  const buzz = sources.filter((s) => s.source_kind === 'buzz_board' && s.included !== false);
  const evergreen = sources.filter((s) => s.source_kind === 'evergreen_topic' && s.included !== false);

  const linkList = (items) =>
    items.length
      ? `<ul>${items.map((s) => `<li><a href="${s.url}">${escape(s.title)}</a></li>`).join('')}</ul>`
      : '<p>None selected for this draft.</p>';

  const html = `
<p>${escape(episodeTitle)} — a Florida Buzz: Disney conversation with Gena and Diane.</p>
<p>Facts about prices, policies, hours, attraction status, and wait times are drawn only from the approved Florida Buzz sources linked below. Personal stories may be dramatized or composite.</p>
<h2>This week’s Florida Buzz articles</h2>
${linkList(articles)}
<h2>Guides &amp; planning references</h2>
${linkList(guides)}
<h2>Buzz Board questions we discuss</h2>
${linkList(buzz)}
<p>Have a take? Visit the <a href="${site}/buzz">Buzz Board</a> and add your answer.</p>
<h2>Evergreen discussion</h2>
${linkList(evergreen)}
<p>${AFFILIATION_DISCLOSURE}</p>
<p>${AI_ANECDOTE_DISCLOSURE}</p>
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

async function buildEpisodeCopy({ aiText, weekKey, collection }) {
  const articleTitles = collection.sources
    .filter((s) => s.source_kind === 'article')
    .map((s) => s.title)
    .slice(0, 6);
  const fallbackTitle = articleTitles.length
    ? `Florida Buzz: Disney — Week of park news & planning`
    : `Florida Buzz: Disney — Planning talk & park opinions`;
  const fallbackDescription =
    'Gena and Diane catch up on Florida Buzz Disney coverage, share recent park experiences, and weigh in on Buzz Board questions and planning topics. Unofficial fan podcast.';

  if (!aiText) {
    return { title: fallbackTitle, description: fallbackDescription };
  }

  const prompt = {
    system: `You write concise podcast packaging for Florida Buzz: Disney.
Return plain text with two lines only:
TITLE: ...
DESCRIPTION: ...
Rules: title under 80 chars; description under 320 chars; spell Gena not Gina; no Disney affiliation claims; do not invent news facts.`,
    user: `Week key: ${weekKey}
Article count: ${collection.counts.articles}
Sample article titles: ${articleTitles.join(' | ') || '(none — evergreen/Buzz Board heavy week)'}
Buzz Board topics: ${collection.sources
      .filter((s) => s.source_kind === 'buzz_board')
      .map((s) => s.title)
      .join(' | ') || '(none)'}
Evergreen topic: ${collection.sources.find((s) => s.source_kind === 'evergreen_topic')?.title || ''}`,
  };

  try {
    const text = String(
      await aiText.generateText({
        system: prompt.system,
        user: prompt.user,
        maxOutputTokens: 300,
      })
    );
    const title = (text.match(/TITLE:\s*(.+)/i) || [])[1]?.trim() || fallbackTitle;
    const description = (text.match(/DESCRIPTION:\s*(.+)/i) || [])[1]?.trim() || fallbackDescription;
    return { title: title.slice(0, 200), description: description.slice(0, 4000) };
  } catch (err) {
    console.warn('[podcasts] packaging AI failed, using fallback:', err.message);
    return { title: fallbackTitle, description: fallbackDescription };
  }
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
    const copy = await buildEpisodeCopy({ aiText, weekKey, collection });
    const slugBase = slugify(`weekly-${weekKey}-a${attempt}`);
    const showNotes = buildShowNotesHtml({
      episodeTitle: copy.title,
      sources: collection.sources,
      site: collection.site,
    });

    const episode = await store.createEpisode(show.id, {
      title: copy.title,
      description: copy.description,
      slug: slugBase,
      show_notes_html: showNotes,
      episode_number: null,
      artwork_alt: show.cover_alt || show.title,
    });
    await store.updateEpisode(episode.id, {
      week_key: weekKey,
      generation_run_id: run.id,
      artwork_url: show.cover_url,
      artwork_alt: show.cover_alt || show.title,
    });

    for (const source of collection.sources) {
      await store.addSource(episode.id, source);
    }

    const sources = await store.listSources(episode.id);
    let outline = '';
    let script = '';
    if (aiText) {
      outline = await generateOutline({ aiText, show, episode: { ...episode, ...copy }, sources });
      await store.saveScript(episode.id, 'outline', outline, { week_key: weekKey });
      await store.updateEpisode(episode.id, { outline_json: { text: outline, week_key: weekKey } });
      script = await generateConversation({
        aiText,
        show,
        episode: { ...episode, ...copy },
        outline,
        sources,
      });
      await store.saveScript(episode.id, 'conversation', script, { week_key: weekKey, target_minutes: '25-35' });
      await store.updateEpisode(episode.id, { script_text: script });
      await store.setStatus(episode.id, 'script_ready');
    }

    let audioGenerated = false;
    if (cfg.generation && pipeline && script) {
      await pipeline.generatePreview({ ...episode, script_text: script }, script);
      audioGenerated = true;
    }

    const fresh = await store.getEpisodeById(episode.id);
    // Never auto-publish. Stay in script_ready / preview_ready.
    if (['published', 'scheduled', 'approved'].includes(fresh.status)) {
      throw new Error('Safety abort: weekly draft must not reach publish statuses automatically');
    }

    await store.updateGenerationRun(run.id, {
      status: 'draft_ready',
      episode_id: episode.id,
      payload: {
        counts: collection.counts,
        audio_generated: audioGenerated,
        generation_enabled: !!cfg.generation,
      },
      error_detail: null,
    });

    const notify = await notifyDraftReady({
      episode: fresh,
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
      runId: run.id,
      counts: collection.counts,
      audioGenerated,
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
  buildShowNotesHtml,
  buildEpisodeCopy,
  createWeeklyDraft,
  tickWeeklyDraft,
};

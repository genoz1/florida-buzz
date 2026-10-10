'use strict';

const { DISNEY_SHOW_SLUG } = require('./config');
const { weekKeyEt, matchesGenerateSlot } = require('./timeEt');
const { collectWeeklySources } = require('./sourceCollector');
const { generateOutline, generateConversation } = require('./script');
const { ensureShowNotesDisclosures, AFFILIATION_DISCLOSURE } = require('./hosts');
const { buildResourcesMentionedHtml, trackedSiteUrl } = require('./siteResources');
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

async function buildEpisodeCopy({ aiText, weekKey, collection }) {
  const articleTitles = collection.sources
    .filter((s) => s.source_kind === 'article')
    .map((s) => s.title)
    .slice(0, 6);
  const fallbackTitle = articleTitles.length
    ? `Florida Buzz: Disney — Week of park news & planning`
    : `Florida Buzz: Disney — Planning talk & park opinions`;
  const fallbackDescription =
    'Gena and Diane catch up on Florida Buzz Disney coverage, share recent park experiences, and weigh in on Buzz Board questions and planning topics. Visit https://thefloridabuzz.com. Unofficial fan podcast.';

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
  turns.push(
    'Diane: And quick reminder for anyone new — we are an unofficial fan podcast and not affiliated with Disney.'
  );
  turns.push('Gena: Exact facts come from The Florida Buzz — articles, guides, and the Buzz Board.');
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
      sources: collection.sources,
      site: collection.site,
      episode: { slug: slugBase, week_key: weekKey },
    });
    await store.updateEpisode(episode.id, {
      week_key: weekKey,
      generation_run_id: run.id,
      artwork_url: show.cover_url,
      artwork_alt: show.cover_alt || show.title,
      show_notes_html: showNotes,
    });

    for (const source of collection.sources) {
      await store.addSource(episode.id, source);
    }

    const sources = await store.listSources(episode.id);
    let outline = '';
    let script = '';
    if (aiText) {
      try {
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
      } catch (err) {
        console.warn('[podcasts] outline/script generation failed; keeping draft for manual script:', err.message);
        await store.updateEpisode(episode.id, {
          last_error: `Script AI unavailable: ${String(err.message || err).slice(0, 500)}`,
        });
      }
    }
    if (!script) {
      // Deterministic source-grounded scaffold so drafts always carry a reviewable script
      // when OpenAI is unavailable. Replace via regenerate once AI keys are configured.
      outline = buildFallbackOutline({ weekKey, sources, copy });
      script = buildFallbackScript({ weekKey, sources, copy });
      await store.saveScript(episode.id, 'outline', outline, { week_key: weekKey, fallback: true });
      await store.updateEpisode(episode.id, {
        outline_json: { text: outline, week_key: weekKey, fallback: true },
        script_text: script,
      });
      await store.saveScript(episode.id, 'conversation', script, {
        week_key: weekKey,
        target_minutes: '25-35',
        fallback: true,
      });
      const current = await store.getEpisodeById(episode.id);
      if (current.status === 'draft') {
        await store.setStatus(episode.id, 'script_ready');
      }
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
  buildFallbackOutline,
  buildFallbackScript,
  createWeeklyDraft,
  tickWeeklyDraft,
};

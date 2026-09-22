function serializeItem(item) {
  return {
    title: item.title || '',
    link: item.link || '',
    guid: item.guid || item.link || '',
    contentSnippet: item.contentSnippet || null,
    content: item.content || null,
    enclosure: item.enclosure || null,
    mediaContent: item.mediaContent || null,
    mediaThumbnail: item.mediaThumbnail || null,
  };
}

function serializeSource(source) {
  return {
    name: source.name,
    category: source.category,
    city: source.city || null,
    mixedSource: !!source.mixedSource,
    preferAI: !!source.preferAI,
  };
}

function safeError(error) {
  const code = error?.code ? `${error.code}: ` : '';
  return `${code}${error?.message || 'unknown failure'}`.slice(0, 500);
}

function createArticleRetryQueue(client, { dryRun = false, logger = console } = {}) {
  async function recordPending(source, item) {
    if (!client || dryRun) return true;
    const guid = item.guid || item.link;
    const { error } = await client.from('article_generation_queue').upsert({
      guid,
      source_url: item.link,
      payload: { source: serializeSource(source), item: serializeItem(item) },
      status: 'pending',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'guid' });
    if (error) {
      logger.error(`  [warning] Could not persist retry item ${guid}: ${error.message}`);
      return false;
    }
    return true;
  }

  async function recordFailure(source, item, error) {
    if (!client || dryRun) return true;
    const guid = item.guid || item.link;
    let attempts = 1;
    const existing = await client
      .from('article_generation_queue')
      .select('attempts')
      .eq('guid', guid)
      .maybeSingle();
    if (existing.data?.attempts) attempts = existing.data.attempts + 1;

    const { error: upsertError } = await client.from('article_generation_queue').upsert({
      guid,
      source_url: item.link,
      payload: { source: serializeSource(source), item: serializeItem(item) },
      status: 'failed',
      attempts,
      last_error: safeError(error),
      last_attempt_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'guid' });
    if (upsertError) {
      logger.error(`  [warning] Could not update retry item ${guid}: ${upsertError.message}`);
      return false;
    }
    return true;
  }

  async function loadPending(limit = 50) {
    if (!client || dryRun) return [];
    const { data, error } = await client
      .from('article_generation_queue')
      .select('guid, payload, attempts, status')
      .in('status', ['pending', 'failed'])
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) {
      logger.error(`  [warning] Could not load article retry queue: ${error.message}`);
      return [];
    }
    return (data || []).filter((row) => row.payload?.source && row.payload?.item);
  }

  async function clear(guid) {
    if (!client || dryRun) return true;
    const { error } = await client.from('article_generation_queue').delete().eq('guid', guid);
    if (error) {
      logger.error(`  [warning] Could not clear retry item ${guid}: ${error.message}`);
      return false;
    }
    return true;
  }

  return { recordPending, recordFailure, loadPending, clear };
}

module.exports = { createArticleRetryQueue, serializeItem, serializeSource, safeError };

'use strict';

/**
 * PostgREST/Supabase returns schema-cache errors when the app writes columns
 * that exist in code/migrations but not yet in the live database.
 * Example: Could not find the 'intended_publish_hour' column of 'podcast_episodes' in the schema cache
 */

const missingByTable = new Map();
const warned = new Set();

function missingSet(table) {
  if (!missingByTable.has(table)) missingByTable.set(table, new Set());
  return missingByTable.get(table);
}

function parseMissingColumnError(message) {
  const text = String(message || '');
  const schemaCache = text.match(
    /Could not find the '([^']+)' column of '([^']+)' in the schema cache/i
  );
  if (schemaCache) {
    return { column: schemaCache[1], table: schemaCache[2] };
  }
  const pg = text.match(/column ["']?(\w+)["']? of relation ["']?(\w+)["']? does not exist/i);
  if (pg) {
    return { column: pg[1], table: pg[2] };
  }
  // PGRST204 sometimes embeds column name only.
  const pgrst = text.match(/PGRST204[\s\S]*?'([^']+)'/i) || text.match(/Could not find the '([^']+)' column/i);
  if (pgrst) {
    return { column: pgrst[1], table: null };
  }
  return null;
}

function isMissingColumnError(error) {
  const message = typeof error === 'string' ? error : error?.message || '';
  if (!message) return false;
  if (/schema cache/i.test(message) && /column/i.test(message)) return true;
  if (/does not exist/i.test(message) && /column/i.test(message)) return true;
  if (/PGRST204/i.test(message)) return true;
  return false;
}

function omitKnownMissing(table, patch) {
  const missing = missingSet(table);
  if (!missing.size) return { patch: { ...patch }, omitted: {} };
  const next = { ...patch };
  const omitted = {};
  for (const key of missing) {
    if (Object.prototype.hasOwnProperty.call(next, key)) {
      omitted[key] = next[key];
      delete next[key];
    }
  }
  return { patch: next, omitted };
}

function rememberMissing(table, column) {
  if (!table || !column) return;
  missingSet(table).add(column);
  const key = `${table}.${column}`;
  if (!warned.has(key)) {
    warned.add(key);
    console.warn(
      `[podcasts] DB missing column ${table}.${column} — omitting from writes until migration 20261010223000_podcast_episode_release_slots.sql is applied`
    );
  }
}

/**
 * Run an update/insert that may include columns not yet in the live schema.
 * Retries after stripping each reported missing column. Returns the DB row plus
 * any fields that could not be persisted (merged onto the result for callers).
 */
async function withMissingColumnRetry(table, patch, run) {
  let attemptPatch = { ...patch };
  const omittedAll = {};
  const pre = omitKnownMissing(table, attemptPatch);
  attemptPatch = pre.patch;
  Object.assign(omittedAll, pre.omitted);

  for (let i = 0; i < 12; i += 1) {
    try {
      const row = await run(attemptPatch);
      return { row, omitted: omittedAll, patch: attemptPatch };
    } catch (err) {
      if (!isMissingColumnError(err)) throw err;
      const parsed = parseMissingColumnError(err.message);
      const column = parsed?.column;
      if (!column || !Object.prototype.hasOwnProperty.call(attemptPatch, column)) {
        // Unknown / already-stripped column — drop all optional release-slot keys as last resort.
        const optional = [
          'intended_publish_weekday',
          'intended_publish_hour',
          'intended_publish_minute',
          'intended_publish_weekday_b',
          'intended_publish_hour_b',
          'intended_publish_minute_b',
        ];
        let dropped = false;
        for (const key of optional) {
          if (Object.prototype.hasOwnProperty.call(attemptPatch, key)) {
            omittedAll[key] = attemptPatch[key];
            delete attemptPatch[key];
            rememberMissing(table, key);
            dropped = true;
          }
        }
        if (!dropped) throw err;
        continue;
      }
      omittedAll[column] = attemptPatch[column];
      delete attemptPatch[column];
      rememberMissing(parsed.table || table, column);
    }
  }
  throw new Error(`Exhausted schema-compat retries for ${table}`);
}

function mergeOmitted(row, omitted) {
  if (!row || !omitted || !Object.keys(omitted).length) return row;
  return { ...row, ...omitted };
}

function resetMissingColumnCacheForTests() {
  missingByTable.clear();
  warned.clear();
}

module.exports = {
  parseMissingColumnError,
  isMissingColumnError,
  omitKnownMissing,
  rememberMissing,
  withMissingColumnRetry,
  mergeOmitted,
  resetMissingColumnCacheForTests,
};

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseMissingColumnError,
  isMissingColumnError,
  withMissingColumnRetry,
  mergeOmitted,
  resetMissingColumnCacheForTests,
} = require('../lib/podcasts/schemaCompat');
const { createSupabaseStore, enrichEpisodeReleaseSlots } = require('../lib/podcasts/store');

test('parseMissingColumnError reads PostgREST schema-cache messages', () => {
  const parsed = parseMissingColumnError(
    "Could not find the 'intended_publish_hour' column of 'podcast_episodes' in the schema cache"
  );
  assert.equal(parsed.column, 'intended_publish_hour');
  assert.equal(parsed.table, 'podcast_episodes');
  assert.equal(isMissingColumnError({ message: 'some other failure' }), false);
  assert.equal(
    isMissingColumnError({
      message: "Could not find the 'intended_publish_hour' column of 'podcast_episodes' in the schema cache",
    }),
    true
  );
});

test('withMissingColumnRetry strips missing columns and merges them back', async () => {
  resetMissingColumnCacheForTests();
  let calls = 0;
  const { row, omitted } = await withMissingColumnRetry(
    'podcast_episodes',
    {
      week_key: '2026-W41',
      intended_publish_weekday: 2,
      intended_publish_hour: 6,
      intended_publish_minute: 0,
    },
    async (patch) => {
      calls += 1;
      if (Object.prototype.hasOwnProperty.call(patch, 'intended_publish_hour')) {
        throw new Error(
          "Could not find the 'intended_publish_hour' column of 'podcast_episodes' in the schema cache"
        );
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'intended_publish_weekday')) {
        throw new Error(
          "Could not find the 'intended_publish_weekday' column of 'podcast_episodes' in the schema cache"
        );
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'intended_publish_minute')) {
        throw new Error(
          "Could not find the 'intended_publish_minute' column of 'podcast_episodes' in the schema cache"
        );
      }
      return { id: 'ep-1', ...patch };
    }
  );
  assert.ok(calls >= 2);
  assert.equal(row.week_key, '2026-W41');
  assert.equal(omitted.intended_publish_weekday, 2);
  assert.equal(omitted.intended_publish_hour, 6);
  const merged = mergeOmitted(row, omitted);
  assert.equal(merged.intended_publish_weekday, 2);
  assert.equal(merged.intended_publish_hour, 6);
});

test('createSupabaseStore.updateEpisode degrades when release-slot columns missing', async () => {
  resetMissingColumnCacheForTests();
  const updates = [];
  const client = {
    from(table) {
      assert.equal(table, 'podcast_episodes');
      return {
        update(patch) {
          updates.push({ ...patch });
          return {
            eq() {
              return this;
            },
            select() {
              return this;
            },
            single() {
              if (
                Object.prototype.hasOwnProperty.call(patch, 'intended_publish_hour') ||
                Object.prototype.hasOwnProperty.call(patch, 'intended_publish_weekday') ||
                Object.prototype.hasOwnProperty.call(patch, 'intended_publish_minute')
              ) {
                return Promise.resolve({
                  data: null,
                  error: {
                    message:
                      "Could not find the 'intended_publish_hour' column of 'podcast_episodes' in the schema cache",
                  },
                });
              }
              return Promise.resolve({
                data: { id: 'ep-1', status: 'draft', ...patch, outline_json: patch.outline_json || null },
                error: null,
              });
            },
          };
        },
      };
    },
  };

  const store = createSupabaseStore(client);
  const result = await store.updateEpisode('ep-1', {
    week_key: '2026-W41',
    intended_publish_weekday: 2,
    intended_publish_hour: 6,
    intended_publish_minute: 0,
    outline_json: { release_label: 'Tuesday', intended_publish_weekday: 2 },
  });
  assert.equal(result.week_key, '2026-W41');
  assert.equal(result.intended_publish_weekday, 2);
  assert.equal(result.intended_publish_hour, 6);
  assert.ok(updates.length >= 2);
  assert.ok(!Object.prototype.hasOwnProperty.call(updates[updates.length - 1], 'intended_publish_hour'));
});

test('createSupabaseStore.upsertScheduleSettings strips missing _b columns', async () => {
  resetMissingColumnCacheForTests();
  const client = {
    from(table) {
      if (table === 'podcast_schedule_settings') {
        return {
          select() {
            return {
              eq() {
                return this;
              },
              maybeSingle() {
                return Promise.resolve({
                  data: {
                    show_slug: 'florida-buzz-disney',
                    weekly_draft_enabled: true,
                    intended_publish_weekday: 2,
                    intended_publish_hour: 6,
                    intended_publish_minute: 0,
                  },
                  error: null,
                });
              },
            };
          },
          update(patch) {
            return {
              eq() {
                return this;
              },
              select() {
                return this;
              },
              single() {
                if (Object.prototype.hasOwnProperty.call(patch, 'intended_publish_weekday_b')) {
                  return Promise.resolve({
                    data: null,
                    error: {
                      message:
                        "Could not find the 'intended_publish_weekday_b' column of 'podcast_schedule_settings' in the schema cache",
                    },
                  });
                }
                if (Object.prototype.hasOwnProperty.call(patch, 'intended_publish_hour_b')) {
                  return Promise.resolve({
                    data: null,
                    error: {
                      message:
                        "Could not find the 'intended_publish_hour_b' column of 'podcast_schedule_settings' in the schema cache",
                    },
                  });
                }
                if (Object.prototype.hasOwnProperty.call(patch, 'intended_publish_minute_b')) {
                  return Promise.resolve({
                    data: null,
                    error: {
                      message:
                        "Could not find the 'intended_publish_minute_b' column of 'podcast_schedule_settings' in the schema cache",
                    },
                  });
                }
                return Promise.resolve({ data: { show_slug: 'florida-buzz-disney', ...patch }, error: null });
              },
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  const store = createSupabaseStore(client);
  const row = await store.upsertScheduleSettings('florida-buzz-disney', {
    weekly_draft_enabled: true,
    intended_publish_weekday: 2,
    intended_publish_hour: 6,
    intended_publish_minute: 0,
    intended_publish_weekday_b: 5,
    intended_publish_hour_b: 6,
    intended_publish_minute_b: 0,
    auto_publish_enabled: false,
  });
  assert.equal(row.intended_publish_weekday_b, 5);
  assert.equal(row.weekly_draft_enabled, true);
});

test('enrichEpisodeReleaseSlots recovers from outline_json', () => {
  const ep = enrichEpisodeReleaseSlots({
    id: 'x',
    intended_publish_weekday: null,
    outline_json: { intended_publish_weekday: 5, intended_publish_hour: 6, release_label: 'Friday' },
  });
  assert.equal(ep.intended_publish_weekday, 5);
  assert.equal(ep.intended_publish_hour, 6);
});

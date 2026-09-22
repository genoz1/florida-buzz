const test = require('node:test');
const assert = require('node:assert/strict');
const { createArticleRetryQueue } = require('../lib/articleRetryQueue');
const { createScheduledRunner } = require('../lib/scheduledRun');
const { alreadyPublishedSource } = require('../scripts/automate');

function queueClient() {
  const rows = new Map();
  return {
    rows,
    from() {
      return {
        upsert: async (row) => {
          rows.set(row.guid, { ...(rows.get(row.guid) || { created_at: new Date().toISOString(), attempts: 0 }), ...row });
          return { error: null };
        },
        select() {
          return {
            eq(field, value) {
              return { maybeSingle: async () => ({ data: rows.get(value) || null, error: null }) };
            },
            in(field, statuses) {
              return { order() { return { limit: async (limit) => ({ data: [...rows.values()].filter((r) => statuses.includes(r.status)).slice(0, limit), error: null }) }; } };
            },
          };
        },
        delete() {
          return { eq: async (field, value) => { rows.delete(value); return { error: null }; } };
        },
      };
    },
  };
}

test('failed RSS stories remain in a durable retry queue until explicitly cleared', async () => {
  const client = queueClient();
  const queue = createArticleRetryQueue(client);
  const source = { name: 'Official Source', category: 'events' };
  const item = { guid: 'story-1', link: 'https://example.com/story-1', title: 'Story One', contentSnippet: 'Facts' };

  await queue.recordPending(source, item);
  await queue.recordFailure(source, item, Object.assign(new Error('provider unavailable'), { code: 'provider_5xx' }));
  let pending = await queue.loadPending();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].guid, 'story-1');
  assert.equal(pending[0].status, 'failed');
  assert.equal(pending[0].attempts, 1);

  await queue.recordFailure(source, item, new Error('rate limited'));
  pending = await queue.loadPending();
  assert.equal(pending[0].attempts, 2);

  await queue.clear('story-1');
  assert.equal((await queue.loadPending()).length, 0);
});

test('scheduler refuses an overlapping run and releases the lock on completion', () => {
  let callback;
  let starts = 0;
  const exec = (command, options, cb) => { starts += 1; callback = cb; };
  const logger = { log() {}, warn() {}, error() {} };
  const { runScheduledCommand } = createScheduledRunner({ cwd: '/app', exec, logger });

  assert.equal(runScheduledCommand('articles', 'node scripts/automate.js'), true);
  assert.equal(runScheduledCommand('articles', 'node scripts/automate.js'), false);
  assert.equal(starts, 1);
  callback(null, '', '');
  assert.equal(runScheduledCommand('articles', 'node scripts/automate.js'), true);
  assert.equal(starts, 2);
});

test('a retry cannot republish a source URL that already has an article', async () => {
  function articleClient(rows) {
    return {
      from(table) {
        assert.equal(table, 'articles');
        return {
          select() {
            return {
              eq(field, value) {
                assert.equal(field, 'source_url');
                assert.equal(value, 'https://example.com/already-published');
                return { limit: async () => ({ data: rows, error: null }) };
              },
            };
          },
        };
      },
    };
  }

  assert.equal(await alreadyPublishedSource('https://example.com/already-published', articleClient([{ id: 'article-1' }])), true);
  assert.equal(await alreadyPublishedSource('https://example.com/already-published', articleClient([])), false);
});

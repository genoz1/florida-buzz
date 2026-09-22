const test = require('node:test');
const assert = require('node:assert/strict');
const {
  aiContentSchedulesEnabled,
  getScheduleFlags,
  hasRequiredConfig,
  shouldScheduleAI,
} = require('../lib/scheduleConfig');

test('missing AI_CONTENT_SCHEDULES_ENABLED keeps AI schedules disabled', () => {
  const env = { OPENAI_API_KEY: 'configured' };
  assert.equal(aiContentSchedulesEnabled(env), false);
  assert.equal(shouldScheduleAI(env), false);
});

test('AI_CONTENT_SCHEDULES_ENABLED=false keeps AI schedules disabled', () => {
  const env = { AI_CONTENT_SCHEDULES_ENABLED: 'false', OPENAI_API_KEY: 'configured' };
  assert.equal(aiContentSchedulesEnabled(env), false);
  assert.equal(shouldScheduleAI(env), false);
});

test('AI_CONTENT_SCHEDULES_ENABLED=true enables AI schedules only when requirements exist', () => {
  const enabled = { AI_CONTENT_SCHEDULES_ENABLED: 'true', OPENAI_API_KEY: 'configured' };
  const missingKey = { AI_CONTENT_SCHEDULES_ENABLED: 'true' };
  assert.equal(aiContentSchedulesEnabled(enabled), true);
  assert.equal(shouldScheduleAI(enabled), true);
  assert.equal(shouldScheduleAI(missingKey), false);
});

test('OPENAI_API_KEY alone cannot enable AI schedules', () => {
  assert.equal(shouldScheduleAI({ OPENAI_API_KEY: 'configured' }), false);
});

test('AI social schedules also require their existing Facebook configuration', () => {
  const base = { AI_CONTENT_SCHEDULES_ENABLED: 'true', OPENAI_API_KEY: 'configured' };
  assert.equal(shouldScheduleAI(base, ['OPENAI_API_KEY', 'FB_PAGE_ID', 'FB_PAGE_ACCESS_TOKEN']), false);
  assert.equal(shouldScheduleAI({ ...base, FB_PAGE_ID: 'page', FB_PAGE_ACCESS_TOKEN: 'token' }, ['OPENAI_API_KEY', 'FB_PAGE_ID', 'FB_PAGE_ACCESS_TOKEN']), true);
});

test('non-AI schedules remain independent of the AI gate', () => {
  const env = {
    AI_CONTENT_SCHEDULES_ENABLED: 'false',
    RESEND_API_KEY: 'configured',
    ALERT_EMAIL_TO: 'configured',
    FB_PAGE_ID: 'configured',
    FB_PAGE_ACCESS_TOKEN: 'configured',
  };
  assert.equal(hasRequiredConfig(env, ['RESEND_API_KEY']), true);
  assert.equal(hasRequiredConfig(env, ['RESEND_API_KEY', 'ALERT_EMAIL_TO']), true);
  assert.equal(hasRequiredConfig(env, ['FB_PAGE_ID', 'FB_PAGE_ACCESS_TOKEN']), true);
});

test('server schedule map disables every AI group by default while preserving non-AI groups', () => {
  const env = {
    OPENAI_API_KEY: 'configured',
    RESEND_API_KEY: 'configured',
    ALERT_EMAIL_TO: 'configured',
    FB_PAGE_ID: 'configured',
    FB_PAGE_ACCESS_TOKEN: 'configured',
  };
  const flags = getScheduleFlags(env);
  assert.deepEqual({
    articleAutomation: flags.articleAutomation,
    evergreenGuides: flags.evergreenGuides,
    cityRoundups: flags.cityRoundups,
    engagementPosts: flags.engagementPosts,
    diningDirectoryResearch: flags.diningDirectoryResearch,
    featurePromoCaptions: flags.featurePromoCaptions,
  }, {
    articleAutomation: false,
    evergreenGuides: false,
    cityRoundups: false,
    engagementPosts: false,
    diningDirectoryResearch: false,
    featurePromoCaptions: false,
  });
  assert.equal(flags.newsletter, true);
  assert.equal(flags.standardPromo, true);
  assert.equal(flags.postHealthCheck, true);
});

test('server schedule map enables every configured AI group only with an explicit true gate', () => {
  const flags = getScheduleFlags({
    AI_CONTENT_SCHEDULES_ENABLED: 'true',
    OPENAI_API_KEY: 'configured',
    FB_PAGE_ID: 'configured',
    FB_PAGE_ACCESS_TOKEN: 'configured',
  });
  assert.equal(flags.articleAutomation, true);
  assert.equal(flags.evergreenGuides, true);
  assert.equal(flags.cityRoundups, true);
  assert.equal(flags.engagementPosts, true);
  assert.equal(flags.diningDirectoryResearch, true);
  assert.equal(flags.featurePromoCaptions, true);
});

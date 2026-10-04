const { createCommunityRouter } = require('./router');
const { createCommunityService } = require('./service');
const { createCommunityStore } = require('./store');
const { createModerationClassifier } = require('./moderation');

function createProductionCommunityRouter({ client, authFoundation, env = process.env }) {
  if (!client) throw new Error('Buzz Board requires the server-side Supabase client.');
  const store = createCommunityStore({ client });
  const classify = createModerationClassifier({ mode: env.COMMUNITY_MODERATION_MODE || 'deterministic' });
  const service = createCommunityService({
    store,
    limiter: authFoundation.limiter,
    classify,
    analyticsKey: authFoundation.config.rateLimitKey,
  });
  return createCommunityRouter({
    store,
    service,
    authMiddleware: authFoundation.authMiddleware,
    csrf: authFoundation.csrf,
    config: authFoundation.config,
  });
}

module.exports = {
  createCommunityRouter,
  createCommunityService,
  createCommunityStore,
  createModerationClassifier,
  createProductionCommunityRouter,
};

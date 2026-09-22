function hasRequiredConfig(env, requiredNames) {
  return requiredNames.every((name) => Boolean(env[name]));
}

function aiContentSchedulesEnabled(env = process.env) {
  return env.AI_CONTENT_SCHEDULES_ENABLED === 'true';
}

function shouldScheduleAI(env, requiredNames = ['OPENAI_API_KEY']) {
  return aiContentSchedulesEnabled(env) && hasRequiredConfig(env, requiredNames);
}

function getScheduleFlags(env = process.env) {
  const openAI = ['OPENAI_API_KEY'];
  const openAIAndFacebook = ['OPENAI_API_KEY', 'FB_PAGE_ID', 'FB_PAGE_ACCESS_TOKEN'];
  return {
    articleAutomation: shouldScheduleAI(env, openAI),
    evergreenGuides: shouldScheduleAI(env, openAI),
    cityRoundups: shouldScheduleAI(env, openAIAndFacebook),
    engagementPosts: shouldScheduleAI(env, openAIAndFacebook),
    diningDirectoryResearch: shouldScheduleAI(env, openAI),
    featurePromoCaptions: shouldScheduleAI(env, openAIAndFacebook),
    newsletter: hasRequiredConfig(env, ['RESEND_API_KEY']),
    standardPromo: hasRequiredConfig(env, ['FB_PAGE_ID', 'FB_PAGE_ACCESS_TOKEN']),
    postHealthCheck: hasRequiredConfig(env, ['RESEND_API_KEY', 'ALERT_EMAIL_TO']),
  };
}

module.exports = {
  aiContentSchedulesEnabled,
  getScheduleFlags,
  hasRequiredConfig,
  shouldScheduleAI,
};

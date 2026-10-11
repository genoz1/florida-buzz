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
    imageRepair: shouldScheduleAI(env, ['OPENAI_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY']),
    newsletter: hasRequiredConfig(env, ['RESEND_API_KEY']),
    standardPromo: hasRequiredConfig(env, ['FB_PAGE_ID', 'FB_PAGE_ACCESS_TOKEN']),
    postHealthCheck: hasRequiredConfig(env, ['RESEND_API_KEY', 'ALERT_EMAIL_TO']),
    // Opinion QOTD social posts are paused by default while short-form video
    // is the primary engagement channel. Re-enable only with both flags:
    // BUZZ_BOARD_SOCIAL_ENABLED=true and BUZZ_BOARD_OPINION_SOCIAL_ENABLED=true.
    buzzBoardSocial: env.BUZZ_BOARD_SOCIAL_ENABLED === 'true'
      && env.BUZZ_BOARD_OPINION_SOCIAL_ENABLED === 'true'
      && env.BUZZ_BOARD_ENABLED === 'true'
      && hasRequiredConfig(env, [
        'FB_PAGE_ID',
        'FB_PAGE_ACCESS_TOKEN',
        'INSTAGRAM_USER_ID',
        'INSTAGRAM_ACCESS_TOKEN',
      ]),
    facebookBuzzCommentSync: env.FACEBOOK_BUZZ_COMMENT_SYNC_ENABLED === 'true'
      && env.BUZZ_BOARD_ENABLED === 'true'
      && hasRequiredConfig(env, ['FB_PAGE_ACCESS_TOKEN']),
    // Opt-in: 1 inexpensive park/cruise Reel per day (Ken Burns + kinetic text).
    // Off until FB_PARK_REEL_ENABLED=true. Publishing still needs FB_PARK_REEL_PUBLISH=true.
    facebookParkReel: env.FB_PARK_REEL_ENABLED === 'true'
      && hasRequiredConfig(env, ['FB_PAGE_ID', 'FB_PAGE_ACCESS_TOKEN', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY']),
  };
}

const FACEBOOK_BUZZ_SLOT_SCHEDULE = [
  { cron: '30 8 * * *', slot: 'morning', label: '8:30am' },
  { cron: '15 14 * * *', slot: 'afternoon', label: '2:15pm' },
  { cron: '30 21 * * *', slot: 'evening', label: '9:30pm' },
];

/**
 * Optional cadence knob for Buzz Board Facebook only.
 * BUZZ_FACEBOOK_SLOTS=morning,afternoon,evening (default all three).
 */
function parseBuzzFacebookSlots(raw) {
  const requested = String(raw || 'morning,afternoon,evening')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const allowed = new Set(requested);
  const selected = FACEBOOK_BUZZ_SLOT_SCHEDULE.filter((entry) => allowed.has(entry.slot));
  return selected.length ? selected : [...FACEBOOK_BUZZ_SLOT_SCHEDULE];
}

module.exports = {
  aiContentSchedulesEnabled,
  FACEBOOK_BUZZ_SLOT_SCHEDULE,
  getScheduleFlags,
  hasRequiredConfig,
  parseBuzzFacebookSlots,
  shouldScheduleAI,
};

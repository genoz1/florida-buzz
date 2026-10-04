function capped(value, maximum) {
  return Math.min(Math.max(Number(value) || 0, 0), maximum);
}

function calculateBuzzScore(metrics, now = new Date()) {
  const participants = capped(metrics.recentParticipants, 8);
  const substantive = capped(metrics.substantiveResponses, 12);
  const replyThreads = capped(metrics.replyThreads, 6);
  const likes = capped(metrics.recentLikes, 15);
  const velocity = capped(metrics.velocity, 10);
  const genuineActivity = substantive + likes;
  const lastActivity = new Date(metrics.lastActivityAt || 0);
  const ageBlocks = Number.isFinite(lastActivity.getTime())
    ? Math.floor(Math.max(0, now.getTime() - lastActivity.getTime()) / (4 * 60 * 60 * 1000))
    : 12;
  const recency = genuineActivity ? Math.max(0, 12 - ageBlocks) : 0;
  const createdAt = new Date(metrics.createdAt || 0);
  const newExposure = Number.isFinite(createdAt.getTime())
    && now.getTime() - createdAt.getTime() <= 48 * 60 * 60 * 1000 ? 3 : 0;
  return participants * 6 + substantive * 4 + replyThreads * 3 + likes + velocity * 2 + recency + newExposure;
}

module.exports = { calculateBuzzScore };

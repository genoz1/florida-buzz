'use strict';
const criteria = ['hook', 'usefulness', 'relevance', 'visuals', 'clicks', 'discussion', 'verifiability', 'evergreen', 'brandFit', 'guideDepth'];
const seeds = [
  ['mk-arrival-proof', 'The best time to arrive at Magic Kingdom — and what to do first', 'Magic Kingdom', 'strategy', 'EXISTING_PROOF'],
  ['christmas-party-2026', 'Is Mickey’s Very Merry Christmas Party actually worth the money?', 'Magic Kingdom', 'value'],
  ['mk-first-hour-rides', 'The Magic Kingdom rides you should not waste your first hour on', 'Magic Kingdom', 'strategy'],
  ['epic-first-visit', 'The biggest first-time Epic Universe mistake', 'Epic Universe', 'mistake'],
  ['epic-day-cost', 'What a day at Epic Universe really costs', 'Epic Universe', 'value'],
  ['mk-one-day', 'The one thing to do differently on your next Magic Kingdom day', 'Magic Kingdom', 'strategy'],
  ['mk-midday', 'The Magic Kingdom midday mistake', 'Magic Kingdom', 'mistake'],
  ['lightning-lane-value', 'When Lightning Lane is actually worth paying for', 'Disney parks', 'value'],
  ['disney-transport', 'The Disney transportation mistake that can make you late', 'Disney resorts', 'transport'],
  ['mk-worst-arrival', 'The worst time to show up at Magic Kingdom', 'Magic Kingdom', 'timing'],
].map(([key, title, destination, angle, status = 'QUEUED'], i) => ({ key, title, destination, angle, status, seed_order: i + 1, score: 100 - i }));
function score(topic) {
  for (const key of criteria) if (!Number.isInteger(topic.scores?.[key]) || topic.scores[key] < 1 || topic.scores[key] > 10) throw new Error(`Invalid topic score: ${key}`);
  if (topic.scores.usefulness < 7 || topic.scores.hook < 7 || topic.scores.verifiability < 7 || topic.scores.guideDepth < 7) return 0;
  return criteria.reduce((sum, key) => sum + topic.scores[key], 0);
}
function strongest(candidates, recent = [], count = 3) {
  const ranked = candidates.map(t => ({ ...t, score: score(t) })).filter(t => t.score > 0)
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  const chosen = [];
  for (const t of ranked) {
    if (chosen.some(c => c.destination === t.destination || (c.angle === 'mistake' && t.angle === 'mistake'))) continue;
    if(t.angle==='value'&&chosen.filter(c=>c.angle==='value').length>=2)continue;
    if (recent.slice(-2).every(r => r.destination === t.destination) && recent.length >= 2) continue;
    chosen.push(t);
    if (chosen.length === count) break;
  }
  return chosen;
}
function selectQueued(topics) {
  return topics.filter(t => t.status === 'QUEUED').sort((a, b) => {
    if (a.seed_order && b.seed_order) return a.seed_order - b.seed_order;
    if (a.seed_order || b.seed_order) return a.seed_order ? -1 : 1;
    return b.score - a.score;
  })[0];
}
module.exports = { seeds, criteria, score, strongest, selectQueued };

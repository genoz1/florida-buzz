const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const candidatePath = path.join(root, 'content', 'buzz-board-launch-candidates.json');
const inventoryPath = path.join(root, 'content', 'buzz-board-launch-inventory.json');
const migrationPath = path.join(root, 'supabase', 'migrations', '20261003233000_buzz_board_launch_inventory.sql');
const targets = { disney: 18, universal: 10, cruises: 4, 'florida-life': 4 };
const candidateTargets = { disney: 30, universal: 17, cruises: 7, 'florida-life': 6 };
const genericQuestions = new Set([
  'what is your favorite disney ride',
  'what is your favorite universal attraction',
  'what is your favorite cruise line',
  'what is your favorite florida beach',
  'what do you think about disney',
  'are you excited for your next vacation',
]);

function fail(message) {
  throw new Error(`Launch inventory validation failed: ${message}`);
}

function normalize(value) {
  return value.toLocaleLowerCase('en-US').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

const stopWords = new Set('a an and are as at be before between but by can do does for from had has have how i in into is it its much of on or our should still than that the their them they this to too up was we what when where which who why will with would you your'.split(' '));
function tokens(value) {
  return new Set(normalize(value).split(' ').filter((word) => word.length > 2 && !stopWords.has(word)).map((word) => word.replace(/(?:ing|ed|es|s)$/i, '')));
}

function similarity(left, right) {
  const a = tokens(left);
  const b = tokens(right);
  const intersection = [...a].filter((word) => b.has(word)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

function sql(value) {
  return value === null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
}

function total(candidate) {
  return candidate.scores.reduce((sum, score) => sum + score, 0);
}

function countBy(items, key) {
  return items.reduce((counts, item) => {
    const value = item[key];
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function build() {
  const source = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
  const candidates = source.candidates;
  if (!Array.isArray(source.rubric) || source.rubric.length !== 10) fail('rubric must contain ten criteria');
  if (!Array.isArray(candidates) || candidates.length !== 60) fail('exactly 60 candidates are required');
  const distribution = countBy(candidates, 'category');
  if (JSON.stringify(distribution) !== JSON.stringify(candidateTargets)) fail(`candidate distribution is ${JSON.stringify(distribution)}`);

  const ids = new Set();
  const slugs = new Set();
  const normalizedQuestions = new Set();
  for (const candidate of candidates) {
    if (ids.has(candidate.id)) fail(`duplicate candidate id ${candidate.id}`);
    ids.add(candidate.id);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate.slug) || candidate.slug.length > 100) fail(`invalid slug ${candidate.slug}`);
    if (slugs.has(candidate.slug)) fail(`duplicate slug ${candidate.slug}`);
    slugs.add(candidate.slug);
    const normalized = normalize(candidate.question).replace(/\?$/, '');
    if (normalizedQuestions.has(normalized)) fail(`duplicate question ${candidate.id}`);
    normalizedQuestions.add(normalized);
    if (candidate.question.length < 10 || candidate.question.length > 220) fail(`question length ${candidate.id}`);
    if (candidate.context !== null && candidate.context.length > 1000) fail(`context length ${candidate.id}`);
    if (!candidate.topic || candidate.topic.length > 80) fail(`invalid topic ${candidate.id}`);
    if (!Array.isArray(candidate.scores) || candidate.scores.length !== source.rubric.length || candidate.scores.some((score) => !Number.isInteger(score) || score < 1 || score > 5)) fail(`invalid scores ${candidate.id}`);
    if (genericQuestions.has(normalized)) fail(`generic prompt ${candidate.id}`);
  }

  const selected = Object.entries(targets).flatMap(([category, limit]) => candidates
    .filter((candidate) => candidate.category === category)
    .sort((a, b) => total(b) - total(a) || a.id.localeCompare(b.id))
    .slice(0, limit));
  if (selected.length !== 36) fail('selection did not produce 36 discussions');
  const selectedDistribution = countBy(selected, 'category');
  if (JSON.stringify(selectedDistribution) !== JSON.stringify(targets)) fail(`selected distribution is ${JSON.stringify(selectedDistribution)}`);
  if (selected.some((candidate) => candidate.scores[7] < 4 || candidate.scores[8] < 4)) fail('selected factual-safety and evergreen scores must be at least four');

  const pairs = [];
  for (let i = 0; i < selected.length; i += 1) {
    for (let j = i + 1; j < selected.length; j += 1) {
      const score = similarity(selected[i].question, selected[j].question);
      pairs.push({ left: selected[i].id, right: selected[j].id, similarity: Number(score.toFixed(3)) });
      if (score >= 0.58) fail(`semantic duplicate risk ${selected[i].id}/${selected[j].id} (${score.toFixed(3)})`);
    }
  }
  pairs.sort((a, b) => b.similarity - a.similarity || a.left.localeCompare(b.left));

  const starts = selected.map((candidate) => normalize(candidate.question).split(' ')[0]);
  const structureStarts = starts.reduce((counts, start) => {
    counts[start] = (counts[start] || 0) + 1;
    return counts;
  }, {});
  if (Object.keys(structureStarts).length < 10) fail('insufficient opening-structure diversity');
  if (Math.max(...Object.values(structureStarts)) > 12) fail('one opening structure dominates the inventory');

  const topics = selected.map((candidate) => `${candidate.category}:${candidate.topic.toLocaleLowerCase('en-US')}`);
  if (new Set(topics).size !== topics.length) fail('selected topic labels must be unique within each category');

  const discussions = selected.map((candidate) => ({
    candidateId: candidate.id,
    category: candidate.category,
    topic: candidate.topic,
    slug: candidate.slug,
    question: candidate.question,
    context: candidate.context,
    score: total(candidate),
    scores: Object.fromEntries(source.rubric.map((criterion, index) => [criterion, candidate.scores[index]])),
  }));
  const inventory = {
    status: 'approved-for-staging',
    sourceType: 'florida_buzz',
    starterLabel: 'Florida Buzz',
    candidateCount: candidates.length,
    candidateDistribution: distribution,
    selectedCount: discussions.length,
    selectedDistribution,
    selectionMethod: 'Highest rubric totals within the approved category quotas, followed by deterministic semantic, structure, topic, metadata, factual-safety, and evergreen gates.',
    structureStarts,
    closestSemanticPairs: pairs.slice(0, 10),
    contextParagraphCount: discussions.filter((item) => item.context).length,
    discussions,
  };

  const values = discussions.map((item) => `    (${sql(item.slug)}, ${sql(item.question)}, ${sql(item.context)}, ${sql(item.category)}, ${sql(item.topic)})`).join(',\n');
  const migration = `-- Phase 4 controlled launch inventory for florida-buzz-staging only.\n-- Production application requires separate explicit approval.\n\ndo $$\ndeclare\n  v_admin_id uuid;\nbegin\n  select user_id into v_admin_id\n  from public.profiles\n  where role = 'admin' and status = 'active'\n  order by created_at\n  limit 1;\n\n  if v_admin_id is null then\n    raise exception 'an active Florida Buzz admin profile is required';\n  end if;\n\n  insert into public.discussions (\n    slug, question, context, category, topic, source_type, status,\n    moderation_status, created_by, starter_label\n  )\n  select\n    launch.slug, launch.question, launch.context, launch.category, launch.topic,\n    'florida_buzz', 'published', 'published', v_admin_id, 'Florida Buzz'\n  from (values\n${values}\n  ) as launch(slug, question, context, category, topic)\n  on conflict (slug) do nothing;\nend;\n$$;\n`;
  return {
    inventory: `${JSON.stringify(inventory, null, 2)}\n`,
    migration,
    summary: {
      candidateCount: candidates.length,
      candidateDistribution: distribution,
      selectedCount: discussions.length,
      selectedDistribution,
      contextParagraphCount: inventory.contextParagraphCount,
      structureStarts,
      closestSemanticPair: pairs[0],
      scoreRange: [Math.min(...discussions.map((item) => item.score)), Math.max(...discussions.map((item) => item.score))],
    },
  };
}

const result = build();
if (process.argv.includes('--write')) {
  fs.writeFileSync(inventoryPath, result.inventory);
  fs.writeFileSync(migrationPath, result.migration);
} else if (process.argv.includes('--check')) {
  if (!fs.existsSync(inventoryPath) || fs.readFileSync(inventoryPath, 'utf8') !== result.inventory) fail('generated inventory is out of date');
  if (!fs.existsSync(migrationPath) || fs.readFileSync(migrationPath, 'utf8') !== result.migration) fail('generated migration is out of date');
}
console.log(JSON.stringify(result.summary, null, 2));

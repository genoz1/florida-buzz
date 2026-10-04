const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'supabase', 'schema-manifest.json'), 'utf8'));
const baselineSql = fs.readFileSync(path.join(root, 'db', 'schema.sql'), 'utf8');
const migrationSql = fs.readdirSync(path.join(root, 'supabase', 'migrations'))
  .filter((file) => file.endsWith('.sql'))
  .map((file) => fs.readFileSync(path.join(root, 'supabase', 'migrations', file), 'utf8'))
  .join('\n');

const expectedColumns = {
  article_generation_queue: ['guid', 'source_url', 'payload', 'status', 'attempts', 'last_error', 'last_attempt_at', 'created_at', 'updated_at'],
  articles: ['id', 'slug', 'title', 'dek', 'body_html', 'category', 'source_name', 'source_url', 'image_url', 'fb_caption', 'published_at', 'is_evergreen', 'meta_title', 'city', 'is_review', 'review_type', 'review_subject', 'review_rating'],
  engagement_posts: ['topic', 'message', 'posted_at'],
  feature_promo_images: ['topic', 'image_url'],
  feature_promo_posts: ['topic', 'message', 'posted_at'],
  not_found_log: ['path', 'referrer', 'created_at'],
  post_log: ['platform', 'status', 'detail', 'created_at'],
  restaurants: ['park', 'name', 'land', 'service_type', 'reservations', 'dining_plan', 'character_dining', 'characters', 'meal_periods', 'description'],
  seen_feed_items: ['id', 'guid'],
  subscribers: ['email', 'active']
};

const sourceDirectories = ['lib', 'routes', 'scripts', 'views'];

function filesUnder(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(target);
    return entry.isFile() && target.endsWith('.js') ? [target] : [];
  });
}

const sources = sourceDirectories
  .flatMap((directory) => filesUnder(path.join(root, directory)))
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n');

const storageBuckets = new Set(
  [...sources.matchAll(/\.storage\s*\.from\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1])
);
const tableReferences = new Set(
  [...sources.matchAll(/(?:supabase|client)\s*\.from\(\s*['"]([^'"]+)['"]\s*\)/g)]
    .map((match) => match[1])
    .filter((name) => !storageBuckets.has(name))
);

const errors = [];
const manifestTables = new Set(Object.keys(manifest.tables));
const migratedTables = new Set(
  [...migrationSql.matchAll(/create table(?: if not exists)? public\.([a-z_][a-z0-9_]*)/gi)]
    .map((match) => match[1])
);
const versionedTables = new Set([...manifestTables, ...migratedTables]);

for (const table of tableReferences) {
  if (!versionedTables.has(table)) errors.push(`Application references unversioned table: ${table}`);
}
for (const table of manifestTables) {
  if (!tableReferences.has(table)) errors.push(`Production table has no current application reference: ${table}`);
}
for (const [table, columns] of Object.entries(expectedColumns)) {
  const liveColumns = new Set(manifest.tables[table]?.columns || []);
  for (const column of columns) {
    if (!liveColumns.has(column)) errors.push(`Application expects missing column: ${table}.${column}`);
  }
}
for (const [table, definition] of Object.entries(manifest.tables)) {
  const escapedTable = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tableMatch = baselineSql.match(new RegExp(`create table if not exists public\\.${escapedTable}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i'));
  if (!tableMatch) {
    errors.push(`Baseline SQL is missing table: ${table}`);
    continue;
  }
  const baselineColumns = new Set(
    [...tableMatch[1].matchAll(/^\s{2}([a-z_][a-z0-9_]*)\s+/gim)].map((match) => match[1])
  );
  for (const column of definition.columns) {
    if (!baselineColumns.has(column)) errors.push(`Baseline SQL is missing column: ${table}.${column}`);
  }
  if (definition.rlsEnabled && !new RegExp(`alter table public\\.${escapedTable} enable row level security`, 'i').test(baselineSql)) {
    errors.push(`Baseline SQL is missing RLS enablement: ${table}`);
  }
}
for (const bucket of storageBuckets) {
  if (!manifest.storageBuckets.includes(bucket)) errors.push(`Application references missing storage bucket: ${bucket}`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`Schema contract verified: ${tableReferences.size} application table references across ${versionedTables.size} versioned tables, ${storageBuckets.size} storage bucket, and all audited columns are present.`);

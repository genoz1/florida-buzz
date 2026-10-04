require('dotenv').config();

const { supabase } = require('../lib/supabase');
const { reconcileAllFacebookPosts } = require('../lib/facebookBuzz');

async function run({ client = supabase, token = process.env.FB_PAGE_ACCESS_TOKEN } = {}) {
  if (!client) throw new Error('Supabase is required for Facebook Buzz comment synchronization.');
  const results = await reconcileAllFacebookPosts(client, { token, limit: 25 });
  const imported = results.reduce((total, item) => total + item.imported, 0);
  console.log(JSON.stringify({ posts: results.length, imported }));
  return results;
}

if (require.main === module) {
  run().catch((error) => {
    console.error(`Facebook Buzz comment synchronization failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { run };

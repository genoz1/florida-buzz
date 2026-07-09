require('dotenv').config();
const { createPost } = require('../lib/threads');

async function run() {
  console.log('=== Threads credentials test ===\n');

  if (!process.env.THREADS_ACCESS_TOKEN || !process.env.THREADS_USER_ID) {
    console.error('THREADS_ACCESS_TOKEN / THREADS_USER_ID not set — nothing to test.');
    return;
  }

  try {
    const result = await createPost({
      text: 'This is a one-time test post to confirm the Threads integration is working correctly. Safe to delete. 🌴',
      imageUrl: 'https://thefloridabuzz.com/apple-touch-icon.png',
    });
    console.log('Success! Post created:');
    console.log(JSON.stringify(result, null, 2));
    console.log('\nCheck @floridabuzzonline on Threads to confirm it appeared, then feel free to delete this test post.');
  } catch (err) {
    console.error('Failed:', err.message);
  }
}

run();

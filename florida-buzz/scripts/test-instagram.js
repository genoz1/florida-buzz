require('dotenv').config();
const { createPost } = require('../lib/instagram');

async function run() {
  console.log('=== Instagram credentials test ===\n');

  if (!process.env.INSTAGRAM_ACCESS_TOKEN || !process.env.INSTAGRAM_USER_ID) {
    console.error('INSTAGRAM_ACCESS_TOKEN / INSTAGRAM_USER_ID not set — nothing to test.');
    return;
  }

  try {
    const result = await createPost({
      imageUrl: 'https://thefloridabuzz.com/apple-touch-icon.png',
      caption: 'This is a one-time test post to confirm the Instagram integration is working correctly. Safe to delete. 🌴',
    });
    console.log('Success! Post created:');
    console.log(JSON.stringify(result, null, 2));
    console.log('\nCheck @floridabuzzonline on Instagram to confirm it appeared, then feel free to delete this test post.');
  } catch (err) {
    console.error('Failed:', err.message);
  }
}

run();

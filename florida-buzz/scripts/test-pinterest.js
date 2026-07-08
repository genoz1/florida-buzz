require('dotenv').config();
const { createPin } = require('../lib/pinterest');

async function run() {
  console.log('=== Pinterest credentials test ===\n');

  if (!process.env.PINTEREST_ACCESS_TOKEN || !process.env.PINTEREST_BOARD_ID) {
    console.error('PINTEREST_ACCESS_TOKEN / PINTEREST_BOARD_ID not set — nothing to test.');
    return;
  }

  try {
    const result = await createPin({
      imageUrl: 'https://thefloridabuzz.com/apple-touch-icon.png',
      title: 'Florida Buzz — Test Pin',
      description: 'This is a one-time test pin to confirm the Pinterest integration is working correctly. Safe to delete.',
      link: 'https://thefloridabuzz.com',
    });
    console.log('Success! Pin created:');
    console.log(JSON.stringify(result, null, 2));
    console.log('\nCheck your "Florida Buzz" board on Pinterest to confirm it appeared, then feel free to delete this test pin.');
  } catch (err) {
    console.error('Failed:', err.message);
  }
}

run();

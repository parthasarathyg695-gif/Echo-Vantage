'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const REQUIRED = ['GEMINI_API_KEY', 'DATABASE_URL'];

function validateEnv() {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error('\n❌  Missing required environment variables:\n');
    missing.forEach((k) => console.error(`   • ${k}`));
    console.error('\nCopy .env.example → .env and fill in the values.\n');
    process.exit(1);
  }
  console.log('✅  Environment validated.');
}

module.exports = { validateEnv };

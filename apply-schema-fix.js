require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('./db');

async function fix() {
    try {
        console.log('Starting schema fix...');

        // 1. Fix users table
        console.log('Fixing users table...');
        await query(`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS has_seen_onboarding BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS reset_token TEXT,
            ADD COLUMN IF NOT EXISTS reset_expires TIMESTAMPTZ;
        `);

        // 2. Fix sessions table
        console.log('Fixing sessions table...');
        await query(`
            ALTER TABLE sessions 
            ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id) ON DELETE CASCADE;
        `);

        // 3. Fix profiles table
        console.log('Fixing profiles table...');
        // Note: user_id should be UNIQUE in profiles
        await query(`
            ALTER TABLE profiles 
            ADD COLUMN IF NOT EXISTS user_id INT UNIQUE REFERENCES users(id) ON DELETE CASCADE;
        `);

        console.log('✅ Schema fix applied successfully.');
        process.exit(0);
    } catch (err) {
        console.error('❌ Schema fix failed:', err.message);
        process.exit(1);
    }
}

fix();

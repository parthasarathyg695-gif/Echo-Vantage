require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('./db');
const fs = require('fs');

async function dump() {
    try {
        const profiles = await query('SELECT * FROM profiles');
        const users = await query('SELECT id, email, full_name FROM users');
        const sessions = await query('SELECT id, user_id FROM sessions');

        fs.writeFileSync('db-dump.json', JSON.stringify({
            profiles: profiles.rows,
            users: users.rows,
            sessions: sessions.rows
        }, null, 2));

        console.log('Dump complete.');
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

dump();

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('./db');

async function cleanup() {
    try {
        console.log('Starting DB cleanup...');

        // 1. Delete orphan profiles
        console.log('Cleaning orphan profiles...');
        const pClean = await query('DELETE FROM profiles WHERE user_id IS NULL');
        console.log(`Removed ${pClean.rowCount} orphan profiles.`);

        // 2. Delete orphan sessions
        console.log('Cleaning orphan sessions...');
        const sClean = await query('DELETE FROM sessions WHERE user_id IS NULL');
        console.log(`Removed ${sClean.rowCount} orphan sessions.`);

        // 3. Reset sequences
        console.log('Resetting sequences...');
        const tables = ['profiles', 'users', 'resumes', 'sessions', 'questions', 'answers'];
        for (const table of tables) {
            const seqNameRes = await query(`SELECT pg_get_serial_sequence('${table}', 'id') as seq`);
            const seqName = seqNameRes.rows[0].seq;
            if (seqName) {
                console.log(`Refreshing sequence ${seqName} for table ${table}...`);
                await query(`
                    SELECT setval(
                        '${seqName}', 
                        COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, 
                        false
                    )
                `);
            }
        }

        console.log('✅ Cleanup and sequence sync complete.');
        process.exit(0);
    } catch (err) {
        console.error('❌ Cleanup failed:', err.message);
        process.exit(1);
    }
}

cleanup();
